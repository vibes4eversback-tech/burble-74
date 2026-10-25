-- ============================================================================
-- Burble schema. Run once in the Supabase SQL editor (safe to re-run).
--
-- Auth model: nickname + 4-6 digit PIN. PINs are bcrypt-hashed with pgcrypto
-- inside SECURITY DEFINER RPCs. A session token (sessions.token) is sent by the
-- client in the `x-session-token` header; RLS policies read it through
-- current_app_user(). The anon key alone can never read private rows.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables ----
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  pin_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references accounts(id) on delete cascade,
  nickname text not null check (nickname ~ '^[A-Za-z0-9_.-]{2,24}$'),
  bio text not null default '' check (char_length(bio) <= 190),
  avatar_url text,
  banner_url text,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_nickname_lower on profiles (lower(nickname));

create table if not exists sessions (
  token uuid primary key default gen_random_uuid(),
  user_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists login_failures (
  id bigserial primary key,
  nickname_key text not null,
  failed_at timestamptz not null default now()
);

create table if not exists servers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  icon_url text,
  banner_url text,
  owner_id uuid not null references profiles(id) on delete cascade,
  invite_code text not null unique default encode(gen_random_bytes(5), 'hex'),
  created_at timestamptz not null default now()
);

create table if not exists server_members (
  server_id uuid not null references servers(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references servers(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 50),
  color text not null default '#99aab5' check (color ~ '^#[0-9a-fA-F]{6}$'),
  permissions bigint not null default 0,
  position int not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists roles_one_default on roles (server_id) where is_default;

create table if not exists member_roles (
  server_id uuid not null,
  user_id uuid not null,
  role_id uuid not null references roles(id) on delete cascade,
  primary key (server_id, user_id, role_id),
  foreign key (server_id, user_id) references server_members(server_id, user_id) on delete cascade
);

create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid references servers(id) on delete cascade,
  kind text not null check (kind in ('text', 'dm')),
  name text not null default 'general' check (char_length(name) between 1 and 100),
  topic text not null default '' check (char_length(topic) <= 1024),
  position int not null default 0,
  created_at timestamptz not null default now(),
  check ((kind = 'dm' and server_id is null) or (kind = 'text' and server_id is not null))
);

create table if not exists dm_members (
  channel_id uuid not null references channels(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  primary key (channel_id, user_id)
);

create table if not exists webhooks (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references servers(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  avatar_url text,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  author_id uuid references profiles(id) on delete cascade,
  webhook_id uuid references webhooks(id) on delete set null,
  author_name text,
  content text not null default '' check (char_length(content) <= 4000),
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  check (author_id is not null or webhook_id is not null)
);
create index if not exists messages_channel_time on messages (channel_id, created_at);

-- ------------------------------------------------------- helper functions ----
create or replace function current_app_token() returns uuid
language sql stable as $$
  select nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-session-token', '')::uuid
$$;

create or replace function current_app_user() returns uuid
language sql stable security definer set search_path = public as $$
  select s.user_id from sessions s where s.token = current_app_token()
$$;

create or replace function is_server_member(p_server uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from server_members m
                 where m.server_id = p_server and m.user_id = current_app_user())
$$;

create or replace function is_owner(p_server uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from servers s where s.id = p_server and s.owner_id = p_user)
$$;

-- Effective permission bits for the current user in a server.
-- Owner gets ADMINISTRATOR (bit 1). Everyone gets the @everyone role.
create or replace function user_server_perms(p_server uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select case
    when is_owner(p_server, current_app_user()) then 1::bigint
    when not is_server_member(p_server) then 0::bigint
    else coalesce((
      select bit_or(r.permissions) from roles r
      where r.server_id = p_server
        and (r.is_default or r.id in (
          select mr.role_id from member_roles mr
          where mr.server_id = p_server and mr.user_id = current_app_user())))
    , 0)
  end
$$;

-- Bits: 1 ADMIN, 2 MANAGE_SERVER, 4 MANAGE_CHANNELS, 8 MANAGE_ROLES, 16 KICK,
--       32 MANAGE_MESSAGES, 64 SEND_MESSAGES, 128 ATTACH_FILES,
--       256 MANAGE_WEBHOOKS, 512 MANAGE_INVITES
create or replace function has_perm(p_server uuid, p_perm bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select (user_server_perms(p_server) & 1) = 1
      or (user_server_perms(p_server) & p_perm) = p_perm
$$;

-- Prevents privilege escalation: you can only hand out bits you already hold.
create or replace function can_grant(p_server uuid, p_perms bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select (user_server_perms(p_server) & 1) = 1
      or (p_perms & ~user_server_perms(p_server)) = 0
$$;

create or replace function is_channel_reader(p_channel uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from channels c
    where c.id = p_channel and (
      (c.kind = 'text' and is_server_member(c.server_id))
      or (c.kind = 'dm' and exists (select 1 from dm_members d
                                    where d.channel_id = c.id and d.user_id = current_app_user()))
    ))
$$;

create or replace function can_send(p_channel uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from channels c
    where c.id = p_channel and (
      (c.kind = 'dm' and exists (select 1 from dm_members d
                                 where d.channel_id = c.id and d.user_id = current_app_user()))
      or (c.kind = 'text' and has_perm(c.server_id, 64))
    ))
$$;

-- ------------------------------------------------------------ auth RPCs ----
create or replace function register_account(p_nickname text, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_token uuid;
begin
  if p_pin !~ '^[0-9]{4,6}$' then raise exception 'PIN must be 4 to 6 digits'; end if;
  if p_nickname !~ '^[A-Za-z0-9_.-]{2,24}$' then
    raise exception 'Nickname must be 2-24 characters: letters, numbers, _ . -';
  end if;
  if exists (select 1 from profiles where lower(nickname) = lower(p_nickname)) then
    raise exception 'That nickname is already taken';
  end if;
  insert into accounts (pin_hash) values (crypt(p_pin, gen_salt('bf'))) returning id into v_id;
  insert into profiles (id, nickname) values (v_id, p_nickname);
  insert into sessions (user_id) values (v_id) returning token into v_token;
  return json_build_object('token', v_token, 'user_id', v_id, 'nickname', p_nickname);
end $$;

create or replace function login_account(p_nickname text, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_nick text; v_hash text; v_token uuid;
begin
  -- Simple brute-force guard: 10 failures per nickname in 15 minutes.
  if (select count(*) from login_failures
      where nickname_key = lower(p_nickname) and failed_at > now() - interval '15 minutes') >= 10 then
    raise exception 'Too many attempts. Try again in 15 minutes';
  end if;

  select p.id, p.nickname, a.pin_hash into v_id, v_nick, v_hash
  from profiles p join accounts a on a.id = p.id
  where lower(p.nickname) = lower(p_nickname);

  -- Return (not raise) so the failure row is committed.
  if v_id is null or crypt(p_pin, v_hash) <> v_hash then
    insert into login_failures (nickname_key) values (lower(p_nickname));
    return json_build_object('error', 'Wrong nickname or PIN');
  end if;

  delete from login_failures where nickname_key = lower(p_nickname);
  insert into sessions (user_id) values (v_id) returning token into v_token;
  return json_build_object('token', v_token, 'user_id', v_id, 'nickname', v_nick);
end $$;

create or replace function logout_account() returns void
language sql security definer set search_path = public as $$
  delete from sessions where token = current_app_token()
$$;

-- ------------------------------------------------------- server RPCs ----
create or replace function create_server(p_name text, p_icon text default null, p_banner text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := current_app_user(); v_server uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  insert into servers (name, owner_id, icon_url, banner_url)
    values (p_name, me, p_icon, p_banner) returning id into v_server;
  insert into server_members (server_id, user_id) values (v_server, me);
  -- @everyone: SEND_MESSAGES | ATTACH_FILES
  insert into roles (server_id, name, permissions, is_default, position)
    values (v_server, '@everyone', 192, true, 0);
  insert into channels (server_id, kind, name, position)
    values (v_server, 'text', 'general', 0);
  return v_server;
end $$;

create or replace function join_server(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := current_app_user(); v_server uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select id into v_server from servers where lower(invite_code) = lower(trim(p_code));
  if v_server is null then raise exception 'Invalid invite code'; end if;
  insert into server_members (server_id, user_id) values (v_server, me)
    on conflict do nothing;
  return v_server;
end $$;

create or replace function reset_invite(p_server uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not has_perm(p_server, 512) then raise exception 'Missing MANAGE_INVITES permission'; end if;
  update servers set invite_code = encode(gen_random_bytes(5), 'hex')
    where id = p_server returning invite_code into v_code;
  return v_code;
end $$;

create or replace function open_dm(p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := current_app_user(); v_channel uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if p_user = me then raise exception 'You cannot DM yourself'; end if;
  select c.id into v_channel from channels c
  where c.kind = 'dm'
    and exists (select 1 from dm_members a where a.channel_id = c.id and a.user_id = me)
    and exists (select 1 from dm_members b where b.channel_id = c.id and b.user_id = p_user)
  limit 1;
  if v_channel is null then
    insert into channels (kind) values ('dm') returning id into v_channel;
    insert into dm_members (channel_id, user_id) values (v_channel, me), (v_channel, p_user);
  end if;
  return v_channel;
end $$;

-- Webhooks post with a secret token: no account needed.
-- POST {url}/rest/v1/rpc/execute_webhook  { "p_token": "...", "p_content": "hi" }
create or replace function execute_webhook(p_token text, p_content text,
                                           p_username text default null,
                                           p_attachments jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare w webhooks; v_msg uuid;
begin
  select * into w from webhooks where token = p_token;
  if not found then raise exception 'Unknown webhook'; end if;
  insert into messages (channel_id, webhook_id, author_name, content, attachments)
    values (w.channel_id, w.id, coalesce(p_username, w.name), coalesce(p_content, ''),
            coalesce(p_attachments, '[]'::jsonb))
    returning id into v_msg;
  return v_msg;
end $$;

-- ------------------------------------------------------------ privileges ----
-- Column-level grants: nobody can change owner, invite code or nickname directly.
revoke all on accounts, sessions, login_failures from anon, authenticated;
revoke update on profiles, servers, channels, messages, webhooks from anon, authenticated;
grant update (bio, avatar_url, banner_url) on profiles to anon, authenticated;
grant update (name, icon_url, banner_url) on servers to anon, authenticated;
grant update (name, topic, position) on channels to anon, authenticated;
grant update (content, edited_at) on messages to anon, authenticated;
grant update (name, avatar_url) on webhooks to anon, authenticated;

-- ------------------------------------------------------------------- RLS ----
alter table accounts enable row level security;
alter table sessions enable row level security;
alter table login_failures enable row level security;
alter table profiles enable row level security;
alter table servers enable row level security;
alter table server_members enable row level security;
alter table roles enable row level security;
alter table member_roles enable row level security;
alter table channels enable row level security;
alter table dm_members enable row level security;
alter table webhooks enable row level security;
alter table messages enable row level security;

drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select using (true);
drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles for update
  using (id = current_app_user()) with check (id = current_app_user());

drop policy if exists servers_read on servers;
create policy servers_read on servers for select using (is_server_member(id));
drop policy if exists servers_update on servers;
create policy servers_update on servers for update
  using (has_perm(id, 2)) with check (has_perm(id, 2));
drop policy if exists servers_delete on servers;
create policy servers_delete on servers for delete using (owner_id = current_app_user());

drop policy if exists sm_read on server_members;
create policy sm_read on server_members for select using (is_server_member(server_id));
drop policy if exists sm_leave_or_kick on server_members;
create policy sm_leave_or_kick on server_members for delete using (
  (user_id = current_app_user() and not is_owner(server_id, user_id))
  or (has_perm(server_id, 16) and not is_owner(server_id, user_id))
);

drop policy if exists roles_read on roles;
create policy roles_read on roles for select using (is_server_member(server_id));
drop policy if exists roles_insert on roles;
create policy roles_insert on roles for insert with check (
  has_perm(server_id, 8) and not is_default and can_grant(server_id, permissions));
drop policy if exists roles_update on roles;
create policy roles_update on roles for update
  using (has_perm(server_id, 8)) with check (has_perm(server_id, 8) and can_grant(server_id, permissions));
drop policy if exists roles_delete on roles;
create policy roles_delete on roles for delete using (has_perm(server_id, 8) and not is_default);

drop policy if exists mr_read on member_roles;
create policy mr_read on member_roles for select using (is_server_member(server_id));
drop policy if exists mr_insert on member_roles;
create policy mr_insert on member_roles for insert with check (
  has_perm(server_id, 8)
  and exists (select 1 from roles r where r.id = role_id and r.server_id = member_roles.server_id
              and not r.is_default and can_grant(server_id, r.permissions)));
drop policy if exists mr_delete on member_roles;
create policy mr_delete on member_roles for delete using (has_perm(server_id, 8));

drop policy if exists channels_read on channels;
create policy channels_read on channels for select using (is_channel_reader(id));
drop policy if exists channels_insert on channels;
create policy channels_insert on channels for insert with check (kind = 'text' and has_perm(server_id, 4));
drop policy if exists channels_update on channels;
create policy channels_update on channels for update
  using (kind = 'text' and has_perm(server_id, 4)) with check (kind = 'text' and has_perm(server_id, 4));
drop policy if exists channels_delete on channels;
create policy channels_delete on channels for delete using (kind = 'text' and has_perm(server_id, 4));

drop policy if exists dm_read on dm_members;
create policy dm_read on dm_members for select using (is_channel_reader(channel_id));

drop policy if exists webhooks_read on webhooks;
create policy webhooks_read on webhooks for select using (has_perm(server_id, 256));
drop policy if exists webhooks_insert on webhooks;
create policy webhooks_insert on webhooks for insert with check (
  has_perm(server_id, 256) and created_by = current_app_user()
  and exists (select 1 from channels c where c.id = channel_id and c.server_id = webhooks.server_id and c.kind = 'text'));
drop policy if exists webhooks_update on webhooks;
create policy webhooks_update on webhooks for update
  using (has_perm(server_id, 256)) with check (has_perm(server_id, 256));
drop policy if exists webhooks_delete on webhooks;
create policy webhooks_delete on webhooks for delete using (has_perm(server_id, 256));

drop policy if exists messages_read on messages;
create policy messages_read on messages for select using (is_channel_reader(channel_id));
drop policy if exists messages_insert on messages;
create policy messages_insert on messages for insert with check (
  author_id = current_app_user() and webhook_id is null and can_send(channel_id));
drop policy if exists messages_update on messages;
create policy messages_update on messages for update
  using (author_id = current_app_user()) with check (author_id = current_app_user());
drop policy if exists messages_delete on messages;
create policy messages_delete on messages for delete using (
  author_id = current_app_user()
  or exists (select 1 from channels c where c.id = channel_id and c.server_id is not null
                                        and has_perm(c.server_id, 32)));

-- Allow the RPCs above to be called by anonymous visitors (login/register).
grant execute on function register_account(text, text), login_account(text, text),
  logout_account(), create_server(text, text, text), join_server(text), reset_invite(uuid),
  open_dm(uuid), execute_webhook(text, text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- storage ----
-- Public bucket for avatars, banners, server icons, chat attachments.
-- Size and MIME limits are enforced by the bucket itself.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 26214400, array[
  'image/jpeg', 'image/webp', 'image/gif', 'image/png',
  'video/mp4', 'video/webm', 'audio/mpeg', 'audio/ogg', 'audio/wav',
  'application/pdf', 'text/plain', 'application/zip'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists media_read on storage.objects;
create policy media_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'media');
drop policy if exists media_upload on storage.objects;
create policy media_upload on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = current_app_user()::text);
