create table public.friend_book_recommendations (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.friend_profiles(user_id) on delete cascade,
  recipient_id uuid not null references public.friend_profiles(user_id) on delete cascade,
  sender_username text not null,
  recipient_username text not null,
  book_id uuid not null,
  title text not null,
  author text not null,
  rating smallint not null check (rating between 1 and 10),
  cover_photo text,
  cover_url text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id),
  unique (sender_id, recipient_id, book_id)
);

create index friend_book_recommendations_inbox_idx
  on public.friend_book_recommendations (recipient_id, created_at desc);
create index friend_book_recommendations_sent_idx
  on public.friend_book_recommendations (sender_id, created_at desc);
create index friend_book_recommendations_unread_idx
  on public.friend_book_recommendations (recipient_id) where read_at is null;

alter table public.friend_book_recommendations enable row level security;
revoke all on public.friend_book_recommendations from public, anon, authenticated;
grant select on public.friend_book_recommendations to authenticated;
grant update (read_at) on public.friend_book_recommendations to authenticated;

create policy "Read sent and received book recommendations"
  on public.friend_book_recommendations for select to authenticated
  using ((select auth.uid()) in (sender_id, recipient_id));

create policy "Mark received recommendations as read"
  on public.friend_book_recommendations for update to authenticated
  using (recipient_id = (select auth.uid()) and read_at is null)
  with check (recipient_id = (select auth.uid()) and read_at is not null);

create function public.send_friend_book_recommendation(target_friend uuid, target_book uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  sender uuid := auth.uid();
  inserted_count integer;
begin
  if sender is null or not exists (
    select 1 from public.friendships f
    where f.user_low = least(sender, target_friend)
      and f.user_high = greatest(sender, target_friend)
      and f.accepted
  ) then
    raise exception 'You can only recommend books to accepted friends.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.books b
    where b.id = target_book and b.user_id = sender
      and b.status = 'Read' and b.rating is not null
  ) then
    raise exception 'Choose a finished book you have rated.' using errcode = '22023';
  end if;

  insert into public.friend_book_recommendations (
    sender_id, recipient_id, sender_username, recipient_username, book_id,
    title, author, rating, cover_photo, cover_url
  )
  select sender, target_friend, s.username, r.username, b.id,
    b.title, b.author, b.rating, b.cover_photo, b.cover_url
  from public.books b
  join public.friend_profiles s on s.user_id = sender
  join public.friend_profiles r on r.user_id = target_friend
  join public.friendships f on f.user_low = least(sender, target_friend)
    and f.user_high = greatest(sender, target_friend) and f.accepted
  where b.id = target_book and b.user_id = sender and b.status = 'Read' and b.rating is not null
  on conflict (sender_id, recipient_id, book_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count > 0;
end;
$$;

revoke execute on function public.send_friend_book_recommendation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.send_friend_book_recommendation(uuid, uuid) to authenticated;
