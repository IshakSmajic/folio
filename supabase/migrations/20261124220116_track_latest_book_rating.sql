alter table public.books add column rated_at timestamptz;

create function public.set_book_rated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.rated_at := case when new.rating is not null then pg_catalog.clock_timestamp() end;
  return new;
end;
$$;

create trigger set_book_rated_at
before insert or update of rating on public.books
for each row execute function public.set_book_rated_at();

revoke execute on function public.set_book_rated_at() from public;
