alter table public.books
  add column rating smallint check (rating between 1 and 10),
  add column tags text[] not null default '{}' check (
    cardinality(tags) <= 20 and length(array_to_string(tags, ',')) <= 1219
  ),
  add column series text check (length(series) <= 120);

grant update (rating, tags, series) on public.books to authenticated;
