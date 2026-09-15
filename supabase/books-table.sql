-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
--
-- The dashboard used to list books by walking every object in the storage
-- bucket and downloading each book.json, which meant one network round trip
-- per book on every page load. This table holds just the columns the
-- dashboard renders, so listing is a single indexed query.

create table if not exists public.books (
  -- The 16-char hex id that the /books/<id> URL is built from.
  id          text primary key,
  title       text        not null,
  page_count  integer     not null default 0 check (page_count >= 0),
  created_at  timestamptz not null default now()
);

-- The dashboard always reads newest-first.
create index if not exists books_created_at_idx
  on public.books (created_at desc);

-- The service role key used by the server bypasses RLS, but leaving RLS on
-- means an anon/public key cannot read or write this table directly.
alter table public.books enable row level security;
