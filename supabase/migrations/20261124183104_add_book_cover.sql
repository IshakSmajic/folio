alter table public.books
  add column cover_photo text,
  add constraint books_cover_photo_format check (
    cover_photo is null or (
      length(cover_photo) <= 262144
      and cover_photo ~ '^data:image/webp;base64,[A-Za-z0-9+/]+={0,2}$'
    )
  );
