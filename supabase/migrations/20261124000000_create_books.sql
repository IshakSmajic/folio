begin;

create table public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  author text not null check (btrim(author) <> ''),
  status text not null check (status in ('Reading', 'To Read', 'Read')),
  progress integer not null check (progress between 0 and 100),
  palette text not null,
  mark text not null,
  category text not null,
  created_at timestamptz not null default now()
);

create index books_owner_recent_idx on public.books (user_id, created_at desc);
alter table public.books enable row level security;
revoke all on public.books from public, anon, authenticated;
grant select, insert on public.books to authenticated;

create policy "Read own books" on public.books
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Add own books" on public.books
  for insert to authenticated with check ((select auth.uid()) = user_id);

commit;
