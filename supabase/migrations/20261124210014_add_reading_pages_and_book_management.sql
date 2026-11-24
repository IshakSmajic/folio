alter table public.books
  add column current_page integer,
  add column total_pages integer,
  add constraint books_page_range_check check (
    (current_page is null and total_pages is null)
    or (
      current_page is not null
      and total_pages is not null
      and total_pages > 0
      and current_page between 0 and total_pages
    )
  );

grant update (title, author, description, mark, current_page, total_pages) on public.books to authenticated;
grant delete on public.books to authenticated;

create policy "Delete own books" on public.books
  for delete to authenticated using ((select auth.uid()) = user_id);
