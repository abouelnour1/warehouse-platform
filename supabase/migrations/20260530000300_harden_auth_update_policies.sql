create or replace function public.current_warehouse_status()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select status from public.warehouses where id = auth.uid()
$$;

drop policy if exists "profiles own update" on public.profiles;
drop policy if exists "warehouses owner update" on public.warehouses;

create policy "profiles own update" on public.profiles
for update using (id = auth.uid() or public.is_admin())
with check (
  public.is_admin()
  or (
    id = auth.uid()
    and role = public.current_profile_role()
  )
);

create policy "warehouses owner update" on public.warehouses
for update using (id = auth.uid() or public.is_admin())
with check (
  public.is_admin()
  or (
    id = auth.uid()
    and status = public.current_warehouse_status()
    and is_deleted = false
    and deleted_at is null
    and deleted_by is null
  )
);
