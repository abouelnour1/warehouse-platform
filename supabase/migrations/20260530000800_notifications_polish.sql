create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios', 'web')),
  token text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, token)
);

alter table public.device_push_tokens enable row level security;

create policy "device tokens owner select" on public.device_push_tokens
for select using (profile_id = auth.uid() or public.is_admin());

create policy "device tokens owner insert" on public.device_push_tokens
for insert with check (profile_id = auth.uid() or public.is_admin());

create policy "device tokens owner update" on public.device_push_tokens
for update using (profile_id = auth.uid() or public.is_admin())
with check (profile_id = auth.uid() or public.is_admin());

create policy "device tokens owner delete" on public.device_push_tokens
for delete using (profile_id = auth.uid() or public.is_admin());

create trigger device_push_tokens_set_updated_at
before update on public.device_push_tokens
for each row execute function public.set_updated_at();

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

create or replace function public.create_order_from_cart()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pharmacy_id uuid := auth.uid();
  v_order_id uuid;
  v_order_code text;
  v_total numeric(12, 2);
  v_sub_order record;
  v_sub_order_id uuid;
  v_sub_order_code text;
  v_commission_pct numeric(5, 2);
  v_commission_amount numeric(12, 2);
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

  v_order_code := public.next_order_code();

  insert into public.orders (order_code, pharmacy_id, total_amount)
  values (v_order_code, v_pharmacy_id, v_total)
  returning id into v_order_id;

  insert into public.audit_log (
    actor_id,
    action,
    entity_type,
    entity_id,
    old_value,
    new_value
  )
  values (
    v_pharmacy_id,
    'order.create',
    'orders',
    v_order_id,
    null,
    jsonb_build_object(
      'order_code', v_order_code,
      'pharmacy_id', v_pharmacy_id,
      'total_amount', v_total,
      'status', 'pending'
    )
  );

  for v_sub_order in
    select
      o.warehouse_id,
      w.warehouse_name,
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
    group by o.warehouse_id, w.warehouse_name
  loop
    select cc.commission_pct
    into v_commission_pct
    from public.commission_config cc
    where cc.active = true
      and (cc.warehouse_id = v_sub_order.warehouse_id or cc.warehouse_id is null)
    order by cc.warehouse_id is null
    limit 1;

    v_commission_pct := coalesce(v_commission_pct, 5);
    v_commission_amount := round(v_sub_order.subtotal * (v_commission_pct / 100.0), 2);
    v_sub_order_code := public.next_sub_order_code();

    insert into public.sub_orders (
      sub_order_code,
      parent_order_id,
      warehouse_id,
      subtotal,
      commission_pct,
      commission_amount
    )
    values (
      v_sub_order_code,
      v_order_id,
      v_sub_order.warehouse_id,
      v_sub_order.subtotal,
      v_commission_pct,
      v_commission_amount
    )
    returning id into v_sub_order_id;

    insert into public.audit_log (
      actor_id,
      action,
      entity_type,
      entity_id,
      old_value,
      new_value
    )
    values (
      v_pharmacy_id,
      'sub_order.status_initial',
      'sub_orders',
      v_sub_order_id,
      null,
      jsonb_build_object(
        'sub_order_code', v_sub_order_code,
        'parent_order_id', v_order_id,
        'warehouse_id', v_sub_order.warehouse_id,
        'warehouse_name', v_sub_order.warehouse_name,
        'status', 'pending',
        'subtotal', v_sub_order.subtotal,
        'commission_pct', v_commission_pct,
        'commission_amount', v_commission_amount
      )
    );

    insert into public.notifications (
      recipient_id,
      actor_id,
      entity_type,
      entity_id,
      message
    )
    values (
      v_sub_order.warehouse_id,
      v_pharmacy_id,
      'sub_orders',
      v_sub_order_id,
      'طلب جديد بانتظار المراجعة: ' || v_sub_order_code
    );

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
      and ci.quantity > 0
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
