alter table public.books
  add column description text check (length(description) <= 4000),
  add column cover_url text check (
    length(cover_url) <= 2048 and cover_url ~ '^https://([a-z0-9-]+\.)+lexicanum\.com/'
  ),
  add column source_url text check (
    length(source_url) <= 2048 and source_url like 'https://wh40k.lexicanum.com/wiki/%'
  );
