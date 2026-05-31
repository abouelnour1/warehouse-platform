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
  v_invalid record;
begin
  if public.current_profile_role() <> 'pharmacy' then
    raise exception 'Only pharmacy users can create orders.';
  end if;

  if not exists (
    select 1
    from public.cart_items ci
    where ci.pharmacy_id = v_pharmacy_id
  ) then
    raise exception 'Cart is empty.';
  end if;

  -- Lock in a stable order so concurrent checkouts cannot oversell or deadlock
  -- when carts contain multiple offers.
  perform o.id
  from public.offers o
  join public.cart_items ci on ci.offer_id = o.id
  where ci.pharmacy_id = v_pharmacy_id
  order by o.id
  for update of o;

  select
    ci.offer_id,
    o.warehouse_raw_name,
    ci.quantity,
    o.stock
  into v_invalid
  from public.cart_items ci
  join public.offers o on o.id = ci.offer_id
  join public.products p on p.id = o.product_id
  join public.warehouses w on w.id = o.warehouse_id
  where ci.pharmacy_id = v_pharmacy_id
    and (
      ci.quantity <= 0
      or o.is_available = false
      or o.is_deleted = true
      or p.is_deleted = true
      or w.is_deleted = true
      or w.status <> 'active'
    )
  limit 1;

  if found then
    raise exception 'Offer % (%) is no longer available.', v_invalid.offer_id, v_invalid.warehouse_raw_name;
  end if;

  select
    ci.offer_id,
    o.warehouse_raw_name,
    ci.quantity,
    o.stock
  into v_invalid
  from public.cart_items ci
  join public.offers o on o.id = ci.offer_id
  where ci.pharmacy_id = v_pharmacy_id
    and ci.quantity > o.stock
  limit 1;

  if found then
    raise exception 'Insufficient stock for offer % (%): requested %, available %.',
      v_invalid.offer_id,
      v_invalid.warehouse_raw_name,
      v_invalid.quantity,
      v_invalid.stock;
  end if;

  select coalesce(sum(
    round(ci.quantity * o.price * (1 - (o.discount_pct / 100.0)), 2)
  ), 0)
  into v_total
  from public.cart_items ci
  join public.offers o on o.id = ci.offer_id
  where ci.pharmacy_id = v_pharmacy_id;

  if v_total <= 0 then
    raise exception 'Cart total must be greater than zero.';
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
    join public.warehouses w on w.id = o.warehouse_id
    where ci.pharmacy_id = v_pharmacy_id
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

    -- Snapshot the purchased item before inventory is deducted.
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
      and o.warehouse_id = v_sub_order.warehouse_id;
  end loop;

  -- The existing offers audit trigger records old/new stock and availability.
  update public.offers o
  set
    stock = o.stock - ci.quantity,
    is_available = (o.stock - ci.quantity) > 0,
    updated_at = now()
  from public.cart_items ci
  where ci.pharmacy_id = v_pharmacy_id
    and ci.offer_id = o.id;

  delete from public.cart_items
  where pharmacy_id = v_pharmacy_id;

  return v_order_id;
end;
$$;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.create_order_from_cart()'::regprocedure)
  into v_definition;

  if v_definition not ilike '%for update of o%'
    or v_definition not ilike '%stock = o.stock - ci.quantity%'
    or v_definition not ilike '%is_available = (o.stock - ci.quantity) > 0%'
  then
    raise exception 'create_order_from_cart inventory deduction is incomplete';
  end if;
end
$$;
