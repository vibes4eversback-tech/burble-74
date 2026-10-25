import { supabase, MEDIA_BASE } from './supabase';
import type { Attachment, Channel, Message, Profile, Role, Server, Webhook } from './types';

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export const getMyProfile = (id: string) =>
  supabase.from('profiles').select('*').eq('id', id).single().then(must<Profile>);

export const getProfiles = (ids: string[]) =>
  ids.length
    ? supabase.from('profiles').select('*').in('id', ids).then(must<Profile[]>)
    : Promise.resolve([] as Profile[]);

export const searchProfiles = (q: string) =>
  supabase.from('profiles').select('*').ilike('nickname', `%${q}%`).limit(20).then(must<Profile[]>);

export const updateProfile = (id: string, patch: Partial<Pick<Profile, 'bio' | 'avatar_url' | 'banner_url'>>) =>
  supabase.from('profiles').update(patch).eq('id', id).select().single().then(must<Profile>);

export const listMyServers = async (userId: string): Promise<Server[]> => {
  const members = must(
    await supabase.from('server_members').select('server_id').eq('user_id', userId),
  ) as { server_id: string }[];
  const ids = members.map((m) => m.server_id);
  if (!ids.length) return [];
  return must(await supabase.from('servers').select('*').in('id', ids).order('created_at'));
};

export const createServer = (name: string, icon: string | null, banner: string | null) =>
  supabase.rpc('create_server', { p_name: name, p_icon: icon, p_banner: banner }).then(must<string>);

export const joinServer = (code: string) =>
  supabase.rpc('join_server', { p_code: code }).then(must<string>);

export const resetInvite = (serverId: string) =>
  supabase.rpc('reset_invite', { p_server: serverId }).then(must<string>);

export const updateServer = (id: string, patch: Partial<Pick<Server, 'name' | 'icon_url' | 'banner_url'>>) =>
  supabase.from('servers').update(patch).eq('id', id).select().single().then(must<Server>);

export const deleteServer = (id: string) =>
  supabase.from('servers').delete().eq('id', id).then(must);

export const leaveServer = (serverId: string, userId: string) =>
  supabase.from('server_members').delete().eq('server_id', serverId).eq('user_id', userId).then(must);

export const listMembers = (serverId: string) =>
  supabase.from('server_members').select('user_id').eq('server_id', serverId).then(must<{ user_id: string }[]>);

export const listRoles = (serverId: string) =>
  supabase.from('roles').select('*').eq('server_id', serverId).order('position').then(must<Role[]>);

export const createRole = (serverId: string, name: string, color: string, permissions: number) =>
  supabase
    .from('roles')
    .insert({ server_id: serverId, name, color, permissions, position: 1 })
    .select()
    .single()
    .then(must<Role>);

export const updateRole = (id: string, patch: Partial<Pick<Role, 'name' | 'color' | 'permissions'>>) =>
  supabase.from('roles').update(patch).eq('id', id).select().single().then(must<Role>);

export const deleteRole = (id: string) => supabase.from('roles').delete().eq('id', id).then(must);

export const listMemberRoles = (serverId: string) =>
  supabase
    .from('member_roles')
    .select('user_id, role_id')
    .eq('server_id', serverId)
    .then(must<{ user_id: string; role_id: string }[]>);

export const setMemberRole = (serverId: string, userId: string, roleId: string, on: boolean) =>
  on
    ? supabase.from('member_roles').insert({ server_id: serverId, user_id: userId, role_id: roleId }).then(must)
    : supabase
        .from('member_roles')
        .delete()
        .eq('server_id', serverId)
        .eq('user_id', userId)
        .eq('role_id', roleId)
        .then(must);

export const kickMember = (serverId: string, userId: string) =>
  supabase.from('server_members').delete().eq('server_id', serverId).eq('user_id', userId).then(must);

export const listChannels = (serverId: string) =>
  supabase.from('channels').select('*').eq('server_id', serverId).order('position').then(must<Channel[]>);

export const createChannel = (serverId: string, name: string, position: number) =>
  supabase
    .from('channels')
    .insert({ server_id: serverId, kind: 'text', name, position })
    .select()
    .single()
    .then(must<Channel>);

export const updateChannel = (id: string, patch: Partial<Pick<Channel, 'name' | 'topic' | 'position'>>) =>
  supabase.from('channels').update(patch).eq('id', id).select().single().then(must<Channel>);

export const deleteChannel = (id: string) => supabase.from('channels').delete().eq('id', id).then(must);

export const listMyDms = async (userId: string): Promise<Channel[]> => {
  const rows = must(
    await supabase.from('dm_members').select('channel_id').eq('user_id', userId),
  ) as { channel_id: string }[];
  const ids = rows.map((r) => r.channel_id);
  if (!ids.length) return [];
  return must(await supabase.from('channels').select('*').in('id', ids).eq('kind', 'dm'));
};

export const listDmPeers = (channelIds: string[]) =>
  channelIds.length
    ? supabase.from('dm_members').select('channel_id, user_id').in('channel_id', channelIds).then(
        must<{ channel_id: string; user_id: string }[]>,
      )
    : Promise.resolve([] as { channel_id: string; user_id: string }[]);

export const openDm = (userId: string) => supabase.rpc('open_dm', { p_user: userId }).then(must<string>);

export const listMessages = (channelId: string, before?: string) => {
  let q = supabase
    .from('messages')
    .select('*')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (before) q = q.lt('created_at', before);
  return q.then(must<Message[]>).then((rows) => rows.reverse());
};

export const sendMessage = (channelId: string, authorId: string, content: string, attachments: Attachment[]) =>
  supabase
    .from('messages')
    .insert({ channel_id: channelId, author_id: authorId, content, attachments })
    .select()
    .single()
    .then(must<Message>);

export const editMessage = (id: string, content: string) =>
  supabase
    .from('messages')
    .update({ content, edited_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
    .then(must<Message>);

export const deleteMessage = (id: string) => supabase.from('messages').delete().eq('id', id).then(must);

export const listWebhooks = (serverId: string) =>
  supabase.from('webhooks').select('*').eq('server_id', serverId).then(must<Webhook[]>);

export const createWebhook = (serverId: string, channelId: string, name: string, userId: string) =>
  supabase
    .from('webhooks')
    .insert({ server_id: serverId, channel_id: channelId, name, created_by: userId })
    .select()
    .single()
    .then(must<Webhook>);

export const deleteWebhook = (id: string) => supabase.from('webhooks').delete().eq('id', id).then(must);

export function webhookExecuteUrl(): string {
  return `${MEDIA_BASE.split('/storage/')[0]}/rest/v1/rpc/execute_webhook`;
}

// Uploads go under <user id>/… in the public media bucket.
export async function uploadMedia(userId: string, file: File): Promise<string> {
  const safe = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
  const path = `${userId}/${Date.now()}-${safe}`;
  if (file.size > 25 * 1024 * 1024) throw new Error('Files must be 25 MB or smaller');
  const allowed = ['image/', 'video/', 'audio/', 'application/pdf', 'text/plain', 'application/zip'];
  if (!allowed.some((type) => file.type.startsWith(type) || file.type === type) && !file.name.toLowerCase().endsWith('.gif')) throw new Error('Unsupported file type');
  const { error } = await supabase.storage.from('media').upload(path, file, { contentType: file.type || 'image/gif' });
  if (error) throw new Error(error.message);
  return MEDIA_BASE + path;
}
