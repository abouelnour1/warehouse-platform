begin;

do $$
declare
  v_pharmacy_id uuid;
  v_offer_id uuid;
  v_order_id uuid;
  v_order_count bigint;
  v_audit_count bigint;
  v_failed boolean;
begin
  select p.id
  into v_pharmacy_id
  from public.pharmacies p
  join public.profiles pr on pr.id = p.id
  where pr.role = 'pharmacy'
  limit 1;

  select o.id
  into v_offer_id
  from public.offers o
  join public.products p on p.id = o.product_id
  join public.warehouses w on w.id = o.warehouse_id
  where o.is_deleted = false
    and p.is_deleted = false
    and w.is_deleted = false
    and w.status = 'active'
    and o.price > 0
  limit 1;

  if v_pharmacy_id is null or v_offer_id is null then
    raise exception 'inventory verification requires an existing pharmacy and active priced offer';
  end if;

  -- stock 20, order 5 => stock 15, still available, cart cleared, audit written.
  delete from public.cart_items where pharmacy_id = v_pharmacy_id;
  update public.offers set stock = 20, is_available = true where id = v_offer_id;
  insert into public.cart_items (pharmacy_id, offer_id, quantity)
  values (v_pharmacy_id, v_offer_id, 5);

  select count(*)
  into v_audit_count
  from public.audit_log
  where entity_type = 'offers'
    and entity_id = v_offer_id
    and action = 'offer.price_stock_change';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_pharmacy_id::text, true);
  select public.create_order_from_cart() into v_order_id;
  execute 'reset role';

  if not exists (
    select 1 from public.offers
    where id = v_offer_id and stock = 15 and is_available = true
  ) then
    raise exception 'stock 20 minus order 5 did not produce available stock 15';
  end if;

  if exists (select 1 from public.cart_items where pharmacy_id = v_pharmacy_id) then
    raise exception 'successful order did not clear cart';
  end if;

  if not exists (
    select 1
    from public.order_items oi
    join public.sub_orders so on so.id = oi.sub_order_id
    where so.parent_order_id = v_order_id
      and oi.quantity = 5
      and oi.unit_price > 0
      and oi.product_name is not null
      and oi.warehouse_name is not null
  ) then
    raise exception 'order item snapshot is incomplete';
  end if;

  if (
    select count(*)
    from public.audit_log
    where entity_type = 'offers'
      and entity_id = v_offer_id
      and action = 'offer.price_stock_change'
  ) <= v_audit_count then
    raise exception 'stock deduction audit entry was not written';
  end if;

  -- stock 5, order 5 => stock 0 and unavailable.
  update public.offers set stock = 5, is_available = true where id = v_offer_id;
  insert into public.cart_items (pharmacy_id, offer_id, quantity)
  values (v_pharmacy_id, v_offer_id, 5);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_pharmacy_id::text, true);
  perform public.create_order_from_cart();
  execute 'reset role';

  if not exists (
    select 1 from public.offers
    where id = v_offer_id and stock = 0 and is_available = false
  ) then
    raise exception 'stock 5 minus order 5 did not produce unavailable stock 0';
  end if;

  -- stock 3, order 5 => reject, preserve cart, create no order.
  update public.offers set stock = 3, is_available = true where id = v_offer_id;
  insert into public.cart_items (pharmacy_id, offer_id, quantity)
  values (v_pharmacy_id, v_offer_id, 5);

  select count(*) into v_order_count from public.orders;
  v_failed := false;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_pharmacy_id::text, true);
  begin
    perform public.create_order_from_cart();
  exception
    when others then
      if sqlerrm not like 'Insufficient stock for offer %' then
        raise;
      end if;
      v_failed := true;
  end;
  execute 'reset role';

  if not v_failed then
    raise exception 'insufficient stock order unexpectedly succeeded';
  end if;

  if not exists (
    select 1
    from public.cart_items
    where pharmacy_id = v_pharmacy_id
      and offer_id = v_offer_id
      and quantity = 5
  ) then
    raise exception 'failed order did not preserve cart';
  end if;

  if (select count(*) from public.orders) <> v_order_count then
    raise exception 'failed order created an order row';
  end if;

  if not exists (
    select 1
    from pg_proc
    where oid = 'public.create_order_from_cart()'::regprocedure
      and pg_get_functiondef(oid) ilike '%for update of o%'
  ) then
    raise exception 'create_order_from_cart is missing FOR UPDATE locking';
  end if;
end
$$;

rollback;
