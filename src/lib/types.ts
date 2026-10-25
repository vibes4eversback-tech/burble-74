export interface Profile {
  id: string;
  nickname: string;
  bio: string;
  avatar_url: string | null;
  banner_url: string | null;
}

export interface Server {
  id: string;
  name: string;
  icon_url: string | null;
  banner_url: string | null;
  owner_id: string;
  invite_code: string;
}

export interface Role {
  id: string;
  server_id: string;
  name: string;
  color: string;
  permissions: number;
  position: number;
  is_default: boolean;
}

export interface Channel {
  id: string;
  server_id: string | null;
  kind: 'text' | 'dm';
  name: string;
  topic: string;
  position: number;
}

export interface Webhook {
  id: string;
  server_id: string;
  channel_id: string;
  name: string;
  avatar_url: string | null;
  token: string;
}

export interface Attachment {
  url: string;
  name: string;
  type: string;
  kind: 'image' | 'video' | 'audio' | 'file' | 'gif' | 'link';
}

export interface Message {
  id: string;
  channel_id: string;
  author_id: string | null;
  webhook_id: string | null;
  author_name: string | null;
  content: string;
  attachments: Attachment[];
  created_at: string;
  edited_at: string | null;
}

// Permission bits, mirrored from the schema comments.
export const PERM = {
  ADMIN: 1,
  MANAGE_SERVER: 2,
  MANAGE_CHANNELS: 4,
  MANAGE_ROLES: 8,
  KICK: 16,
  MANAGE_MESSAGES: 32,
  SEND_MESSAGES: 64,
  ATTACH_FILES: 128,
  MANAGE_WEBHOOKS: 256,
  MANAGE_INVITES: 512,
} as const;

export function can(perms: number, bit: number): boolean {
  return (perms & PERM.ADMIN) === PERM.ADMIN || (perms & bit) === bit;
}
