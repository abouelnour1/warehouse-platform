begin;

do $$
declare
  v_warehouse_id uuid;
  v_offer_id uuid;
  v_other_warehouse_id uuid := gen_random_uuid();
  v_pharmacy_id uuid;
  v_order_id uuid;
  v_sub_order_id uuid;
  v_pending_sub_order_id uuid;
  v_admin_id uuid;
  v_updated integer;
begin
  select o.warehouse_id, o.id
  into v_warehouse_id, v_offer_id
  from public.offers o
  limit 1;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);

  -- Force evaluation of every order read policy as a regular authenticated user.
  perform count(*) from public.orders;
  perform count(*) from public.sub_orders;
  perform count(*) from public.order_items;

  if v_offer_id is not null then
    perform set_config('request.jwt.claim.sub', v_warehouse_id::text, true);
    update public.offers
    set price = price,
        stock = stock,
        is_available = is_available
    where id = v_offer_id;
    get diagnostics v_updated = row_count;

    if v_updated <> 1 then
      raise exception 'warehouse-owned offer update was blocked';
    end if;

    begin
      update public.offers
      set warehouse_id = warehouse_id
      where id = v_offer_id;
      raise exception 'warehouse ownership-column update was allowed';
    exception
      when insufficient_privilege then
        null;
    end;

    perform set_config('request.jwt.claim.sub', v_other_warehouse_id::text, true);
    update public.offers
    set price = price
    where id = v_offer_id;
    get diagnostics v_updated = row_count;

    if v_updated <> 0 then
      raise exception 'cross-warehouse offer update was allowed';
    end if;
  end if;

  execute 'reset role';

  select o.id, o.pharmacy_id
  into v_order_id, v_pharmacy_id
  from public.orders o
  limit 1;

  if v_order_id is not null then
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_pharmacy_id::text, true);

    if not exists (select 1 from public.orders o where o.id = v_order_id) then
      raise exception 'pharmacist cannot read own order';
    end if;

    perform count(*) from public.sub_orders so where so.parent_order_id = v_order_id;
    perform count(*)
    from public.order_items oi
    join public.sub_orders so on so.id = oi.sub_order_id
    where so.parent_order_id = v_order_id;
    execute 'reset role';
  end if;

  select so.id, so.warehouse_id
  into v_sub_order_id, v_warehouse_id
  from public.sub_orders so
  limit 1;

  if v_sub_order_id is not null then
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_warehouse_id::text, true);

    if not exists (select 1 from public.sub_orders so where so.id = v_sub_order_id) then
      raise exception 'warehouse cannot read assigned sub-order';
    end if;

    perform count(*) from public.orders o where public.can_access_order(o.id);
    perform count(*) from public.order_items oi where oi.sub_order_id = v_sub_order_id;
    execute 'reset role';
  end if;

  select so.id, so.warehouse_id
  into v_pending_sub_order_id, v_warehouse_id
  from public.sub_orders so
  where so.status = 'pending'
  limit 1;

  if v_pending_sub_order_id is not null then
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_warehouse_id::text, true);

    begin
      perform public.update_sub_order_status(v_pending_sub_order_id, 'accepted', null);
      raise exception 'ROLLBACK_ACCEPT_TEST';
    exception
      when others then
        if sqlerrm <> 'ROLLBACK_ACCEPT_TEST' then
          raise;
        end if;
    end;

    begin
      perform public.update_sub_order_status(v_pending_sub_order_id, 'rejected', 'verification only');
      raise exception 'ROLLBACK_REJECT_TEST';
    exception
      when others then
        if sqlerrm <> 'ROLLBACK_REJECT_TEST' then
          raise;
        end if;
    end;
    execute 'reset role';
  end if;

  select p.id
  into v_admin_id
  from public.profiles p
  where p.role = 'admin'
  limit 1;

  if v_admin_id is not null then
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
    perform count(*) from public.orders;
    perform count(*) from public.sub_orders;
    perform count(*) from public.order_items;
    perform count(*) from public.offers;
    execute 'reset role';
  end if;

  execute 'set local role anon';
  perform count(*) from public.offers;
  execute 'reset role';
end
$$;

rollback;
