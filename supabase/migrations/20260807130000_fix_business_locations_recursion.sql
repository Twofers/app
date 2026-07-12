create or replace function public.business_location_count(p_business_id uuid)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::int from public.business_locations
  where business_id = p_business_id;
$$;

revoke all on function public.business_location_count(uuid) from public;
grant execute on function public.business_location_count(uuid) to authenticated;

drop policy if exists "Owners can insert their business locations" on public.business_locations;

create policy "Owners can insert their business locations"
on public.business_locations for insert to authenticated
with check (
  exists (
    select 1 from public.business_profiles bp
    where bp.id = business_locations.business_id
      and (bp.user_id = auth.uid() or bp.owner_id = auth.uid())
  )
  and public.business_location_count(business_locations.business_id) < (
    select case when bp.subscription_tier = 'premium' then 3 else 1 end
    from public.business_profiles bp
    where bp.id = business_locations.business_id
  )
);