begin;

do $$
declare
  v_admin_id uuid;
  v_warehouse_id uuid;
  v_original_status text;
  v_target_status text;
  v_warehouses_count integer;
  v_products_count integer;
  v_offers_count integer;
begin
  select count(*) into v_warehouses_count from public.warehouses where is_deleted = false;
  select count(*) into v_products_count from public.products where is_deleted = false;
  select count(*) into v_offers_count from public.offers where is_deleted = false;

  if v_warehouses_count = 0 or v_products_count = 0 or v_offers_count = 0 then
    raise exception 'Expected live admin page data, found warehouses %, products %, offers %',
      v_warehouses_count, v_products_count, v_offers_count;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'warehouses_id_fkey'
      and conrelid = 'public.warehouses'::regclass
  ) then
    raise exception 'Missing warehouses_id_fkey owner relationship';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'offers_product_id_fkey'
      and conrelid = 'public.offers'::regclass
  ) then
    raise exception 'Missing offers_product_id_fkey relationship';
  end if;

  select id into v_admin_id
  from public.profiles
  where role = 'admin'
  limit 1;

  select id, status into v_warehouse_id, v_original_status
  from public.warehouses
  where is_deleted = false
  limit 1;

  if v_admin_id is null or v_warehouse_id is null then
    raise exception 'Admin RPC verification requires an admin and a warehouse';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_target_status := case when v_original_status = 'active' then 'suspended' else 'active' end;
  perform public.admin_set_warehouse_status(v_warehouse_id, v_target_status);

  if not exists (
    select 1
    from public.audit_log
    where actor_id = v_admin_id
      and action = 'warehouse.status_change'
      and entity_type = 'warehouses'
      and entity_id = v_warehouse_id
      and new_value->>'status' = v_target_status
  ) then
    raise exception 'Warehouse status RPC did not write an audit_log row';
  end if;
end
$$;

rollback;
