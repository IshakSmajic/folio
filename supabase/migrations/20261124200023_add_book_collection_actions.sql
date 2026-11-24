alter table public.books
  drop constraint books_status_check,
  add constraint books_status_check check (status in ('Unread', 'Reading', 'To Read', 'Read'));

grant update (status, progress, cover_photo) on public.books to authenticated;

create policy "Update own books" on public.books
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
