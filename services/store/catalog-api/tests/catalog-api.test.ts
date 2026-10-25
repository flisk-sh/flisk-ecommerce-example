import { SQL } from 'bun';
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';
import { cleanDatabaseUrl } from '../src/db';
// The migrator owns the schema and the seed. Run it once against the test database first (see README).
import { SEED_PRODUCTS } from '../../catalog-api-migrator/src/seed';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL to a Postgres database (flisk up starts one) to run the catalog tests.');

const sql = new SQL(cleanDatabaseUrl(url));
const app = createApp(sql);

const post = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const stockOf = async (id: string) =>
  (await (await app.request(`/api/products/${id}`)).json()).data.stock as number;

// Each test starts from the seed: no orders, seed stock.
beforeEach(async () => {
  await sql`truncate order_lines, orders restart identity`;
  for (const p of SEED_PRODUCTS) {
    await sql`update products set stock = ${p.stock} where id = ${p.id}`;
  }
});

afterAll(async () => {
  await sql.close();
});

describe('catalog-api', () => {
  it('reports health', async () => {
    const res = await app.request('/health');
    expect(await res.json()).toEqual({ status: 'ok', service: 'catalog-api' });
  });

  it('lists and searches products', async () => {
    const all = (await (await app.request('/api/products')).json()).data;
    expect(all.length).toBeGreaterThan(3);

    const found = (await (await app.request('/api/products?q=GRINDER')).json()).data;
    expect(found.map((p: { id: string }) => p.id)).toEqual(['p_grinder']);
  });

  it('404s an unknown product', async () => {
    expect((await app.request('/api/products/nope')).status).toBe(404);
  });

  it('prices an order in cents and decrements stock', async () => {
    const before = await stockOf('p_mug');
    const res = await post('/api/orders', {
      lines: [
        { productId: 'p_mug', quantity: 2 },
        { productId: 'p_filters', quantity: 1 },
      ],
    });

    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.totalCents).toBe(2 * 1800 + 900);
    expect(data.id).toMatch(/^o_\d+$/);
    expect(await stockOf('p_mug')).toBe(before - 2);
  });

  it('keeps the order after it is placed', async () => {
    const res = await post('/api/orders', { lines: [{ productId: 'p_kettle', quantity: 1 }] });
    const { data } = await res.json();
    const rows = await sql`select name, quantity, unit_price_cents from order_lines where order_id = ${Number(data.id.slice(2))}`;
    expect(rows).toEqual([{ name: 'Gooseneck Kettle', quantity: 1, unit_price_cents: 6500 }]);
  });

  it('rejects an order that exceeds stock without taking any stock', async () => {
    const mugBefore = await stockOf('p_mug');
    const res = await post('/api/orders', {
      lines: [
        { productId: 'p_mug', quantity: 1 },
        { productId: 'p_scale', quantity: 1 },
      ],
    });

    expect(res.status).toBe(409);
    expect(await stockOf('p_mug')).toBe(mugBefore);
  });

  it('cannot oversell by splitting one product across lines', async () => {
    const stock = await stockOf('p_grinder');
    const res = await post('/api/orders', {
      lines: [
        { productId: 'p_grinder', quantity: stock },
        { productId: 'p_grinder', quantity: 1 },
      ],
    });

    expect(res.status).toBe(409);
    expect(await stockOf('p_grinder')).toBe(stock);
  });

  it('rejects malformed orders', async () => {
    for (const body of [{}, { lines: [] }, { lines: [{ productId: 'p_mug', quantity: 0 }] }]) {
      expect((await post('/api/orders', body)).status).toBe(400);
    }
    expect((await post('/api/orders', { lines: [{ productId: 'ghost', quantity: 1 }] })).status).toBe(404);
  });

  it('answers CORS preflight for the Vue app', async () => {
    const res = await app.request('/api/orders', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
