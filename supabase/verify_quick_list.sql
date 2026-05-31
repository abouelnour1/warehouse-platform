begin;

do $$
declare
  v_pharmacy_id uuid;
  v_product_id uuid;
  v_offer_id uuid;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quick_list'
      and column_name in ('quantity', 'default_quantity')
  ) then
    raise exception 'quick_list must not store cart quantity';
  end if;

  select p.id
  into v_pharmacy_id
  from public.pharmacies p
  join public.profiles pr on pr.id = p.id
  where pr.role = 'pharmacy'
  limit 1;

  select o.product_id, o.id
  into v_product_id, v_offer_id
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
    raise exception 'quick-list verification requires an existing pharmacy and active priced offer';
  end if;

  delete from public.cart_items
  where pharmacy_id = v_pharmacy_id
    and offer_id = v_offer_id;

  delete from public.quick_list
  where pharmacy_id = v_pharmacy_id
    and product_id = v_product_id;

  update public.offers
  set stock = 10,
      is_available = true
  where id = v_offer_id;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_pharmacy_id::text, true);

  insert into public.quick_list (pharmacy_id, product_id)
  values (v_pharmacy_id, v_product_id);

  if not exists (
    select 1
    from public.quick_list ql
    join public.products p on p.id = ql.product_id
    where ql.pharmacy_id = v_pharmacy_id
      and ql.product_id = v_product_id
  ) then
    raise exception 'pharmacist cannot open quick-list product details';
  end if;

  if not exists (
    select 1
    from public.offers o
    where o.id = v_offer_id
      and o.product_id = v_product_id
      and o.stock = 10
      and o.is_available = true
  ) then
    raise exception 'quick-list product did not load current available offer';
  end if;

  insert into public.cart_items (pharmacy_id, offer_id, quantity)
  values (v_pharmacy_id, v_offer_id, 4);

  if not exists (
    select 1
    from public.cart_items ci
    where ci.pharmacy_id = v_pharmacy_id
      and ci.offer_id = v_offer_id
      and ci.quantity = 4
  ) then
    raise exception 'selected quick-list offer quantity was not stored in cart_items';
  end if;

  delete from public.quick_list
  where pharmacy_id = v_pharmacy_id
    and product_id = v_product_id;

  if exists (
    select 1
    from public.quick_list
    where pharmacy_id = v_pharmacy_id
      and product_id = v_product_id
  ) then
    raise exception 'pharmacist cannot remove quick-list product';
  end if;

  execute 'reset role';

  update public.offers
  set stock = 0,
      is_available = false
  where id = v_offer_id;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_pharmacy_id::text, true);

  if not exists (
    select 1
    from public.offers o
    where o.id = v_offer_id
      and o.stock = 0
      and o.is_available = false
  ) then
    raise exception 'pharmacist cannot load unavailable quick-list offer for disabled rendering';
  end if;

  execute 'reset role';
  execute 'set local role anon';

  if exists (
    select 1
    from public.offers o
    where o.id = v_offer_id
  ) then
    raise exception 'anonymous user can read unavailable offer';
  end if;

  execute 'reset role';
end
$$;

rollback;
