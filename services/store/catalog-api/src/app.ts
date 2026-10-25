import type { SQL } from 'bun';
import { Hono } from 'hono';

export interface Product {
  id: string;
  name: string;
  description: string;
  /** Integer cents, so totals never suffer floating point drift. */
  priceCents: number;
  stock: number;
}

export interface OrderLine {
  productId: string;
  quantity: number;
}

export interface Order {
  id: string;
  lines: Array<OrderLine & { name: string; unitPriceCents: number }>;
  totalCents: number;
  createdAt: string;
}

// A business rule failure: the status code and message go straight back to the client.
class CatalogError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

function parseLines(body: unknown): OrderLine[] | null {
  const lines = (body as { lines?: unknown })?.lines;
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const parsed: OrderLine[] = [];
  for (const line of lines) {
    const { productId, quantity } = (line ?? {}) as Partial<OrderLine>;
    if (typeof productId !== 'string' || !Number.isInteger(quantity) || (quantity as number) < 1) {
      return null;
    }
    parsed.push({ productId, quantity: quantity as number });
  }
  return parsed;
}

// Products and orders live in Postgres (see catalog-api-migrator). Every write runs in one transaction.
export function createApp(sql: SQL) {
  const app = new Hono();

  // The Vue app runs on its own origin (app.*.localhost) and calls this API directly,
  // so allow cross-origin requests.
  app.use('*', async (c, next) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type');
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  });

  // Health check endpoint (required by TILT_RESOURCE_DEFAULTS.star)
  app.get('/health', (c) => c.json({ status: 'ok', service: 'catalog-api' }));

  app.get('/', (c) =>
    c.json({
      service: 'catalog-api',
      endpoints: ['GET /health', 'GET /api/products?q=', 'GET /api/products/:id', 'POST /api/orders'],
    }),
  );

  app.get('/api/products', async (c) => {
    const q = c.req.query('q')?.trim().toLowerCase();
    const data = q
      ? await sql<Product[]>`select id, name, description, price_cents as "priceCents", stock from products
          where strpos(lower(name || ' ' || description), ${q}) > 0 order by id`
      : await sql<Product[]>`select id, name, description, price_cents as "priceCents", stock from products order by id`;
    return c.json({ data });
  });

  app.get('/api/products/:id', async (c) => {
    const [product] = await sql<Product[]>`select id, name, description, price_cents as "priceCents", stock
      from products where id = ${c.req.param('id')}`;
    return product ? c.json({ data: product }) : c.json({ error: 'product not found' }, 404);
  });

  // Creates an order atomically: the products are locked, every line is checked against stock,
  // and nothing is taken unless the whole order fits.
  app.post('/api/orders', async (c) => {
    const lines = parseLines(await c.req.json().catch(() => null));
    if (!lines) return c.json({ error: 'lines must be a non-empty list of { productId, quantity >= 1 }' }, 400);

    try {
      const order = await sql.begin(async (tx) => {
        const ids = [...new Set(lines.map((l) => l.productId))];
        const products = await tx<Array<Product & { priceCents: number }>>`select id, name, price_cents as "priceCents", stock
          from products where id in ${tx(ids)} order by id for update`;
        const byId = new Map(products.map((p) => [p.id, p]));

        for (const { productId } of lines) {
          if (!byId.has(productId)) throw new CatalogError(404, `unknown product ${productId}`);
        }
        // Same product on two lines must not oversell: compare the combined quantity to stock.
        for (const product of products) {
          const wanted = lines.filter((l) => l.productId === product.id).reduce((n, l) => n + l.quantity, 0);
          if (wanted > product.stock) throw new CatalogError(409, `only ${product.stock} of ${product.name} in stock`);
        }

        const priced = lines.map((l) => {
          const product = byId.get(l.productId) as Product & { priceCents: number };
          return { productId: l.productId, quantity: l.quantity, name: product.name, unitPriceCents: product.priceCents };
        });
        const totalCents = priced.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);

        const [row] = await tx<Array<{ id: number; createdAt: Date }>>`insert into orders (total_cents)
          values (${totalCents}) returning id, created_at as "createdAt"`;
        for (const [i, line] of priced.entries()) {
          await tx`update products set stock = stock - ${line.quantity} where id = ${line.productId}`;
          await tx`insert into order_lines (order_id, line_no, product_id, name, quantity, unit_price_cents)
            values (${row.id}, ${i + 1}, ${line.productId}, ${line.name}, ${line.quantity}, ${line.unitPriceCents})`;
        }

        return { id: `o_${row.id}`, lines: priced, totalCents, createdAt: row.createdAt.toISOString() } satisfies Order;
      });
      return c.json({ data: order }, 201);
    } catch (err) {
      if (err instanceof CatalogError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  });

  return app;
}
