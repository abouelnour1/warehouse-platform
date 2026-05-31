-- Keep one current notification row per recipient and sub-order. A parent order
-- may contain multiple warehouse sub-orders whose statuses advance separately.
delete from public.notifications older
using public.notifications newer
where older.entity_type = 'sub_orders'
  and newer.entity_type = 'sub_orders'
  and older.recipient_id = newer.recipient_id
  and older.entity_id = newer.entity_id
  and (
    older.created_at < newer.created_at
    or (older.created_at = newer.created_at and older.id < newer.id)
  );

create unique index if not exists notifications_recipient_sub_order_unique
on public.notifications (recipient_id, entity_type, entity_id)
where entity_type = 'sub_orders';

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
      message,
      read_at,
      created_at
    )
    values (
      v_recipient_id,
      p_actor_id,
      'sub_orders',
      p_sub_order_id,
      p_message,
      null,
      now()
    )
    on conflict (recipient_id, entity_type, entity_id)
      where entity_type = 'sub_orders'
    do update set
      actor_id = excluded.actor_id,
      message = excluded.message,
      read_at = null,
      created_at = excluded.created_at;
  end if;
end;
$$;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.notify_order_party(uuid, uuid, text)'::regprocedure)
  into v_definition;

  if v_definition not ilike '%on conflict (recipient_id, entity_type, entity_id)%'
    or v_definition not ilike '%read_at = null%'
  then
    raise exception 'notify_order_party must upsert order notifications';
  end if;
end
$$;
