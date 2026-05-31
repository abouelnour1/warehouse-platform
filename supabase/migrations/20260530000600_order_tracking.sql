alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
check (status in (
  'pending',
  'accepted',
  'preparing',
  'shipped',
  'delivered',
  'cancelled',
  'rejected',
  'partial',
  'completed'
));

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id),
  actor_id uuid references public.profiles(id),
  entity_type text not null,
  entity_id uuid not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

create policy "notifications recipient select" on public.notifications
for select using (recipient_id = auth.uid() or public.is_admin());

create policy "notifications system insert" on public.notifications
for insert with check (recipient_id = auth.uid() or public.is_admin() or actor_id = auth.uid());

create policy "notifications recipient update" on public.notifications
for update using (recipient_id = auth.uid() or public.is_admin())
with check (recipient_id = auth.uid() or public.is_admin());

create policy "notifications admin delete" on public.notifications
for delete using (public.is_admin());

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
  elsif tg_table_name = 'orders' and tg_op = 'UPDATE'
    and old.status is distinct from new.status then
    v_action := 'order.status_change';
    v_old := jsonb_build_object('status', old.status);
    v_new := jsonb_build_object('status', new.status);
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

drop trigger if exists orders_audit_sensitive_changes on public.orders;
create trigger orders_audit_sensitive_changes
after update on public.orders
for each row execute function public.audit_sensitive_changes();

create or replace function public.recompute_order_status(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_delivered integer;
  v_cancelled integer;
  v_rejected integer;
  v_shipped integer;
  v_preparing integer;
  v_accepted integer;
  v_status text;
begin
  select
    count(*),
    count(*) filter (where status = 'delivered'),
    count(*) filter (where status = 'cancelled'),
    count(*) filter (where status = 'rejected'),
    count(*) filter (where status = 'shipped'),
    count(*) filter (where status = 'preparing'),
    count(*) filter (where status = 'accepted')
  into
    v_total,
    v_delivered,
    v_cancelled,
    v_rejected,
    v_shipped,
    v_preparing,
    v_accepted
  from public.sub_orders
  where parent_order_id = p_order_id;

  v_status := case
    when v_total = 0 then 'pending'
    when v_delivered = v_total then 'completed'
    when (v_cancelled + v_rejected) = v_total then 'cancelled'
    when v_delivered > 0 then 'partial'
    when v_shipped > 0 then 'shipped'
    when v_preparing > 0 then 'preparing'
    when v_accepted > 0 then 'accepted'
    else 'pending'
  end;

  update public.orders
  set status = v_status
  where id = p_order_id
    and status is distinct from v_status;

  return v_status;
end;
$$;

create or replace function public.notify_order_party(
  p_sub_order_id uuid,
  p_actor_id uuid,
  p_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pharmacy_id uuid;
  v_warehouse_id uuid;
  v_recipient_id uuid;
begin
  select o.pharmacy_id, so.warehouse_id
  into v_pharmacy_id, v_warehouse_id
  from public.sub_orders so
  join public.orders o on o.id = so.parent_order_id
  where so.id = p_sub_order_id;

  v_recipient_id := case
    when p_actor_id = v_pharmacy_id then v_warehouse_id
    else v_pharmacy_id
  end;

  if v_recipient_id is not null then
    insert into public.notifications (
      recipient_id,
      actor_id,
      entity_type,
      entity_id,
      message
    )
    values (
      v_recipient_id,
      p_actor_id,
      'sub_orders',
      p_sub_order_id,
      p_message
    );
  end if;
end;
$$;

create or replace function public.update_sub_order_status(
  p_sub_order_id uuid,
  p_status text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_sub_order public.sub_orders%rowtype;
  v_order_id uuid;
begin
  if p_status not in ('accepted', 'preparing', 'shipped', 'delivered', 'rejected') then
    raise exception 'Unsupported status.';
  end if;

  select *
  into v_sub_order
  from public.sub_orders
  where id = p_sub_order_id
  for update;

  if not found then
    raise exception 'Sub-order not found.';
  end if;

  if public.current_profile_role() <> 'warehouse' or v_sub_order.warehouse_id <> v_actor_id then
    raise exception 'Only the assigned warehouse can update this sub-order.';
  end if;

  if p_status = 'accepted' and v_sub_order.status <> 'pending' then
    raise exception 'Only pending sub-orders can be accepted.';
  elsif p_status = 'preparing' and v_sub_order.status <> 'accepted' then
    raise exception 'Only accepted sub-orders can move to preparing.';
  elsif p_status = 'shipped' and v_sub_order.status <> 'preparing' then
    raise exception 'Only preparing sub-orders can be shipped.';
  elsif p_status = 'delivered' and v_sub_order.status <> 'shipped' then
    raise exception 'Only shipped sub-orders can be delivered.';
  elsif p_status = 'rejected' and v_sub_order.status <> 'pending' then
    raise exception 'Only pending sub-orders can be rejected.';
  end if;

  update public.sub_orders
  set
    status = p_status,
    cancel_reason = case when p_status = 'rejected' then nullif(p_reason, '') else cancel_reason end,
    cancelled_by = case when p_status = 'rejected' then v_actor_id else cancelled_by end
  where id = p_sub_order_id
  returning parent_order_id into v_order_id;

  perform public.recompute_order_status(v_order_id);
  perform public.notify_order_party(
    p_sub_order_id,
    v_actor_id,
    'تم تحديث حالة الطلب الفرعي إلى ' || p_status
  );

  return p_sub_order_id;
end;
$$;

create or replace function public.cancel_sub_order(
  p_sub_order_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text := public.current_profile_role();
  v_sub_order public.sub_orders%rowtype;
  v_pharmacy_id uuid;
  v_order_id uuid;
begin
  select so.*
  into v_sub_order
  from public.sub_orders so
  where so.id = p_sub_order_id
  for update;

  if not found then
    raise exception 'Sub-order not found.';
  end if;

  select o.pharmacy_id
  into v_pharmacy_id
  from public.orders o
  where o.id = v_sub_order.parent_order_id;

  if nullif(trim(p_reason), '') is null then
    raise exception 'Cancellation reason is required.';
  end if;

  if v_actor_role = 'pharmacy' then
    if v_pharmacy_id <> v_actor_id then
      raise exception 'Pharmacist cannot cancel this sub-order.';
    end if;
    if v_sub_order.status in ('shipped', 'delivered', 'cancelled', 'rejected') then
      raise exception 'This sub-order can no longer be cancelled by the pharmacy.';
    end if;
  elsif v_actor_role = 'warehouse' then
    if v_sub_order.warehouse_id <> v_actor_id then
      raise exception 'Warehouse cannot cancel this sub-order.';
    end if;
    if v_sub_order.status in ('delivered', 'cancelled', 'rejected') then
      raise exception 'This sub-order can no longer be cancelled by the warehouse.';
    end if;
  else
    raise exception 'Only pharmacies and warehouses can cancel sub-orders.';
  end if;

  update public.sub_orders
  set
    status = 'cancelled',
    cancel_reason = p_reason,
    cancelled_by = v_actor_id
  where id = p_sub_order_id
  returning parent_order_id into v_order_id;

  perform public.recompute_order_status(v_order_id);
  perform public.notify_order_party(
    p_sub_order_id,
    v_actor_id,
    'تم إلغاء الطلب الفرعي: ' || p_reason
  );

  return p_sub_order_id;
end;
$$;

create policy "orders warehouse select assigned" on public.orders
for select using (
  public.is_admin()
  or exists (
    select 1
    from public.sub_orders so
    where so.parent_order_id = orders.id
      and so.warehouse_id = auth.uid()
  )
);

drop policy if exists "sub orders warehouse update" on public.sub_orders;

create policy "sub orders admin update" on public.sub_orders
for update using (public.is_admin())
with check (public.is_admin());

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'sub_orders'
    ) then
      alter publication supabase_realtime add table public.sub_orders;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'orders'
    ) then
      alter publication supabase_realtime add table public.orders;
    end if;
  end if;
end $$;
