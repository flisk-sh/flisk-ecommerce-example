import type { SQL } from 'bun';

// The catalog the storefront starts with. Existing rows are left alone, so stock that has been
// sold stays sold across restarts.
export const SEED_PRODUCTS = [
  { id: 'p_espresso', name: 'Espresso Beans 1kg', description: 'Dark roast, single origin.', priceCents: 2400, stock: 25 },
  { id: 'p_grinder', name: 'Burr Grinder', description: 'Stainless steel, 40 settings.', priceCents: 8900, stock: 6 },
  { id: 'p_kettle', name: 'Gooseneck Kettle', description: 'Temperature control, 0.9L.', priceCents: 6500, stock: 10 },
  { id: 'p_mug', name: 'Ceramic Mug', description: 'Hand glazed, 350ml.', priceCents: 1800, stock: 40 },
  { id: 'p_filters', name: 'Paper Filters x100', description: 'Fits V60 size 02.', priceCents: 900, stock: 100 },
  { id: 'p_scale', name: 'Brew Scale', description: 'Timer and 0.1g precision.', priceCents: 5900, stock: 0 },
];

export async function applySeed(sql: SQL): Promise<void> {
  for (const p of SEED_PRODUCTS) {
    await sql`insert into products (id, name, description, price_cents, stock)
      values (${p.id}, ${p.name}, ${p.description}, ${p.priceCents}, ${p.stock})
      on conflict (id) do nothing`;
  }
}
