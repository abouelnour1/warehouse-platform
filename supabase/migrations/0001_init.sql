-- ============================================================
-- Phase 1 complete schema — run once in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- 1. Extensions & sequences
-- ============================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;

create sequence if not exists public.order_code_seq;
create sequence if not exists public.sub_order_code_seq;

-- ============================================================
-- 2. Tables (dependency order)
-- ============================================================

create table public.profiles (
  id         uuid        primary key references auth.users(id) on delete cascade,
  role       text        not null check (role in ('pharmacy', 'warehouse', 'admin')),
  full_name  text        not null,
  phone      text,
  created_at timestamptz not null default now()
);

create table public.pharmacies (
  id            uuid    primary key references public.profiles(id) on delete cascade,
  pharmacy_name text    not null,
  license_no    text    not null,
  address       text,
  city          text,
  lat           numeric(10,7),
  lng           numeric(10,7)
);

create table public.warehouses (
  id                 uuid        primary key references public.profiles(id) on delete cascade,
  warehouse_name     text        not null,
  status             text        not null default 'pending'
                                 check (status in ('pending','active','suspended')),
  min_order_value    numeric(12,2) not null default 0 check (min_order_value >= 0),
  delivery_areas     text[]      not null default '{}',
  last_price_update  timestamptz,
  is_deleted         boolean     not null default false,
  deleted_at         timestamptz,
  deleted_by         uuid        references public.profiles(id),
  check (
    (is_deleted = false and deleted_at is null and deleted_by is null)
    or (is_deleted = true  and deleted_at is not null)
  )
);

create table public.products (
  id                    uuid        primary key default gen_random_uuid(),
  product_code          text        not null unique,
  canonical_name        text        not null,
  normalized_key        text        not null unique,
  brand                 text,
  strength              text,
  form                  text,
  pack_size             text,
  barcode               text,
  active_ingredient     text,
  created_from_warehouse uuid       references public.warehouses(id),
  is_verified           boolean     not null default false,
  created_at            timestamptz not null default now(),
  is_deleted            boolean     not null default false,
  deleted_at            timestamptz,
  deleted_by            uuid        references public.profiles(id),
  check (
    (is_deleted = false and deleted_at is null and deleted_by is null)
    or (is_deleted = true  and deleted_at is not null)
  )
);

create table public.offers (
  id               uuid        primary key default gen_random_uuid(),
  warehouse_id     uuid        not null references public.warehouses(id),
  product_id       uuid        not null references public.products(id),
  warehouse_raw_name text      not null,
  price            numeric(12,2) not null check (price >= 0),
  discount_pct     numeric(5,2)  not null default 0
                                 check (discount_pct >= 0 and discount_pct <= 100),
  stock            integer     not null default 0 check (stock >= 0),
  is_available     boolean     not null default true,
  updated_at       timestamptz not null default now(),
  is_deleted       boolean     not null default false,
  deleted_at       timestamptz,
  deleted_by       uuid        references public.profiles(id),
  unique (warehouse_id, product_id),
  check (
    (is_deleted = false and deleted_at is null and deleted_by is null)
    or (is_deleted = true  and deleted_at is not null)
  )
);

create table public.offer_price_history (
  id            uuid        primary key default gen_random_uuid(),
  offer_id      uuid        not null references public.offers(id),
  warehouse_id  uuid        not null references public.warehouses(id),
  product_id    uuid        not null references public.products(id),
  price         numeric(12,2) not null check (price >= 0),
  discount_pct  numeric(5,2)  not null check (discount_pct >= 0 and discount_pct <= 100),
  stock         integer     not null check (stock >= 0),
  snapshot_date date        not null,
  created_at    timestamptz not null default now(),
  unique (offer_id, snapshot_date)
);

create table public.warehouse_product_map (
  id           uuid    primary key default gen_random_uuid(),
  warehouse_id uuid    not null references public.warehouses(id),
  raw_name     text    not null,
  product_id   uuid    not null references public.products(id),
  confirmed    boolean not null default false,
  unique (warehouse_id, raw_name)
);

create table public.match_review_queue (
  id                   uuid        primary key default gen_random_uuid(),
  warehouse_id         uuid        not null references public.warehouses(id),
  raw_name             text        not null,
  raw_price            numeric(12,2) check (raw_price is null or raw_price >= 0),
  raw_stock            integer       check (raw_stock is null or raw_stock >= 0),
  suggested_product_id uuid        references public.products(id),
  match_score          numeric(5,4) check (match_score is null or (match_score >= 0 and match_score <= 1)),
  status               text        not null default 'pending'
                                   check (status in ('pending','confirmed','new_product','rejected')),
  created_at           timestamptz not null default now()
);

create table public.match_metrics (
  id              uuid        primary key default gen_random_uuid(),
  warehouse_id    uuid        not null references public.warehouses(id),
  import_batch_id uuid        not null,
  auto_count      integer     not null default 0 check (auto_count      >= 0),
  review_count    integer     not null default 0 check (review_count    >= 0),
  new_count       integer     not null default 0 check (new_count       >= 0),
  corrected_count integer     not null default 0 check (corrected_count >= 0),
  created_at      timestamptz not null default now()
);

create table public.cart_items (
  id          uuid        primary key default gen_random_uuid(),
  pharmacy_id uuid        not null references public.pharmacies(id) on delete cascade,
  offer_id    uuid        not null references public.offers(id),
  quantity    integer     not null check (quantity > 0),
  added_at    timestamptz not null default now(),
  unique (pharmacy_id, offer_id)
);

create table public.orders (
  id           uuid        primary key default gen_random_uuid(),
  order_code   text        not null unique,
  pharmacy_id  uuid        not null references public.pharmacies(id),
  total_amount numeric(12,2) not null check (total_amount >= 0),
  status       text        not null default 'pending'
               check (status in (
                 'pending','accepted','preparing','shipped','delivered',
                 'cancelled','rejected','partial','completed'
               )),
  created_at   timestamptz not null default now()
);

create table public.sub_orders (
  id               uuid        primary key default gen_random_uuid(),
  sub_order_code   text        not null unique,
  parent_order_id  uuid        not null references public.orders(id) on delete cascade,
  warehouse_id     uuid        not null references public.warehouses(id),
  subtotal         numeric(12,2) not null check (subtotal >= 0),
  status           text        not null default 'pending'
                               check (status in (
                                 'pending','accepted','preparing','shipped',
                                 'delivered','rejected','cancelled'
                               )),
  cancel_reason    text,
  cancelled_by     uuid        references public.profiles(id),
  commission_pct   numeric(5,2)  not null check (commission_pct   >= 0 and commission_pct   <= 100),
  commission_amount numeric(12,2) not null check (commission_amount >= 0),
  updated_at       timestamptz not null default now()
);

create table public.order_items (
  id           uuid        primary key default gen_random_uuid(),
  sub_order_id uuid        not null references public.sub_orders(id) on delete cascade,
  product_id   uuid        references public.products(id),
  product_name text        not null,
  warehouse_name text      not null,
  unit_price   numeric(12,2) not null check (unit_price   >= 0),
  discount_pct numeric(5,2)  not null default 0
                              check (discount_pct >= 0 and discount_pct <= 100),
  quantity     integer     not null check (quantity > 0),
  line_total   numeric(12,2) not null check (line_total   >= 0)
);

create table public.quick_list (
  id          uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  product_id  uuid not null references public.products(id),
  unique (pharmacy_id, product_id)
);

create table public.commission_config (
  id             uuid       primary key default gen_random_uuid(),
  warehouse_id   uuid       references public.warehouses(id),
  commission_pct numeric(5,2) not null default 5
                             check (commission_pct >= 0 and commission_pct <= 100),
  active         boolean    not null default true
);

create table public.brand_dictionary (
  id      uuid primary key default gen_random_uuid(),
  ar_name text not null,
  en_name text,
  unique (ar_name)
);

create table public.audit_log (
  id          uuid        primary key default gen_random_uuid(),
  actor_id    uuid        references public.profiles(id),
  action      text        not null,
  entity_type text        not null,
  entity_id   uuid        not null,
  old_value   jsonb,
  new_value   jsonb,
  created_at  timestamptz not null default now()
);

create table public.notifications (
  id           uuid        primary key default gen_random_uuid(),
  recipient_id uuid        not null references public.profiles(id),
  actor_id     uuid        references public.profiles(id),
  entity_type  text        not null,
  entity_id    uuid        not null,
  message      text        not null,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create table public.device_push_tokens (
  id         uuid        primary key default gen_random_uuid(),
  profile_id uuid        not null references public.profiles(id) on delete cascade,
  platform   text        not null check (platform in ('android','ios','web')),
  token      text        not null,
  enabled    boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, token)
);

-- ============================================================
-- 3. Indexes
-- ============================================================

create index products_normalized_key_idx on public.products(normalized_key);
create index products_product_code_idx   on public.products(product_code);

create index products_search_text_idx on public.products
  using gin (
    to_tsvector('simple',
      coalesce(canonical_name,    '') || ' ' ||
      coalesce(normalized_key,    '') || ' ' ||
      coalesce(brand,             '') || ' ' ||
      coalesce(active_ingredient, '') || ' ' ||
      coalesce(product_code,      '')
    )
  );

create index offers_product_id_idx   on public.offers(product_id);
create index offers_warehouse_id_idx on public.offers(warehouse_id);

create unique index commission_config_one_active_global_idx
  on public.commission_config((active))
  where warehouse_id is null and active;

create unique index commission_config_one_active_per_warehouse_idx
  on public.commission_config(warehouse_id)
  where warehouse_id is not null and active;

-- ============================================================
-- 4. Helper functions
-- ============================================================

create or replace function public.current_profile_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_profile_role() = 'admin', false)
$$;

create or replace function public.current_warehouse_status()
returns text language sql stable security definer set search_path = public as $$
  select status from public.warehouses where id = auth.uid()
$$;

create or replace function public.next_order_code()
returns text language sql volatile as $$
  select 'ORD-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('public.order_code_seq')::text, 6, '0')
$$;

create or replace function public.next_sub_order_code()
returns text language sql volatile as $$
  select 'SUB-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('public.sub_order_code_seq')::text, 6, '0')
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.prevent_hard_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'Hard delete is not allowed on %. Use soft-delete fields.', tg_table_name;
end;
$$;

-- ============================================================
-- 5. Utility triggers
-- ============================================================

create trigger offers_set_updated_at
  before update on public.offers
  for each row execute function public.set_updated_at();

create trigger sub_orders_set_updated_at
  before update on public.sub_orders
  for each row execute function public.set_updated_at();

create trigger device_push_tokens_set_updated_at
  before update on public.device_push_tokens
  for each row execute function public.set_updated_at();

create trigger warehouses_prevent_hard_delete
  before delete on public.warehouses
  for each row execute function public.prevent_hard_delete();

create trigger products_prevent_hard_delete
  before delete on public.products
  for each row execute function public.prevent_hard_delete();

create trigger offers_prevent_hard_delete
  before delete on public.offers
  for each row execute function public.prevent_hard_delete();

-- ============================================================
-- 6. Audit trigger
--
-- IMPORTANT: OLD and NEW are NEVER accessed via typed field
-- access (OLD.field / NEW.field).  They are converted to jsonb
-- at the very start of the body and every comparison/read uses
-- the ->> operator, which returns NULL for absent keys instead
-- of throwing 42703.
-- ============================================================

create or replace function public.audit_sensitive_changes()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_actor_id uuid;
  v_action   text;
  v_old      jsonb;
  v_new      jsonb;
  old_json   jsonb;
  new_json   jsonb;
begin
  -- Convert whole rows to jsonb first.
  -- ->> on a jsonb object returns NULL for missing keys — never raises 42703.
  old_json := case when TG_OP <> 'INSERT' then to_jsonb(OLD) else null end;
  new_json := case when TG_OP <> 'DELETE' then to_jsonb(NEW) else null end;

  v_actor_id := auth.uid();

  -- ---- offers ----
  if TG_TABLE_NAME = 'offers' then

    if TG_OP = 'INSERT' then
      v_action := 'offer.create';
      v_new    := new_json;

    elsif TG_OP = 'UPDATE'
      and (old_json->>'is_deleted')::boolean = false
      and (new_json->>'is_deleted')::boolean = true
    then
      v_action := 'offer.delete';
      v_old    := old_json;
      v_new    := new_json;

    elsif TG_OP = 'UPDATE'
      and (
           (old_json->>'price')        is distinct from (new_json->>'price')
        or (old_json->>'discount_pct') is distinct from (new_json->>'discount_pct')
        or (old_json->>'stock')        is distinct from (new_json->>'stock')
        or (old_json->>'is_available') is distinct from (new_json->>'is_available')
      )
    then
      v_action := 'offer.price_stock_change';
      v_old := jsonb_build_object(
        'price',        old_json->>'price',
        'discount_pct', old_json->>'discount_pct',
        'stock',        old_json->>'stock',
        'is_available', old_json->>'is_available'
      );
      v_new := jsonb_build_object(
        'price',        new_json->>'price',
        'discount_pct', new_json->>'discount_pct',
        'stock',        new_json->>'stock',
        'is_available', new_json->>'is_available'
      );
    end if;

  -- ---- warehouses ----
  elsif TG_TABLE_NAME = 'warehouses'
    and TG_OP = 'UPDATE'
    and (old_json->>'status') is distinct from (new_json->>'status')
  then
    v_action := 'warehouse.status_change';
    v_old := jsonb_build_object('status', old_json->>'status');
    v_new := jsonb_build_object('status', new_json->>'status');

  -- ---- commission_config ----
  elsif TG_TABLE_NAME = 'commission_config' then
    v_action := 'commission.update';
    if TG_OP = 'INSERT' then
      v_new := new_json;
    elsif TG_OP = 'UPDATE' then
      v_old := old_json;
      v_new := new_json;
    end if;

  -- ---- orders ----
  elsif TG_TABLE_NAME = 'orders'
    and TG_OP = 'UPDATE'
    and (old_json->>'status') is distinct from (new_json->>'status')
  then
    v_action := 'order.status_change';
    v_old := jsonb_build_object('status', old_json->>'status');
    v_new := jsonb_build_object('status', new_json->>'status');

  -- ---- sub_orders ----
  elsif TG_TABLE_NAME = 'sub_orders'
    and TG_OP = 'UPDATE'
    and (
         (old_json->>'status')        is distinct from (new_json->>'status')
      or (old_json->>'cancel_reason') is distinct from (new_json->>'cancel_reason')
      or (old_json->>'cancelled_by')  is distinct from (new_json->>'cancelled_by')
    )
  then
    v_action := case
      when new_json->>'status' = 'cancelled' then 'order.cancel'
      else 'order.status_change'
    end;
    v_old := jsonb_build_object(
      'status',        old_json->>'status',
      'cancel_reason', old_json->>'cancel_reason',
      'cancelled_by',  old_json->>'cancelled_by'
    );
    v_new := jsonb_build_object(
      'status',        new_json->>'status',
      'cancel_reason', new_json->>'cancel_reason',
      'cancelled_by',  new_json->>'cancelled_by'
    );
  end if;

  if v_action is not null then
    insert into public.audit_log
      (actor_id, action, entity_type, entity_id, old_value, new_value)
    values (
      v_actor_id,
      v_action,
      TG_TABLE_NAME,
      coalesce((new_json->>'id')::uuid, (old_json->>'id')::uuid),
      v_old,
      v_new
    );
  end if;

  -- Return the appropriate row to PostgreSQL's trigger machinery.
  -- NOTE: "return OLD" / "return NEW" returns the whole record, not a field —
  -- this is valid and required; it does NOT trigger error 42703.
  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
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

create trigger orders_audit_sensitive_changes
  after update on public.orders
  for each row execute function public.audit_sensitive_changes();

create trigger sub_orders_audit_sensitive_changes
  after update on public.sub_orders
  for each row execute function public.audit_sensitive_changes();

-- ============================================================
-- 7. handle_new_user — auto-create profile row on signup
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name, phone)
  values (
    NEW.id,
    coalesce(NEW.raw_user_meta_data->>'role', 'pharmacy'),
    coalesce(nullif(trim(NEW.raw_user_meta_data->>'full_name'), ''), 'New User'),
    null
  )
  on conflict (id) do nothing;
  return NEW;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 8. Row Level Security — enable on every table
-- ============================================================

alter table public.profiles            enable row level security;
alter table public.pharmacies          enable row level security;
alter table public.warehouses          enable row level security;
alter table public.products            enable row level security;
alter table public.offers              enable row level security;
alter table public.offer_price_history enable row level security;
alter table public.warehouse_product_map enable row level security;
alter table public.match_review_queue  enable row level security;
alter table public.match_metrics       enable row level security;
alter table public.cart_items          enable row level security;
alter table public.orders              enable row level security;
alter table public.sub_orders          enable row level security;
alter table public.order_items         enable row level security;
alter table public.quick_list          enable row level security;
alter table public.commission_config   enable row level security;
alter table public.brand_dictionary    enable row level security;
alter table public.audit_log           enable row level security;
alter table public.notifications       enable row level security;
alter table public.device_push_tokens  enable row level security;

-- ---- profiles ----
create policy "profiles own select" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles admin select" on public.profiles
  for select using (public.is_admin());

create policy "profiles own insert" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles own update" on public.profiles
  for update
  using  (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

create policy "profiles admin delete" on public.profiles
  for delete using (public.is_admin());

-- ---- pharmacies ----
create policy "pharmacies owner select" on public.pharmacies
  for select using (auth.uid() = id or public.is_admin());

create policy "pharmacies owner insert" on public.pharmacies
  for insert with check (auth.uid() = id);

create policy "pharmacies owner update" on public.pharmacies
  for update
  using  (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

create policy "pharmacies admin delete" on public.pharmacies
  for delete using (public.is_admin());

-- ---- warehouses ----
create policy "warehouses readable active" on public.warehouses
  for select using (
    auth.uid() = id
    or public.is_admin()
    or (status = 'active' and is_deleted = false)
  );

create policy "warehouses owner insert" on public.warehouses
  for insert with check (auth.uid() = id);

-- owner can edit their own row but cannot change status (admin-only via admin_set_warehouse_status)
create policy "warehouses owner update" on public.warehouses
  for update
  using  (auth.uid() = id or public.is_admin())
  with check (
    public.is_admin()
    or (auth.uid() = id and status = public.current_warehouse_status())
  );

create policy "warehouses admin delete" on public.warehouses
  for delete using (public.is_admin());

-- ---- products ----
create policy "products active read" on public.products
  for select using (public.is_admin() or is_deleted = false);

create policy "products admin insert" on public.products
  for insert with check (public.is_admin());

create policy "products admin update" on public.products
  for update using (public.is_admin()) with check (public.is_admin());

create policy "products admin delete" on public.products
  for delete using (public.is_admin());

-- ---- offers ----
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
  for update
  using (warehouse_id = auth.uid() or public.is_admin())
  with check (warehouse_id = auth.uid() or public.is_admin());

create policy "offers admin delete" on public.offers
  for delete using (public.is_admin());

-- ---- offer_price_history ----
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

-- ---- warehouse_product_map ----
create policy "warehouse map owner select" on public.warehouse_product_map
  for select using (warehouse_id = auth.uid() or public.is_admin());

create policy "warehouse map owner insert" on public.warehouse_product_map
  for insert with check (warehouse_id = auth.uid() or public.is_admin());

create policy "warehouse map owner update" on public.warehouse_product_map
  for update
  using (warehouse_id = auth.uid() or public.is_admin())
  with check (warehouse_id = auth.uid() or public.is_admin());

create policy "warehouse map admin delete" on public.warehouse_product_map
  for delete using (public.is_admin());

-- ---- match_review_queue ----
create policy "match queue owner select" on public.match_review_queue
  for select using (warehouse_id = auth.uid() or public.is_admin());

create policy "match queue owner insert" on public.match_review_queue
  for insert with check (warehouse_id = auth.uid() or public.is_admin());

create policy "match queue owner update" on public.match_review_queue
  for update
  using (warehouse_id = auth.uid() or public.is_admin())
  with check (warehouse_id = auth.uid() or public.is_admin());

create policy "match queue admin delete" on public.match_review_queue
  for delete using (public.is_admin());

-- ---- match_metrics ----
create policy "match metrics owner select" on public.match_metrics
  for select using (warehouse_id = auth.uid() or public.is_admin());

create policy "match metrics owner insert" on public.match_metrics
  for insert with check (warehouse_id = auth.uid() or public.is_admin());

create policy "match metrics owner update" on public.match_metrics
  for update
  using (warehouse_id = auth.uid() or public.is_admin())
  with check (warehouse_id = auth.uid() or public.is_admin());

create policy "match metrics admin delete" on public.match_metrics
  for delete using (public.is_admin());

-- ---- cart_items ----
create policy "cart pharmacy select" on public.cart_items
  for select using (pharmacy_id = auth.uid() or public.is_admin());

create policy "cart pharmacy insert" on public.cart_items
  for insert with check (pharmacy_id = auth.uid() or public.is_admin());

create policy "cart pharmacy update" on public.cart_items
  for update
  using (pharmacy_id = auth.uid() or public.is_admin())
  with check (pharmacy_id = auth.uid() or public.is_admin());

create policy "cart pharmacy delete" on public.cart_items
  for delete using (pharmacy_id = auth.uid() or public.is_admin());

-- ---- orders ----
create policy "orders pharmacy select" on public.orders
  for select using (pharmacy_id = auth.uid() or public.is_admin());

create policy "orders warehouse select assigned" on public.orders
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.sub_orders so
      where so.parent_order_id = orders.id and so.warehouse_id = auth.uid()
    )
  );

create policy "orders pharmacy insert" on public.orders
  for insert with check (pharmacy_id = auth.uid() or public.is_admin());

create policy "orders pharmacy update" on public.orders
  for update
  using (pharmacy_id = auth.uid() or public.is_admin())
  with check (pharmacy_id = auth.uid() or public.is_admin());

create policy "orders admin delete" on public.orders
  for delete using (public.is_admin());

-- ---- sub_orders ----
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

create policy "sub orders admin update" on public.sub_orders
  for update using (public.is_admin()) with check (public.is_admin());

create policy "sub orders admin delete" on public.sub_orders
  for delete using (public.is_admin());

-- ---- order_items ----
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

-- ---- quick_list ----
create policy "quick list pharmacy select" on public.quick_list
  for select using (pharmacy_id = auth.uid() or public.is_admin());

create policy "quick list pharmacy insert" on public.quick_list
  for insert with check (pharmacy_id = auth.uid() or public.is_admin());

create policy "quick list pharmacy delete" on public.quick_list
  for delete using (pharmacy_id = auth.uid() or public.is_admin());

create policy "quick list admin update" on public.quick_list
  for update using (public.is_admin()) with check (public.is_admin());

-- ---- commission_config ----
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

-- ---- brand_dictionary ----
create policy "brand dictionary authenticated read" on public.brand_dictionary
  for select using (auth.role() = 'authenticated' or public.is_admin());

create policy "brand dictionary admin insert" on public.brand_dictionary
  for insert with check (public.is_admin());

create policy "brand dictionary admin update" on public.brand_dictionary
  for update using (public.is_admin()) with check (public.is_admin());

create policy "brand dictionary admin delete" on public.brand_dictionary
  for delete using (public.is_admin());

-- ---- audit_log ----
create policy "audit admin read" on public.audit_log
  for select using (public.is_admin());

create policy "audit system insert" on public.audit_log
  for insert with check (public.is_admin() or actor_id = auth.uid() or actor_id is null);

create policy "audit admin update" on public.audit_log
  for update using (public.is_admin()) with check (public.is_admin());

create policy "audit admin delete" on public.audit_log
  for delete using (public.is_admin());

-- ---- notifications ----
create policy "notifications recipient select" on public.notifications
  for select using (recipient_id = auth.uid() or public.is_admin());

create policy "notifications system insert" on public.notifications
  for insert with check (
    recipient_id = auth.uid()
    or public.is_admin()
    or actor_id = auth.uid()
  );

create policy "notifications recipient update" on public.notifications
  for update
  using (recipient_id = auth.uid() or public.is_admin())
  with check (recipient_id = auth.uid() or public.is_admin());

create policy "notifications admin delete" on public.notifications
  for delete using (public.is_admin());

-- ---- device_push_tokens ----
create policy "device tokens owner select" on public.device_push_tokens
  for select using (profile_id = auth.uid() or public.is_admin());

create policy "device tokens owner insert" on public.device_push_tokens
  for insert with check (profile_id = auth.uid() or public.is_admin());

create policy "device tokens owner update" on public.device_push_tokens
  for update
  using (profile_id = auth.uid() or public.is_admin())
  with check (profile_id = auth.uid() or public.is_admin());

create policy "device tokens owner delete" on public.device_push_tokens
  for delete using (profile_id = auth.uid() or public.is_admin());

-- ============================================================
-- 9. Table-level grants
-- RLS filters rows; these grants allow the roles to attempt
-- queries at all. Without them PostgreSQL denies before RLS runs.
-- ============================================================

grant usage on schema public to authenticated, anon;

grant select, insert, update         on public.profiles              to authenticated;
grant select, insert, update         on public.pharmacies            to authenticated;
grant select, insert, update         on public.warehouses            to authenticated;
grant select                         on public.products              to authenticated, anon;
grant select                         on public.offers                to authenticated, anon;
grant select                         on public.offer_price_history   to authenticated;
grant select                         on public.warehouse_product_map to authenticated;
grant select, insert, update         on public.match_review_queue    to authenticated;
grant select, insert                 on public.match_metrics         to authenticated;
grant select, insert, update, delete on public.cart_items            to authenticated;
grant select, insert                 on public.orders                to authenticated;
grant select                         on public.sub_orders            to authenticated;
grant select                         on public.order_items           to authenticated;
grant select, insert, update, delete on public.quick_list            to authenticated;
grant select                         on public.commission_config     to authenticated;
grant select                         on public.brand_dictionary      to authenticated, anon;
grant select, insert                 on public.audit_log             to authenticated;
grant select, insert, update         on public.notifications         to authenticated;
grant select, insert, update, delete on public.device_push_tokens    to authenticated;

grant usage on sequence public.order_code_seq     to authenticated;
grant usage on sequence public.sub_order_code_seq to authenticated;

-- ============================================================
-- 10. Business logic RPCs
-- ============================================================

create or replace function public.search_products(
  search_query text,
  result_limit integer default 30
)
returns table (
  id             uuid,
  product_code   text,
  canonical_name text,
  normalized_key text,
  brand          text,
  strength       text,
  form           text,
  pack_size      text,
  rank           real
)
language sql stable
as $$
  with prepared as (
    select
      nullif(trim(search_query), '') as q,
      plainto_tsquery('simple', nullif(trim(search_query), '')) as tsq
  )
  select
    p.id, p.product_code, p.canonical_name, p.normalized_key,
    p.brand, p.strength, p.form, p.pack_size,
    ts_rank(
      to_tsvector('simple',
        coalesce(p.canonical_name,    '') || ' ' ||
        coalesce(p.normalized_key,    '') || ' ' ||
        coalesce(p.brand,             '') || ' ' ||
        coalesce(p.active_ingredient, '') || ' ' ||
        coalesce(p.product_code,      '')
      ),
      prepared.tsq
    ) as rank
  from public.products p
  cross join prepared
  where p.is_deleted = false
    and prepared.q is not null
    and (
      to_tsvector('simple',
        coalesce(p.canonical_name,    '') || ' ' ||
        coalesce(p.normalized_key,    '') || ' ' ||
        coalesce(p.brand,             '') || ' ' ||
        coalesce(p.active_ingredient, '') || ' ' ||
        coalesce(p.product_code,      '')
      ) @@ prepared.tsq
      or p.canonical_name ilike '%' || prepared.q || '%'
      or p.normalized_key ilike '%' || prepared.q || '%'
      or p.product_code   ilike '%' || prepared.q || '%'
    )
  order by rank desc, p.canonical_name asc
  limit greatest(1, least(result_limit, 100));
$$;

create or replace function public.snapshot_offer_prices()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  inserted_count integer;
begin
  insert into public.offer_price_history
    (offer_id, warehouse_id, product_id, price, discount_pct, stock, snapshot_date)
  select o.id, o.warehouse_id, o.product_id, o.price, o.discount_pct, o.stock, current_date
  from   public.offers     o
  join   public.products   p on p.id = o.product_id
  join   public.warehouses w on w.id = o.warehouse_id
  where  o.is_deleted    = false
    and  p.is_deleted    = false
    and  w.is_deleted    = false
    and  o.is_available  = true
  on conflict (offer_id, snapshot_date) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.recompute_order_status(p_order_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_total     integer;
  v_delivered integer;
  v_cancelled integer;
  v_rejected  integer;
  v_shipped   integer;
  v_preparing integer;
  v_accepted  integer;
  v_status    text;
begin
  select
    count(*),
    count(*) filter (where status = 'delivered'),
    count(*) filter (where status = 'cancelled'),
    count(*) filter (where status = 'rejected'),
    count(*) filter (where status = 'shipped'),
    count(*) filter (where status = 'preparing'),
    count(*) filter (where status = 'accepted')
  into v_total, v_delivered, v_cancelled, v_rejected, v_shipped, v_preparing, v_accepted
  from public.sub_orders
  where parent_order_id = p_order_id;

  v_status := case
    when v_total = 0                          then 'pending'
    when v_delivered = v_total                then 'completed'
    when (v_cancelled + v_rejected) = v_total then 'cancelled'
    when v_delivered > 0                      then 'partial'
    when v_shipped   > 0                      then 'shipped'
    when v_preparing > 0                      then 'preparing'
    when v_accepted  > 0                      then 'accepted'
    else 'pending'
  end;

  update public.orders
  set    status = v_status
  where  id = p_order_id and status is distinct from v_status;

  return v_status;
end;
$$;

create or replace function public.notify_order_party(
  p_sub_order_id uuid,
  p_actor_id     uuid,
  p_message      text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_pharmacy_id  uuid;
  v_warehouse_id uuid;
  v_recipient_id uuid;
begin
  select o.pharmacy_id, so.warehouse_id
  into   v_pharmacy_id,  v_warehouse_id
  from   public.sub_orders so
  join   public.orders     o  on o.id = so.parent_order_id
  where  so.id = p_sub_order_id;

  v_recipient_id := case
    when p_actor_id = v_pharmacy_id then v_warehouse_id
    else v_pharmacy_id
  end;

  if v_recipient_id is not null then
    insert into public.notifications
      (recipient_id, actor_id, entity_type, entity_id, message)
    values
      (v_recipient_id, p_actor_id, 'sub_orders', p_sub_order_id, p_message);
  end if;
end;
$$;

create or replace function public.update_sub_order_status(
  p_sub_order_id uuid,
  p_status       text,
  p_reason       text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_actor_id  uuid := auth.uid();
  v_sub_order public.sub_orders%rowtype;
  v_order_id  uuid;
begin
  if p_status not in ('accepted','preparing','shipped','delivered','rejected') then
    raise exception 'Unsupported status.';
  end if;

  select * into v_sub_order
  from   public.sub_orders
  where  id = p_sub_order_id
  for update;

  if not found then raise exception 'Sub-order not found.'; end if;

  if public.current_profile_role() <> 'warehouse'
     or v_sub_order.warehouse_id <> v_actor_id
  then
    raise exception 'Only the assigned warehouse can update this sub-order.';
  end if;

  if    p_status = 'accepted'  and v_sub_order.status <> 'pending'   then raise exception 'Only pending sub-orders can be accepted.';
  elsif p_status = 'preparing' and v_sub_order.status <> 'accepted'  then raise exception 'Only accepted sub-orders can move to preparing.';
  elsif p_status = 'shipped'   and v_sub_order.status <> 'preparing' then raise exception 'Only preparing sub-orders can be shipped.';
  elsif p_status = 'delivered' and v_sub_order.status <> 'shipped'   then raise exception 'Only shipped sub-orders can be delivered.';
  elsif p_status = 'rejected'  and v_sub_order.status <> 'pending'   then raise exception 'Only pending sub-orders can be rejected.';
  end if;

  update public.sub_orders
  set
    status        = p_status,
    cancel_reason = case when p_status = 'rejected' then nullif(p_reason,'') else cancel_reason end,
    cancelled_by  = case when p_status = 'rejected' then v_actor_id          else cancelled_by  end
  where id = p_sub_order_id
  returning parent_order_id into v_order_id;

  perform public.recompute_order_status(v_order_id);
  perform public.notify_order_party(p_sub_order_id, v_actor_id,
    'تم تحديث حالة الطلب الفرعي إلى ' || p_status);

  return p_sub_order_id;
end;
$$;

create or replace function public.cancel_sub_order(
  p_sub_order_id uuid,
  p_reason       text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_actor_id    uuid := auth.uid();
  v_actor_role  text := public.current_profile_role();
  v_sub_order   public.sub_orders%rowtype;
  v_pharmacy_id uuid;
  v_order_id    uuid;
begin
  select so.* into v_sub_order
  from   public.sub_orders so
  where  so.id = p_sub_order_id
  for update;

  if not found then raise exception 'Sub-order not found.'; end if;

  select o.pharmacy_id into v_pharmacy_id
  from   public.orders o
  where  o.id = v_sub_order.parent_order_id;

  if nullif(trim(p_reason), '') is null then
    raise exception 'Cancellation reason is required.';
  end if;

  if v_actor_role = 'pharmacy' then
    if v_pharmacy_id <> v_actor_id then
      raise exception 'Pharmacist cannot cancel this sub-order.';
    end if;
    if v_sub_order.status in ('shipped','delivered','cancelled','rejected') then
      raise exception 'This sub-order can no longer be cancelled by the pharmacy.';
    end if;
  elsif v_actor_role = 'warehouse' then
    if v_sub_order.warehouse_id <> v_actor_id then
      raise exception 'Warehouse cannot cancel this sub-order.';
    end if;
    if v_sub_order.status in ('delivered','cancelled','rejected') then
      raise exception 'This sub-order can no longer be cancelled by the warehouse.';
    end if;
  else
    raise exception 'Only pharmacies and warehouses can cancel sub-orders.';
  end if;

  update public.sub_orders
  set    status = 'cancelled', cancel_reason = p_reason, cancelled_by = v_actor_id
  where  id = p_sub_order_id
  returning parent_order_id into v_order_id;

  perform public.recompute_order_status(v_order_id);
  perform public.notify_order_party(p_sub_order_id, v_actor_id,
    'تم إلغاء الطلب الفرعي: ' || p_reason);

  return p_sub_order_id;
end;
$$;

create or replace function public.create_order_from_cart()
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_pharmacy_id       uuid := auth.uid();
  v_order_id          uuid;
  v_order_code        text;
  v_total             numeric(12,2);
  v_sub_order         record;
  v_sub_order_id      uuid;
  v_sub_order_code    text;
  v_commission_pct    numeric(5,2);
  v_commission_amount numeric(12,2);
begin
  if public.current_profile_role() <> 'pharmacy' then
    raise exception 'Only pharmacy users can create orders.';
  end if;

  select coalesce(sum(
    round(ci.quantity * o.price * (1 - (o.discount_pct / 100.0)), 2)
  ), 0)
  into v_total
  from   public.cart_items ci
  join   public.offers     o  on o.id = ci.offer_id
  join   public.products   p  on p.id = o.product_id
  join   public.warehouses w  on w.id = o.warehouse_id
  where  ci.pharmacy_id = v_pharmacy_id
    and  ci.quantity    > 0
    and  o.is_available = true
    and  o.is_deleted   = false
    and  p.is_deleted   = false
    and  w.is_deleted   = false
    and  w.status       = 'active';

  if v_total <= 0 then raise exception 'Cart has no active offers.'; end if;

  v_order_code := public.next_order_code();

  insert into public.orders (order_code, pharmacy_id, total_amount)
  values (v_order_code, v_pharmacy_id, v_total)
  returning id into v_order_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, new_value)
  values (v_pharmacy_id, 'order.create', 'orders', v_order_id,
    jsonb_build_object('order_code', v_order_code,
                       'pharmacy_id', v_pharmacy_id,
                       'total_amount', v_total,
                       'status', 'pending'));

  for v_sub_order in
    select
      o.warehouse_id,
      w.warehouse_name,
      round(sum(ci.quantity * o.price * (1 - (o.discount_pct / 100.0))), 2) as subtotal
    from   public.cart_items ci
    join   public.offers     o  on o.id = ci.offer_id
    join   public.products   p  on p.id = o.product_id
    join   public.warehouses w  on w.id = o.warehouse_id
    where  ci.pharmacy_id = v_pharmacy_id
      and  ci.quantity    > 0
      and  o.is_available = true
      and  o.is_deleted   = false
      and  p.is_deleted   = false
      and  w.is_deleted   = false
      and  w.status       = 'active'
    group by o.warehouse_id, w.warehouse_name
  loop
    select cc.commission_pct
    into   v_commission_pct
    from   public.commission_config cc
    where  cc.active = true
      and  (cc.warehouse_id = v_sub_order.warehouse_id or cc.warehouse_id is null)
    order  by cc.warehouse_id is null
    limit  1;

    v_commission_pct    := coalesce(v_commission_pct, 5);
    v_commission_amount := round(v_sub_order.subtotal * (v_commission_pct / 100.0), 2);
    v_sub_order_code    := public.next_sub_order_code();

    insert into public.sub_orders (
      sub_order_code, parent_order_id, warehouse_id,
      subtotal, commission_pct, commission_amount
    ) values (
      v_sub_order_code, v_order_id, v_sub_order.warehouse_id,
      v_sub_order.subtotal, v_commission_pct, v_commission_amount
    ) returning id into v_sub_order_id;

    insert into public.audit_log (actor_id, action, entity_type, entity_id, new_value)
    values (v_pharmacy_id, 'sub_order.status_initial', 'sub_orders', v_sub_order_id,
      jsonb_build_object(
        'sub_order_code',    v_sub_order_code,
        'parent_order_id',   v_order_id,
        'warehouse_id',      v_sub_order.warehouse_id,
        'warehouse_name',    v_sub_order.warehouse_name,
        'status',            'pending',
        'subtotal',          v_sub_order.subtotal,
        'commission_pct',    v_commission_pct,
        'commission_amount', v_commission_amount
      ));

    insert into public.notifications
      (recipient_id, actor_id, entity_type, entity_id, message)
    values
      (v_sub_order.warehouse_id, v_pharmacy_id,
       'sub_orders', v_sub_order_id,
       'طلب جديد بانتظار المراجعة: ' || v_sub_order_code);

    insert into public.order_items (
      sub_order_id, product_id, product_name, warehouse_name,
      unit_price, discount_pct, quantity, line_total
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
    from   public.cart_items ci
    join   public.offers     o  on o.id = ci.offer_id
    join   public.products   p  on p.id = o.product_id
    join   public.warehouses w  on w.id = o.warehouse_id
    where  ci.pharmacy_id  = v_pharmacy_id
      and  o.warehouse_id  = v_sub_order.warehouse_id
      and  ci.quantity      > 0
      and  o.is_available   = true
      and  o.is_deleted     = false
      and  p.is_deleted     = false
      and  w.is_deleted     = false
      and  w.status         = 'active';
  end loop;

  delete from public.cart_items where pharmacy_id = v_pharmacy_id;
  return v_order_id;
end;
$$;

-- ============================================================
-- 10. Admin RPCs
-- ============================================================

create or replace function public.admin_set_warehouse_status(
  p_warehouse_id uuid,
  p_status       text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can update warehouse status.';
  end if;
  if p_status not in ('pending','active','suspended') then
    raise exception 'Unsupported warehouse status.';
  end if;
  update public.warehouses set status = p_status
  where  id = p_warehouse_id and is_deleted = false;
end;
$$;

create or replace function public.admin_set_commission_rate(
  p_warehouse_id   uuid,
  p_commission_pct numeric
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_config_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can update commission rates.';
  end if;
  if p_commission_pct < 0 or p_commission_pct > 100 then
    raise exception 'Commission percentage must be between 0 and 100.';
  end if;

  update public.commission_config
  set    active = false
  where  active = true
    and  (
           (p_warehouse_id is null and warehouse_id is null)
           or warehouse_id = p_warehouse_id
         );

  insert into public.commission_config (warehouse_id, commission_pct, active)
  values (p_warehouse_id, p_commission_pct, true)
  returning id into v_config_id;

  return v_config_id;
end;
$$;

create or replace function public.admin_update_product(
  p_product_id   uuid,
  p_product_code text,
  p_is_verified  boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can update products.';
  end if;
  update public.products
  set    product_code = nullif(trim(p_product_code), ''),
         is_verified  = p_is_verified
  where  id = p_product_id and is_deleted = false;
end;
$$;

create or replace function public.admin_merge_products(
  p_source_product_id uuid,
  p_target_product_id uuid
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_actor_id            uuid := auth.uid();
  v_affected_warehouses uuid[];
begin
  if not public.is_admin() then
    raise exception 'Only admins can merge products.';
  end if;
  if p_source_product_id = p_target_product_id then
    raise exception 'Source and target products must be different.';
  end if;
  if not exists (
    select 1 from public.products where id = p_source_product_id and is_deleted = false
  ) then raise exception 'Source product not found.'; end if;
  if not exists (
    select 1 from public.products where id = p_target_product_id and is_deleted = false
  ) then raise exception 'Target product not found.'; end if;

  select coalesce(array_agg(distinct warehouse_id), '{}')
  into   v_affected_warehouses
  from (
    select warehouse_id from public.offers
    where  product_id = p_source_product_id and is_deleted = false
    union
    select created_from_warehouse from public.products
    where  id = p_source_product_id and created_from_warehouse is not null
  ) x;

  update public.offers src
  set    is_deleted = true, deleted_at = now(), deleted_by = v_actor_id
  where  src.product_id = p_source_product_id
    and  src.is_deleted  = false
    and  exists (
           select 1 from public.offers tgt
           where  tgt.warehouse_id = src.warehouse_id
             and  tgt.product_id   = p_target_product_id
         );

  update public.offers
  set    product_id = p_target_product_id
  where  product_id = p_source_product_id and is_deleted = false;

  update public.warehouse_product_map
  set    product_id = p_target_product_id, confirmed = true
  where  product_id = p_source_product_id;

  update public.match_review_queue
  set    suggested_product_id = p_target_product_id
  where  suggested_product_id = p_source_product_id;

  update public.products
  set    is_deleted = true, deleted_at = now(), deleted_by = v_actor_id
  where  id = p_source_product_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, old_value, new_value)
  values (v_actor_id, 'product.merge', 'products', p_target_product_id,
    jsonb_build_object('source_product_id', p_source_product_id),
    jsonb_build_object('target_product_id', p_target_product_id));

  with latest_metric as (
    select id from public.match_metrics
    where  warehouse_id = any(v_affected_warehouses)
    order  by created_at desc limit 1
  )
  update public.match_metrics
  set    corrected_count = corrected_count + 1
  where  id in (select id from latest_metric);
end;
$$;

create or replace function public.admin_dashboard_stats()
returns table (
  active_warehouses    bigint,
  orders_count         bigint,
  total_commission_due numeric
)
language sql stable security definer set search_path = public
as $$
  select
    (select count(*) from public.warehouses  where status = 'active' and is_deleted = false),
    (select count(*) from public.orders),
    (select coalesce(sum(commission_amount), 0)
     from   public.sub_orders where status not in ('cancelled','rejected'))
  where public.is_admin();
$$;

-- ============================================================
-- 11. Daily price-snapshot cron job
-- ============================================================

select cron.unschedule('daily-offer-price-snapshot')
where exists (select 1 from cron.job where jobname = 'daily-offer-price-snapshot');

select cron.schedule(
  'daily-offer-price-snapshot',
  '15 0 * * *',
  $$select public.snapshot_offer_prices();$$
);

-- ============================================================
-- 12. Realtime publications
-- ============================================================

do $$
declare
  t record;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;

  for t in
    select schemaname, tablename
    from   pg_publication_tables
    where  pubname    = 'supabase_realtime'
      and  schemaname = 'public'
      and  tablename  not in ('offers','sub_orders','orders','notifications')
  loop
    execute format('alter publication supabase_realtime drop table %I.%I',
                   t.schemaname, t.tablename);
  end loop;

  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and tablename='offers') then
    alter publication supabase_realtime add table public.offers;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and tablename='sub_orders') then
    alter publication supabase_realtime add table public.sub_orders;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and tablename='orders') then
    alter publication supabase_realtime add table public.orders;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ============================================================
-- 13. Seed data
-- ============================================================

insert into public.commission_config (warehouse_id, commission_pct, active)
values (null, 5, true)
on conflict do nothing;
