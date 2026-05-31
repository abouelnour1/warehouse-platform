-- Pharmacists need to see current unavailable offers in product comparison so
-- the UI can render them disabled. Anonymous catalog reads remain restricted
-- to available, non-deleted offers.
drop policy if exists "offers readable available" on public.offers;
drop policy if exists "offers anon readable available" on public.offers;
drop policy if exists "offers authenticated readable" on public.offers;

create policy "offers anon readable available" on public.offers
for select
to anon
using (
  is_available = true
  and is_deleted = false
  and exists (
    select 1
    from public.products p
    where p.id = product_id
      and p.is_deleted = false
  )
);

create policy "offers authenticated readable" on public.offers
for select
to authenticated
using (
  public.is_admin()
  or warehouse_id = public.current_warehouse_id()
  or (
    is_deleted = false
    and exists (
      select 1
      from public.products p
      where p.id = product_id
        and p.is_deleted = false
    )
    and (
      public.current_profile_role() = 'pharmacy'
      or is_available = true
    )
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'offers'
      and policyname = 'offers authenticated readable'
      and roles = array['authenticated']::name[]
  ) then
    raise exception 'authenticated live-offer comparison policy is missing';
  end if;
end
$$;
