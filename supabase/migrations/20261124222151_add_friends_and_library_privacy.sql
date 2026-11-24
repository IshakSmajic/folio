create table public.friend_profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  library_public boolean not null default false
);

create table public.friendships (
  user_low uuid not null references public.friend_profiles(user_id) on delete cascade,
  user_high uuid not null references public.friend_profiles(user_id) on delete cascade,
  requested_by uuid not null,
  accepted boolean not null default false,
  primary key (user_low, user_high),
  check (user_low < user_high and requested_by in (user_low, user_high))
);

create index friendships_user_high_idx on public.friendships (user_high);

alter table public.friend_profiles enable row level security;
alter table public.friendships enable row level security;

revoke all on public.friend_profiles, public.friendships from public, anon, authenticated;
grant select, insert on public.friend_profiles to authenticated;
grant update (username, library_public) on public.friend_profiles to authenticated;
grant select, delete on public.friendships to authenticated;
grant update (accepted) on public.friendships to authenticated;

create policy "Read own and connected profiles" on public.friend_profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.friendships f
      where f.user_low = least(user_id, (select auth.uid()))
        and f.user_high = greatest(user_id, (select auth.uid()))
    )
  );

create policy "Create own friend profile" on public.friend_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Edit own friend profile" on public.friend_profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Read own friendships" on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_low, user_high));

create policy "Accept incoming friend requests" on public.friendships for update to authenticated
  using (
    (select auth.uid()) in (user_low, user_high)
    and requested_by <> (select auth.uid())
    and not accepted
  )
  with check (
    (select auth.uid()) in (user_low, user_high)
    and requested_by <> (select auth.uid())
    and accepted
  );

create policy "Remove own friendships" on public.friendships for delete to authenticated
  using ((select auth.uid()) in (user_low, user_high));

create function public.request_friend(target_username text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewer uuid := auth.uid();
  target uuid;
begin
  if viewer is null or not exists (select 1 from public.friend_profiles where user_id = viewer) then
    raise exception 'Create your Folio username first.' using errcode = '22023';
  end if;

  select user_id into target from public.friend_profiles
    where username = pg_catalog.lower(pg_catalog.btrim(target_username));

  if target is null or target = viewer then
    raise exception 'No friend found with that username.' using errcode = '22023';
  end if;

  insert into public.friendships (user_low, user_high, requested_by)
    values (least(viewer, target), greatest(viewer, target), viewer)
    on conflict (user_low, user_high) do nothing;
end;
$$;

create function public.read_friend_library(friend_id uuid, page_offset integer default 0)
returns table (id uuid, title text, author text, cover_photo text, cover_url text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  viewer uuid := auth.uid();
begin
  if viewer is null or friend_id is null or not exists (
    select 1
    from public.friendships f
    join public.friend_profiles p on p.user_id = friend_id
    where f.user_low = least(viewer, friend_id) and f.user_high = greatest(viewer, friend_id)
      and f.accepted and p.library_public
  ) then
    raise exception 'This library is private or unavailable.' using errcode = '42501';
  end if;

  return query
    select b.id, b.title, b.author, b.cover_photo, b.cover_url
    from public.books b
    where b.user_id = friend_id and b.status <> 'To Read'
    order by b.created_at desc, b.id desc
    limit 12 offset greatest(page_offset, 0);
end;
$$;

revoke execute on function public.request_friend(text), public.read_friend_library(uuid, integer) from public, anon, authenticated;
grant execute on function public.request_friend(text), public.read_friend_library(uuid, integer) to authenticated;
