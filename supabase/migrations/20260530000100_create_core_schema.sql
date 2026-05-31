create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;

create sequence if not exists public.order_code_seq;
create sequence if not exists public.sub_order_code_seq;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('pharmacy', 'warehouse', 'admin')),
  full_name text not null,
  phone text,
  created_at timestamptz not null default now()
);

create table public.pharmacies (
  id uuid primary key references public.profiles(id) on delete cascade,
  pharmacy_name text not null,
  license_no text not null,
  address text,
  city text,
  lat numeric(10, 7),
  lng numeric(10, 7)
);

create table public.warehouses (
  id uuid primary key references public.profiles(id) on delete cascade,
  warehouse_name text not null,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'suspended')),
  min_order_value numeric(12, 2) not null default 0 check (min_order_value >= 0),
  delivery_areas text[] not null default '{}',
  last_price_update timestamptz,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id),
  check (
    (is_deleted = false and deleted_at is null and deleted_by is null)
    or (is_deleted = true and deleted_at is not null)
  )
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  product_code text not null unique,
  canonical_name text not null,
  normalized_key text not null unique,
  brand text,
  strength text,
  form text,
  pack_size text,
  barcode text,
  active_ingredient text,
  created_from_warehouse uuid references public.warehouses(id),
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id),
  check (
    (is_deleted = false and deleted_at is null and deleted_by is null)
    or (is_deleted = true and deleted_at is not null)
  )
);

create index products_normalized_key_idx on public.products(normalized_key);
create index products_product_code_idx on public.products(product_code);

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  product_id uuid not null references public.products(id),
  warehouse_raw_name text not null,
  price numeric(12, 2) not null check (price >= 0),
  discount_pct numeric(5, 2) not null default 0
    check (discount_pct >= 0 and discount_pct <= 100),
  stock integer not null default 0 check (stock >= 0),
  is_available boolean not null default true,
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id),
  unique (warehouse_id, product_id),
  check (
    (is_deleted = false and deleted_at is null and deleted_by is null)
    or (is_deleted = true and deleted_at is not null)
  )
);

create index offers_product_id_idx on public.offers(product_id);
create index offers_warehouse_id_idx on public.offers(warehouse_id);

create table public.offer_price_history (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id),
  warehouse_id uuid not null references public.warehouses(id),
  product_id uuid not null references public.products(id),
  price numeric(12, 2) not null check (price >= 0),
  discount_pct numeric(5, 2) not null check (discount_pct >= 0 and discount_pct <= 100),
  stock integer not null check (stock >= 0),
  snapshot_date date not null,
  created_at timestamptz not null default now(),
  unique (offer_id, snapshot_date)
);

create table public.warehouse_product_map (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  raw_name text not null,
  product_id uuid not null references public.products(id),
  confirmed boolean not null default false,
  unique (warehouse_id, raw_name)
);

create table public.match_review_queue (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  raw_name text not null,
  raw_price numeric(12, 2) check (raw_price is null or raw_price >= 0),
  raw_stock integer check (raw_stock is null or raw_stock >= 0),
  suggested_product_id uuid references public.products(id),
  match_score numeric(5, 4) check (match_score is null or (match_score >= 0 and match_score <= 1)),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'new_product', 'rejected')),
  created_at timestamptz not null default now()
);

create table public.match_metrics (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  import_batch_id uuid not null,
  auto_count integer not null default 0 check (auto_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  new_count integer not null default 0 check (new_count >= 0),
  corrected_count integer not null default 0 check (corrected_count >= 0),
  created_at timestamptz not null default now()
);

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  offer_id uuid not null references public.offers(id),
  quantity integer not null check (quantity > 0),
  added_at timestamptz not null default now(),
  unique (pharmacy_id, offer_id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique,
  pharmacy_id uuid not null references public.pharmacies(id),
  total_amount numeric(12, 2) not null check (total_amount >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'preparing', 'shipped', 'delivered', 'cancelled')),
  created_at timestamptz not null default now()
);

create table public.sub_orders (
  id uuid primary key default gen_random_uuid(),
  sub_order_code text not null unique,
  parent_order_id uuid not null references public.orders(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id),
  subtotal numeric(12, 2) not null check (subtotal >= 0),
  status text not null default 'pending'
    check (status in (
      'pending',
      'accepted',
      'preparing',
      'shipped',
      'delivered',
      'rejected',
      'cancelled'
    )),
  cancel_reason text,
  cancelled_by uuid references public.profiles(id),
  commission_pct numeric(5, 2) not null check (commission_pct >= 0 and commission_pct <= 100),
  commission_amount numeric(12, 2) not null check (commission_amount >= 0),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  sub_order_id uuid not null references public.sub_orders(id) on delete cascade,
  product_id uuid references public.products(id),
  product_name text not null,
  warehouse_name text not null,
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  discount_pct numeric(5, 2) not null default 0
    check (discount_pct >= 0 and discount_pct <= 100),
  quantity integer not null check (quantity > 0),
  line_total numeric(12, 2) not null check (line_total >= 0)
);

create table public.quick_list (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  product_id uuid not null references public.products(id),
  unique (pharmacy_id, product_id)
);

create table public.commission_config (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid references public.warehouses(id),
  commission_pct numeric(5, 2) not null default 5
    check (commission_pct >= 0 and commission_pct <= 100),
  active boolean not null default true
);

create unique index commission_config_one_active_global_idx
  on public.commission_config((active))
  where warehouse_id is null and active;

create unique index commission_config_one_active_per_warehouse_idx
  on public.commission_config(warehouse_id)
  where warehouse_id is not null and active;

create table public.brand_dictionary (
  id uuid primary key default gen_random_uuid(),
  ar_name text not null,
  en_name text,
  unique (ar_name)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

insert into public.commission_config (warehouse_id, commission_pct, active)
values (null, 5, true);

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() = 'admin', false)
$$;

create or replace function public.next_order_code()
returns text
language sql
volatile
as $$
  select 'ORD-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('public.order_code_seq')::text, 6, '0')
$$;

create or replace function public.next_sub_order_code()
returns text
language sql
volatile
as $$
  select 'SUB-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('public.sub_order_code_seq')::text, 6, '0')
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger offers_set_updated_at
before update on public.offers
for each row execute function public.set_updated_at();

create trigger sub_orders_set_updated_at
before update on public.sub_orders
for each row execute function public.set_updated_at();

create or replace function public.prevent_hard_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Hard delete is not allowed for %. Use soft-delete fields.', tg_table_name;
end;
$$;

create trigger warehouses_prevent_hard_delete
before delete on public.warehouses
for each row execute function public.prevent_hard_delete();

create trigger products_prevent_hard_delete
before delete on public.products
for each row execute function public.prevent_hard_delete();

create trigger offers_prevent_hard_delete
before delete on public.offers
for each row execute function public.prevent_hard_delete();

create or replace function public.audit_sensitive_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_action text;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_table_name = 'offers' then
    if tg_op = 'INSERT' then
      v_action := 'offer.create';
      v_new := to_jsonb(new);
    elsif tg_op = 'UPDATE' and old.is_deleted = false and new.is_deleted = true then
      v_action := 'offer.delete';
      v_old := to_jsonb(old);
      v_new := to_jsonb(new);
    elsif tg_op = 'UPDATE' and (
      old.price is distinct from new.price
      or old.discount_pct is distinct from new.discount_pct
      or old.stock is distinct from new.stock
      or old.is_available is distinct from new.is_available
    ) then
      v_action := 'offer.price_stock_change';
      v_old := jsonb_build_object(
        'price', old.price,
        'discount_pct', old.discount_pct,
        'stock', old.stock,
        'is_available', old.is_available
      );
      v_new := jsonb_build_object(
        'price', new.price,
        'discount_pct', new.discount_pct,
        'stock', new.stock,
        'is_available', new.is_available
      );
    end if;
  elsif tg_table_name = 'warehouses' and tg_op = 'UPDATE'
    and old.status is distinct from new.status then
    v_action := 'warehouse.status_change';
    v_old := jsonb_build_object('status', old.status);
    v_new := jsonb_build_object('status', new.status);
  elsif tg_table_name = 'commission_config' then
    v_action := 'commission.update';
    if tg_op = 'INSERT' then
      v_new := to_jsonb(new);
    elsif tg_op = 'UPDATE' then
      v_old := to_jsonb(old);
      v_new := to_jsonb(new);
    end if;
  elsif tg_table_name = 'sub_orders' and tg_op = 'UPDATE' and (
    old.status is distinct from new.status
    or old.cancel_reason is distinct from new.cancel_reason
    or old.cancelled_by is distinct from new.cancelled_by
  ) then
    v_action := case
      when new.status = 'cancelled' then 'order.cancel'
      else 'order.status_change'
    end;
    v_old := jsonb_build_object(
      'status', old.status,
      'cancel_reason', old.cancel_reason,
      'cancelled_by', old.cancelled_by
    );
    v_new := jsonb_build_object(
      'status', new.status,
      'cancel_reason', new.cancel_reason,
      'cancelled_by', new.cancelled_by
    );
  end if;

  if v_action is not null then
    insert into public.audit_log (
      actor_id,
      action,
      entity_type,
      entity_id,
      old_value,
      new_value
    )
    values (
      v_actor_id,
      v_action,
      tg_table_name,
      case when tg_op = 'DELETE' then old.id else new.id end,
      v_old,
      v_new
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger offers_audit_sensitive_changes
after insert or update on public.offers
for each row execute function public.audit_sensitive_changes();

create trigger warehouses_audit_sensitive_changes
after update on public.warehouses
for each row execute function public.audit_sensitive_changes();

create trigger commission_config_audit_sensitive_changes
after insert or update on public.commission_config
for each row execute function public.audit_sensitive_changes();

create trigger sub_orders_audit_sensitive_changes
after update on public.sub_orders
for each row execute function public.audit_sensitive_changes();

do $$
declare
  publication_table record;
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    for publication_table in
      select schemaname, tablename
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename <> 'offers'
    loop
      execute format(
        'alter publication supabase_realtime drop table %I.%I',
        publication_table.schemaname,
        publication_table.tablename
      );
    end loop;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'offers'
    ) then
      alter publication supabase_realtime add table public.offers;
    end if;
  end if;
end $$;

create or replace function public.snapshot_offer_prices()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  insert into public.offer_price_history (
    offer_id,
    warehouse_id,
    product_id,
    price,
    discount_pct,
    stock,
    snapshot_date
  )
  select
    o.id,
    o.warehouse_id,
    o.product_id,
    o.price,
    o.discount_pct,
    o.stock,
    current_date
  from public.offers o
  join public.products p on p.id = o.product_id
  join public.warehouses w on w.id = o.warehouse_id
  where o.is_deleted = false
    and p.is_deleted = false
    and w.is_deleted = false
    and o.is_available = true
  on conflict (offer_id, snapshot_date) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

select cron.unschedule('daily-offer-price-snapshot')
where exists (
  select 1
  from cron.job
  where jobname = 'daily-offer-price-snapshot'
);

select cron.schedule(
  'daily-offer-price-snapshot',
  '15 0 * * *',
  $$select public.snapshot_offer_prices();$$
);

create or replace function public.create_order_from_cart()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pharmacy_id uuid := auth.uid();
  v_order_id uuid;
  v_total numeric(12, 2);
  v_sub_order record;
  v_sub_order_id uuid;
  v_commission_pct numeric(5, 2);
begin
  if public.current_profile_role() <> 'pharmacy' then
    raise exception 'Only pharmacy users can create orders.';
  end if;

  select coalesce(sum(
    round(ci.quantity * o.price * (1 - (o.discount_pct / 100.0)), 2)
  ), 0)
  into v_total
  from public.cart_items ci
  join public.offers o on o.id = ci.offer_id
  join public.products p on p.id = o.product_id
  join public.warehouses w on w.id = o.warehouse_id
  where ci.pharmacy_id = v_pharmacy_id
    and ci.quantity > 0
    and o.is_available = true
    and o.is_deleted = false
    and p.is_deleted = false
    and w.is_deleted = false
    and w.status = 'active';

  if v_total <= 0 then
    raise exception 'Cart has no active offers.';
  end if;

  insert into public.orders (order_code, pharmacy_id, total_amount)
  values (public.next_order_code(), v_pharmacy_id, v_total)
  returning id into v_order_id;

  for v_sub_order in
    select
      o.warehouse_id,
      round(sum(ci.quantity * o.price * (1 - (o.discount_pct / 100.0))), 2) as subtotal
    from public.cart_items ci
    join public.offers o on o.id = ci.offer_id
    join public.products p on p.id = o.product_id
    join public.warehouses w on w.id = o.warehouse_id
    where ci.pharmacy_id = v_pharmacy_id
      and ci.quantity > 0
      and o.is_available = true
      and o.is_deleted = false
      and p.is_deleted = false
      and w.is_deleted = false
      and w.status = 'active'
    group by o.warehouse_id
  loop
    select cc.commission_pct
    into v_commission_pct
    from public.commission_config cc
    where cc.active = true
      and (cc.warehouse_id = v_sub_order.warehouse_id or cc.warehouse_id is null)
    order by cc.warehouse_id is null
    limit 1;

    insert into public.sub_orders (
      sub_order_code,
      parent_order_id,
      warehouse_id,
      subtotal,
      commission_pct,
      commission_amount
    )
    values (
      public.next_sub_order_code(),
      v_order_id,
      v_sub_order.warehouse_id,
      v_sub_order.subtotal,
      coalesce(v_commission_pct, 5),
      round(v_sub_order.subtotal * (coalesce(v_commission_pct, 5) / 100.0), 2)
    )
    returning id into v_sub_order_id;

    insert into public.order_items (
      sub_order_id,
      product_id,
      product_name,
      warehouse_name,
      unit_price,
      discount_pct,
      quantity,
      line_total
    )
    select
      v_sub_order_id,
      p.id,
      o.warehouse_raw_name,
      w.warehouse_name,
      o.price,
      o.discount_pct,
      ci.quantity,
      round(ci.quantity * o.price * (1 - (o.discount_pct / 100.0)), 2)
    from public.cart_items ci
    join public.offers o on o.id = ci.offer_id
    join public.products p on p.id = o.product_id
    join public.warehouses w on w.id = o.warehouse_id
    where ci.pharmacy_id = v_pharmacy_id
      and o.warehouse_id = v_sub_order.warehouse_id
      and o.is_available = true
      and o.is_deleted = false
      and p.is_deleted = false
      and w.is_deleted = false
      and w.status = 'active';
  end loop;

  delete from public.cart_items where pharmacy_id = v_pharmacy_id;

  return v_order_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.pharmacies enable row level security;
alter table public.warehouses enable row level security;
alter table public.products enable row level security;
alter table public.offers enable row level security;
alter table public.offer_price_history enable row level security;
alter table public.warehouse_product_map enable row level security;
alter table public.match_review_queue enable row level security;
alter table public.match_metrics enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.sub_orders enable row level security;
alter table public.order_items enable row level security;
alter table public.quick_list enable row level security;
alter table public.commission_config enable row level security;
alter table public.brand_dictionary enable row level security;
alter table public.audit_log enable row level security;

create policy "profiles own select" on public.profiles
for select using (id = auth.uid() or public.is_admin());
create policy "profiles own insert" on public.profiles
for insert with check (id = auth.uid() or public.is_admin());
create policy "profiles own update" on public.profiles
for update using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());
create policy "profiles admin delete" on public.profiles
for delete using (public.is_admin());

create policy "pharmacies owner select" on public.pharmacies
for select using (id = auth.uid() or public.is_admin());
create policy "pharmacies owner insert" on public.pharmacies
for insert with check (id = auth.uid() or public.is_admin());
create policy "pharmacies owner update" on public.pharmacies
for update using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());
create policy "pharmacies admin delete" on public.pharmacies
for delete using (public.is_admin());

create policy "warehouses readable active" on public.warehouses
for select using (
  public.is_admin()
  or id = auth.uid()
  or (status = 'active' and is_deleted = false)
);
create policy "warehouses owner insert" on public.warehouses
for insert with check (id = auth.uid() or public.is_admin());
create policy "warehouses owner update" on public.warehouses
for update using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());
create policy "warehouses admin delete" on public.warehouses
for delete using (public.is_admin());

create policy "products active read" on public.products
for select using (public.is_admin() or is_deleted = false);
create policy "products admin insert" on public.products
for insert with check (public.is_admin());
create policy "products admin update" on public.products
for update using (public.is_admin()) with check (public.is_admin());
create policy "products admin delete" on public.products
for delete using (public.is_admin());

create policy "offers readable available" on public.offers
for select using (
  public.is_admin()
  or warehouse_id = auth.uid()
  or (
    is_available = true
    and is_deleted = false
    and exists (
      select 1 from public.products p
      where p.id = product_id and p.is_deleted = false
    )
  )
);
create policy "offers warehouse insert" on public.offers
for insert with check (warehouse_id = auth.uid() or public.is_admin());
create policy "offers warehouse update" on public.offers
for update using (warehouse_id = auth.uid() or public.is_admin())
with check (warehouse_id = auth.uid() or public.is_admin());
create policy "offers admin delete" on public.offers
for delete using (public.is_admin());

create policy "offer history owner read" on public.offer_price_history
for select using (
  public.is_admin()
  or warehouse_id = auth.uid()
  or public.current_profile_role() = 'pharmacy'
);
create policy "offer history admin insert" on public.offer_price_history
for insert with check (public.is_admin());
create policy "offer history admin update" on public.offer_price_history
for update using (public.is_admin()) with check (public.is_admin());
create policy "offer history admin delete" on public.offer_price_history
for delete using (public.is_admin());

create policy "warehouse map owner select" on public.warehouse_product_map
for select using (warehouse_id = auth.uid() or public.is_admin());
create policy "warehouse map owner insert" on public.warehouse_product_map
for insert with check (warehouse_id = auth.uid() or public.is_admin());
create policy "warehouse map owner update" on public.warehouse_product_map
for update using (warehouse_id = auth.uid() or public.is_admin())
with check (warehouse_id = auth.uid() or public.is_admin());
create policy "warehouse map admin delete" on public.warehouse_product_map
for delete using (public.is_admin());

create policy "match queue owner select" on public.match_review_queue
for select using (warehouse_id = auth.uid() or public.is_admin());
create policy "match queue owner insert" on public.match_review_queue
for insert with check (warehouse_id = auth.uid() or public.is_admin());
create policy "match queue owner update" on public.match_review_queue
for update using (warehouse_id = auth.uid() or public.is_admin())
with check (warehouse_id = auth.uid() or public.is_admin());
create policy "match queue admin delete" on public.match_review_queue
for delete using (public.is_admin());

create policy "match metrics owner select" on public.match_metrics
for select using (warehouse_id = auth.uid() or public.is_admin());
create policy "match metrics owner insert" on public.match_metrics
for insert with check (warehouse_id = auth.uid() or public.is_admin());
create policy "match metrics owner update" on public.match_metrics
for update using (warehouse_id = auth.uid() or public.is_admin())
with check (warehouse_id = auth.uid() or public.is_admin());
create policy "match metrics admin delete" on public.match_metrics
for delete using (public.is_admin());

create policy "cart pharmacy select" on public.cart_items
for select using (pharmacy_id = auth.uid() or public.is_admin());
create policy "cart pharmacy insert" on public.cart_items
for insert with check (pharmacy_id = auth.uid() or public.is_admin());
create policy "cart pharmacy update" on public.cart_items
for update using (pharmacy_id = auth.uid() or public.is_admin())
with check (pharmacy_id = auth.uid() or public.is_admin());
create policy "cart pharmacy delete" on public.cart_items
for delete using (pharmacy_id = auth.uid() or public.is_admin());

create policy "orders pharmacy select" on public.orders
for select using (pharmacy_id = auth.uid() or public.is_admin());
create policy "orders pharmacy insert" on public.orders
for insert with check (pharmacy_id = auth.uid() or public.is_admin());
create policy "orders pharmacy update" on public.orders
for update using (pharmacy_id = auth.uid() or public.is_admin())
with check (pharmacy_id = auth.uid() or public.is_admin());
create policy "orders admin delete" on public.orders
for delete using (public.is_admin());

create policy "sub orders owner select" on public.sub_orders
for select using (
  public.is_admin()
  or warehouse_id = auth.uid()
  or exists (
    select 1 from public.orders o
    where o.id = parent_order_id and o.pharmacy_id = auth.uid()
  )
);
create policy "sub orders system insert" on public.sub_orders
for insert with check (public.is_admin());
create policy "sub orders warehouse update" on public.sub_orders
for update using (
  public.is_admin()
  or warehouse_id = auth.uid()
  or exists (
    select 1 from public.orders o
    where o.id = parent_order_id and o.pharmacy_id = auth.uid()
  )
)
with check (
  public.is_admin()
  or warehouse_id = auth.uid()
  or exists (
    select 1 from public.orders o
    where o.id = parent_order_id and o.pharmacy_id = auth.uid()
  )
);
create policy "sub orders admin delete" on public.sub_orders
for delete using (public.is_admin());

create policy "order items owner select" on public.order_items
for select using (
  public.is_admin()
  or exists (
    select 1
    from public.sub_orders so
    join public.orders o on o.id = so.parent_order_id
    where so.id = sub_order_id
      and (so.warehouse_id = auth.uid() or o.pharmacy_id = auth.uid())
  )
);
create policy "order items admin insert" on public.order_items
for insert with check (public.is_admin());
create policy "order items admin update" on public.order_items
for update using (public.is_admin()) with check (public.is_admin());
create policy "order items admin delete" on public.order_items
for delete using (public.is_admin());

create policy "quick list pharmacy select" on public.quick_list
for select using (pharmacy_id = auth.uid() or public.is_admin());
create policy "quick list pharmacy insert" on public.quick_list
for insert with check (pharmacy_id = auth.uid() or public.is_admin());
create policy "quick list pharmacy delete" on public.quick_list
for delete using (pharmacy_id = auth.uid() or public.is_admin());
create policy "quick list admin update" on public.quick_list
for update using (public.is_admin()) with check (public.is_admin());

create policy "commission readable" on public.commission_config
for select using (
  public.is_admin()
  or warehouse_id = auth.uid()
  or warehouse_id is null
);
create policy "commission admin insert" on public.commission_config
for insert with check (public.is_admin());
create policy "commission admin update" on public.commission_config
for update using (public.is_admin()) with check (public.is_admin());
create policy "commission admin delete" on public.commission_config
for delete using (public.is_admin());

create policy "brand dictionary authenticated read" on public.brand_dictionary
for select using (auth.role() = 'authenticated' or public.is_admin());
create policy "brand dictionary admin insert" on public.brand_dictionary
for insert with check (public.is_admin());
create policy "brand dictionary admin update" on public.brand_dictionary
for update using (public.is_admin()) with check (public.is_admin());
create policy "brand dictionary admin delete" on public.brand_dictionary
for delete using (public.is_admin());

create policy "audit admin read" on public.audit_log
for select using (public.is_admin());
create policy "audit system insert" on public.audit_log
for insert with check (public.is_admin() or actor_id = auth.uid() or actor_id is null);
create policy "audit admin update" on public.audit_log
for update using (public.is_admin()) with check (public.is_admin());
create policy "audit admin delete" on public.audit_log
for delete using (public.is_admin());
