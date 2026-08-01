-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).

create table if not exists folders (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null,
  position   int  not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists channels (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- Deleting a folder must NOT delete the channels in it: they fall back to
  -- Unsorted (folder_id null). That's what SET NULL buys us.
  folder_id     bigint references folders (id) on delete set null,

  yt_channel_id text not null,
  handle        text,
  title         text not null,
  avatar_url    text,
  url           text,
  created_at    timestamptz not null default now(),

  -- One row per channel per user. Re-saving updates instead of duplicating.
  unique (user_id, yt_channel_id)
);

create index if not exists channels_folder_idx on channels (user_id, folder_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: the anon key in config.js can only ever touch rows
-- belonging to the signed-in user. Without this, the key would be a skeleton key.
-- ---------------------------------------------------------------------------

alter table folders  enable row level security;
alter table channels enable row level security;

drop policy if exists "own folders" on folders;
create policy "own folders" on folders
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own channels" on channels;
create policy "own channels" on channels
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Optional starter folders. Delete this block if you'd rather start empty.
-- (Run it while signed in as yourself, or it won't know who you are.)
-- insert into folders (name, position) values ('3D', 0), ('2D', 1), ('Hooks', 2);
