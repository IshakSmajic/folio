alter table public.books
  drop constraint books_cover_url_check,
  drop constraint books_source_url_check,
  add constraint books_cover_url_check check (
    length(cover_url) <= 2048 and (
      cover_url ~ '^https://([a-z0-9-]+\.)+lexicanum\.com/'
      or cover_url ~ '^https://covers\.openlibrary\.org/b/id/[0-9]+-L\.jpg\?default=false$'
    )
  ),
  add constraint books_source_url_check check (
    length(source_url) <= 2048 and (
      source_url like 'https://wh40k.lexicanum.com/wiki/%'
      or source_url ~ '^https://openlibrary\.org/works/OL[0-9]+W$'
    )
  );
