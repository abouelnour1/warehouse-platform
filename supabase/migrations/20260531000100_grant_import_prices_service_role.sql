-- The import-prices Edge Function uses a service-role client. RLS bypass does
-- not replace table privileges, so grant only the operations used by imports.
grant select on public.profiles to service_role;
grant select, update on public.warehouses to service_role;
grant select, insert on public.products to service_role;
grant select, insert, update on public.offers to service_role;
grant select, insert, update on public.warehouse_product_map to service_role;
grant select, insert, update on public.match_review_queue to service_role;
grant select, insert on public.match_metrics to service_role;
grant select, insert, update on public.brand_dictionary to service_role;
grant insert on public.audit_log to service_role;

grant usage, select on all sequences in schema public to service_role;

do $$
begin
  if not has_table_privilege('service_role', 'public.profiles', 'select')
    or not has_table_privilege('service_role', 'public.warehouses', 'select')
    or not has_table_privilege('service_role', 'public.warehouses', 'update')
    or not has_table_privilege('service_role', 'public.products', 'select')
    or not has_table_privilege('service_role', 'public.products', 'insert')
    or not has_table_privilege('service_role', 'public.offers', 'select')
    or not has_table_privilege('service_role', 'public.offers', 'insert')
    or not has_table_privilege('service_role', 'public.offers', 'update')
    or not has_table_privilege('service_role', 'public.warehouse_product_map', 'select')
    or not has_table_privilege('service_role', 'public.warehouse_product_map', 'insert')
    or not has_table_privilege('service_role', 'public.warehouse_product_map', 'update')
    or not has_table_privilege('service_role', 'public.match_review_queue', 'select')
    or not has_table_privilege('service_role', 'public.match_review_queue', 'insert')
    or not has_table_privilege('service_role', 'public.match_review_queue', 'update')
    or not has_table_privilege('service_role', 'public.match_metrics', 'select')
    or not has_table_privilege('service_role', 'public.match_metrics', 'insert')
    or not has_table_privilege('service_role', 'public.brand_dictionary', 'select')
    or not has_table_privilege('service_role', 'public.brand_dictionary', 'insert')
    or not has_table_privilege('service_role', 'public.brand_dictionary', 'update')
    or not has_table_privilege('service_role', 'public.audit_log', 'insert')
    or exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'S'
        and (
          not has_sequence_privilege('service_role', c.oid, 'usage')
          or not has_sequence_privilege('service_role', c.oid, 'select')
        )
    )
  then
    raise exception 'import-prices service_role grants are incomplete';
  end if;
end
$$;
