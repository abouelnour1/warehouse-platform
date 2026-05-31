create or replace function public.admin_set_warehouse_status(
  p_warehouse_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can update warehouse status.';
  end if;

  if p_status not in ('pending', 'active', 'suspended') then
    raise exception 'Unsupported warehouse status.';
  end if;

  update public.warehouses
  set status = p_status
  where id = p_warehouse_id
    and is_deleted = false;
end;
$$;

create or replace function public.admin_set_commission_rate(
  p_warehouse_id uuid,
  p_commission_pct numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
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
  set active = false
  where active = true
    and (
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
  p_product_id uuid,
  p_product_code text,
  p_is_verified boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can update products.';
  end if;

  update public.products
  set
    product_code = nullif(trim(p_product_code), ''),
    is_verified = p_is_verified
  where id = p_product_id
    and is_deleted = false;
end;
$$;

create or replace function public.admin_merge_products(
  p_source_product_id uuid,
  p_target_product_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_affected_warehouses uuid[];
begin
  if not public.is_admin() then
    raise exception 'Only admins can merge products.';
  end if;

  if p_source_product_id = p_target_product_id then
    raise exception 'Source and target products must be different.';
  end if;

  if not exists (select 1 from public.products where id = p_source_product_id and is_deleted = false) then
    raise exception 'Source product not found.';
  end if;

  if not exists (select 1 from public.products where id = p_target_product_id and is_deleted = false) then
    raise exception 'Target product not found.';
  end if;

  select coalesce(array_agg(distinct warehouse_id), '{}')
  into v_affected_warehouses
  from (
    select warehouse_id
    from public.offers
    where product_id = p_source_product_id
      and is_deleted = false
    union
    select created_from_warehouse
    from public.products
    where id = p_source_product_id
      and created_from_warehouse is not null
  ) affected;

  update public.offers source_offer
  set
    is_deleted = true,
    deleted_at = now(),
    deleted_by = v_actor_id
  where source_offer.product_id = p_source_product_id
    and source_offer.is_deleted = false
    and exists (
      select 1
      from public.offers target_offer
      where target_offer.warehouse_id = source_offer.warehouse_id
        and target_offer.product_id = p_target_product_id
    );

  update public.offers
  set product_id = p_target_product_id
  where product_id = p_source_product_id
    and is_deleted = false;

  update public.warehouse_product_map
  set product_id = p_target_product_id,
      confirmed = true
  where product_id = p_source_product_id;

  update public.match_review_queue
  set suggested_product_id = p_target_product_id
  where suggested_product_id = p_source_product_id;

  update public.products
  set
    is_deleted = true,
    deleted_at = now(),
    deleted_by = v_actor_id
  where id = p_source_product_id;

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
    'product.merge',
    'products',
    p_target_product_id,
    jsonb_build_object('source_product_id', p_source_product_id),
    jsonb_build_object('target_product_id', p_target_product_id)
  );

  with latest_metric as (
    select id
    from public.match_metrics
    where warehouse_id = any(v_affected_warehouses)
    order by created_at desc
    limit 1
  )
  update public.match_metrics
  set corrected_count = corrected_count + 1
  where id in (select id from latest_metric);
end;
$$;

create or replace function public.admin_dashboard_stats()
returns table (
  active_warehouses bigint,
  orders_count bigint,
  total_commission_due numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.warehouses where status = 'active' and is_deleted = false) as active_warehouses,
    (select count(*) from public.orders) as orders_count,
    (
      select coalesce(sum(commission_amount), 0)
      from public.sub_orders
      where status <> 'cancelled'
        and status <> 'rejected'
    ) as total_commission_due
  where public.is_admin();
$$;
