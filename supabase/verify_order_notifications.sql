begin;

do $$
declare
  v_sub_order_id uuid;
  v_pharmacy_id uuid;
  v_warehouse_id uuid;
  v_count integer;
  v_message text;
  v_read_at timestamptz;
begin
  select so.id, o.pharmacy_id, so.warehouse_id
  into v_sub_order_id, v_pharmacy_id, v_warehouse_id
  from public.sub_orders so
  join public.orders o on o.id = so.parent_order_id
  order by so.updated_at desc
  limit 1;

  if v_sub_order_id is null then
    raise notice 'No existing sub-order found; structural notification checks only.';
    return;
  end if;

  delete from public.notifications
  where recipient_id = v_pharmacy_id
    and entity_type = 'sub_orders'
    and entity_id = v_sub_order_id;

  perform public.notify_order_party(v_sub_order_id, v_warehouse_id, 'accepted');
  perform public.notify_order_party(v_sub_order_id, v_warehouse_id, 'preparing');
  perform public.notify_order_party(v_sub_order_id, v_warehouse_id, 'delivered');

  select count(*), max(message)
  into v_count, v_message
  from public.notifications
  where recipient_id = v_pharmacy_id
    and entity_type = 'sub_orders'
    and entity_id = v_sub_order_id;

  if v_count <> 1 then
    raise exception 'Expected one notification row after three updates, found %', v_count;
  end if;

  if v_message <> 'delivered' then
    raise exception 'Expected latest status message, found %', v_message;
  end if;

  update public.notifications
  set read_at = now()
  where recipient_id = v_pharmacy_id
    and entity_type = 'sub_orders'
    and entity_id = v_sub_order_id;

  perform public.notify_order_party(v_sub_order_id, v_warehouse_id, 'cancelled');

  select read_at
  into v_read_at
  from public.notifications
  where recipient_id = v_pharmacy_id
    and entity_type = 'sub_orders'
    and entity_id = v_sub_order_id;

  if v_read_at is not null then
    raise exception 'Updated order notification must become unread again';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'notifications_recipient_sub_order_unique'
  ) then
    raise exception 'Missing unique sub-order notification index';
  end if;
end
$$;

rollback;
