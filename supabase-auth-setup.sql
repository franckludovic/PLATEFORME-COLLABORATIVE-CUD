begin;

-- Add the real CUD directions without duplicating existing rows.
insert into public.directions (name, abbr, color, icon, members)
select v.name, v.abbr, v.color, v.icon, 0
from (values
  ('DIVCOM', 'DIVCOM', '#004d72', 'fa-crown'),
  ('Direction des Finances', 'DF', '#D4A843', 'fa-coins'),
  ('Direction des Travaux Publics', 'DTP', '#2563EB', 'fa-road'),
  ('Direction de l''Urbanisme', 'DU', '#7C3AED', 'fa-city'),
  ('Direction des Services Techniques', 'DST', '#DC2626', 'fa-wrench'),
  ('Direction des Ressources Humaines', 'DRH', '#004d72', 'fa-user-tie'),
  ('Direction de la Communication', 'DCOM', '#EA580C', 'fa-bullhorn'),
  ('Direction de l''Environnement', 'DEN', '#004d72', 'fa-leaf')
) as v(name, abbr, color, icon)
where not exists (
  select 1
  from public.directions d
  where lower(d.name) = lower(v.name)
     or lower(d.abbr) = lower(v.abbr)
);

-- Used by RLS to check the signed-in user's admin profile without recursive RLS.
create or replace function public.cud_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and u."isAdmin" is true
  );
$$;

revoke all on function public.cud_is_admin() from public;
grant execute on function public.cud_is_admin() to authenticated;

alter table public.directions enable row level security;
grant select on public.directions to anon, authenticated;
grant insert, update, delete on public.directions to authenticated;

drop policy if exists directions_public_read on public.directions;
create policy directions_public_read
  on public.directions for select to anon, authenticated
  using (true);

drop policy if exists directions_admin_manage on public.directions;
create policy directions_admin_manage
  on public.directions for all to authenticated
  using (public.cud_is_admin())
  with check (public.cud_is_admin());

alter table public.users enable row level security;
grant select, insert, update, delete on public.users to authenticated;

drop policy if exists users_read_self_or_admin on public.users;
create policy users_read_self_or_admin
  on public.users for select to authenticated
  using (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or public.cud_is_admin()
  );

drop policy if exists users_insert_self on public.users;
create policy users_insert_self
  on public.users for insert to authenticated
  with check (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and coalesce("isAdmin", false) is false
  );

drop policy if exists users_update_self_or_admin on public.users;
create policy users_update_self_or_admin
  on public.users for update to authenticated
  using (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or public.cud_is_admin()
  )
  with check (
    (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and coalesce("isAdmin", false) is false)
    or public.cud_is_admin()
  );

drop policy if exists users_delete_admin on public.users;
create policy users_delete_admin
  on public.users for delete to authenticated
  using (public.cud_is_admin());

-- Application records are private to signed-in users. Admin privileges for
-- direction management and user administration are handled above.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'topics', 'conversations', 'chat_history', 'files',
    'meetings', 'notifications', 'activities'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
      execute format('drop policy if exists authenticated_all_access on public.%I', table_name);
      execute format(
        'create policy authenticated_all_access on public.%I for all to authenticated using (true) with check (true)',
        table_name
      );
    end if;
  end loop;
end;
$$;

commit;
