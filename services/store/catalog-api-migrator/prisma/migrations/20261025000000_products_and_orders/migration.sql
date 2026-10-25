-- The catalog's tables. Money is integer cents; stock can never go below zero.
create table if not exists products (
  id text primary key,
  name text not null,
  description text not null,
  price_cents integer not null check (price_cents >= 0),
  stock integer not null check (stock >= 0)
);

create table if not exists orders (
  id serial primary key,
  total_cents integer not null check (total_cents >= 0),
  created_at timestamptz not null default now()
);

create table if not exists order_lines (
  order_id integer not null references orders (id) on delete cascade,
  line_no integer not null,
  product_id text not null references products (id),
  name text not null,
  quantity integer not null check (quantity >= 1),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  primary key (order_id, line_no)
);
