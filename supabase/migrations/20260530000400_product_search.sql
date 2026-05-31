create index if not exists products_search_text_idx
on public.products
using gin (
  to_tsvector(
    'simple',
    coalesce(canonical_name, '') || ' ' ||
    coalesce(normalized_key, '') || ' ' ||
    coalesce(brand, '') || ' ' ||
    coalesce(active_ingredient, '') || ' ' ||
    coalesce(product_code, '')
  )
);

create or replace function public.search_products(search_query text, result_limit integer default 30)
returns table (
  id uuid,
  product_code text,
  canonical_name text,
  normalized_key text,
  brand text,
  strength text,
  form text,
  pack_size text,
  rank real
)
language sql
stable
as $$
  with prepared as (
    select
      nullif(trim(search_query), '') as q,
      plainto_tsquery('simple', nullif(trim(search_query), '')) as tsq
  )
  select
    p.id,
    p.product_code,
    p.canonical_name,
    p.normalized_key,
    p.brand,
    p.strength,
    p.form,
    p.pack_size,
    ts_rank(
      to_tsvector(
        'simple',
        coalesce(p.canonical_name, '') || ' ' ||
        coalesce(p.normalized_key, '') || ' ' ||
        coalesce(p.brand, '') || ' ' ||
        coalesce(p.active_ingredient, '') || ' ' ||
        coalesce(p.product_code, '')
      ),
      prepared.tsq
    ) as rank
  from public.products p
  cross join prepared
  where p.is_deleted = false
    and prepared.q is not null
    and (
      to_tsvector(
        'simple',
        coalesce(p.canonical_name, '') || ' ' ||
        coalesce(p.normalized_key, '') || ' ' ||
        coalesce(p.brand, '') || ' ' ||
        coalesce(p.active_ingredient, '') || ' ' ||
        coalesce(p.product_code, '')
      ) @@ prepared.tsq
      or p.canonical_name ilike '%' || prepared.q || '%'
      or p.normalized_key ilike '%' || prepared.q || '%'
      or p.product_code ilike '%' || prepared.q || '%'
    )
  order by rank desc, p.canonical_name asc
  limit greatest(1, least(result_limit, 100));
$$;
