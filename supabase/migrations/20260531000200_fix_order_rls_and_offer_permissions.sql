-- Cross-table order policies must not query each other under RLS. These
-- SECURITY DEFINER helpers evaluate access without recursively re-entering the
-- orders/sub_orders policies.
create or replace function public.current_pharmacy_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.pharmacies p
  where p.id = auth.uid()
$$;

create or replace function public.current_warehouse_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select w.id
  from public.warehouses w
  where w.id = auth.uid()
$$;

create or replace function public.can_access_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or exists (
      select 1
      from public.orders o
      where o.id = p_order_id
        and o.pharmacy_id = public.current_pharmacy_id()
    )
    or exists (
      select 1
      from public.sub_orders so
      where so.parent_order_id = p_order_id
        and so.warehouse_id = public.current_warehouse_id()
    )
$$;

create or replace function public.can_access_sub_order(p_sub_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or exists (
      select 1
      from public.sub_orders so
      join public.orders o on o.id = so.parent_order_id
      where so.id = p_sub_order_id
        and (
          so.warehouse_id = public.current_warehouse_id()
          or o.pharmacy_id = public.current_pharmacy_id()
        )
    )
$$;

revoke all on function public.current_pharmacy_id() from public;
revoke all on function public.current_warehouse_id() from public;
revoke all on function public.can_access_order(uuid) from public;
revoke all on function public.can_access_sub_order(uuid) from public;

grant execute on function public.current_pharmacy_id() to authenticated;
grant execute on function public.current_warehouse_id() to authenticated, anon;
grant execute on function public.can_access_order(uuid) to authenticated;
grant execute on function public.can_access_sub_order(uuid) to authenticated;

drop policy if exists "orders pharmacy select" on public.orders;
drop policy if exists "orders warehouse select assigned" on public.orders;
drop policy if exists "orders accessible select" on public.orders;
create policy "orders accessible select" on public.orders
for select
using (public.can_access_order(id));

drop policy if exists "sub orders owner select" on public.sub_orders;
drop policy if exists "sub orders accessible select" on public.sub_orders;
create policy "sub orders accessible select" on public.sub_orders
for select
using (public.can_access_sub_order(id));

drop policy if exists "sub orders warehouse update" on public.sub_orders;
drop policy if exists "sub orders admin update" on public.sub_orders;
create policy "sub orders admin update" on public.sub_orders
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "order items owner select" on public.order_items;
drop policy if exists "order items accessible select" on public.order_items;
create policy "order items accessible select" on public.order_items
for select
using (public.can_access_sub_order(sub_order_id));

-- GRANT controls table-level capability; RLS below still limits each warehouse
-- to its own rows and preserves read-only available-offer access for pharmacies.
grant select, insert on public.offers to authenticated;
revoke update on public.offers from authenticated;
grant update (price, stock, discount_pct, is_available, updated_at)
on public.offers to authenticated;

drop policy if exists "offers readable available" on public.offers;
create policy "offers readable available" on public.offers
for select
using (
  public.is_admin()
  or warehouse_id = public.current_warehouse_id()
  or (
    is_available = true
    and is_deleted = false
    and exists (
      select 1
      from public.products p
      where p.id = product_id
        and p.is_deleted = false
    )
  )
);

drop policy if exists "offers warehouse insert" on public.offers;
create policy "offers warehouse insert" on public.offers
for insert
with check (
  public.is_admin()
  or warehouse_id = public.current_warehouse_id()
);

drop policy if exists "offers warehouse update" on public.offers;
create policy "offers warehouse update" on public.offers
for update
using (
  public.is_admin()
  or warehouse_id = public.current_warehouse_id()
)
with check (
  public.is_admin()
  or warehouse_id = public.current_warehouse_id()
);

do $$
begin
  if not has_table_privilege('authenticated', 'public.offers', 'select')
    or not has_table_privilege('authenticated', 'public.offers', 'insert')
    or has_table_privilege('authenticated', 'public.offers', 'update')
    or not has_column_privilege('authenticated', 'public.offers', 'price', 'update')
    or not has_column_privilege('authenticated', 'public.offers', 'stock', 'update')
    or not has_column_privilege('authenticated', 'public.offers', 'discount_pct', 'update')
    or not has_column_privilege('authenticated', 'public.offers', 'is_available', 'update')
    or not has_column_privilege('authenticated', 'public.offers', 'updated_at', 'update')
  then
    raise exception 'authenticated offers grants are incomplete';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('orders', 'sub_orders', 'order_items')
      and (
        coalesce(qual, '') ~ 'from public\.orders'
        or coalesce(qual, '') ~ 'from public\.sub_orders'
      )
  ) then
    raise exception 'recursive order RLS policy remains';
  end if;
end
$$;
