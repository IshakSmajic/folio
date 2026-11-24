create or replace function public.set_book_rated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.rating is not null then
    if new.rating is distinct from old.rating then
      raise exception 'A saved book rating cannot be changed.' using errcode = '23514';
    end if;
    new.rated_at := old.rated_at;
  else
    new.rated_at := case when new.rating is not null then pg_catalog.clock_timestamp() end;
  end if;

  return new;
end;
$$;
