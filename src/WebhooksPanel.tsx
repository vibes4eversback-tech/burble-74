import { useEffect, useState } from 'react';
import * as api from './lib/api';
import { PERM, can } from './lib/types';
import type { Channel, Webhook } from './lib/types';

interface Props {
  serverId: string;
  userId: string;
  myPerms: number;
  channels: Channel[];
  onClose: () => void;
  onError: (msg: string) => void;
}

export function WebhooksPanel({ serverId, userId, myPerms, channels, onClose, onError }: Props) {
  const textChannels = channels.filter((c) => c.kind === 'text');
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [name, setName] = useState('');
  const [channelId, setChannelId] = useState(textChannels[0]?.id ?? '');
  const canManage = can(myPerms, PERM.MANAGE_WEBHOOKS);

  const load = async () => {
    try {
      setHooks(await api.listWebhooks(serverId));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not load webhooks');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  const create = async () => {
    if (!name.trim() || !channelId) return;
    try {
      await api.createWebhook(serverId, channelId, name.trim(), userId);
      setName('');
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not create webhook');
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteWebhook(id);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not delete webhook');
    }
  };

  const channelName = (id: string) => channels.find((c) => c.id === id)?.name ?? 'unknown';

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="glass modal" onClick={(e) => e.stopPropagation()}>
        <strong>Webhooks</strong>
        {hooks.length === 0 && <span>No webhooks yet.</span>}
        {hooks.map((h) => (
          <div key={h.id} className="composer-row" style={{ justifyContent: 'space-between', flexDirection: 'column', alignItems: 'stretch' }}>
            <div className="composer-row" style={{ justifyContent: 'space-between' }}>
              <span>
                {h.name} <small>#{channelName(h.channel_id)}</small>
              </span>
              {canManage && (
                <button className="btn" onClick={() => void remove(h.id)}>
                  Delete
                </button>
              )}
            </div>
            <small>
              POST {api.webhookExecuteUrl()} with {`{"p_token": "${h.token}", "p_content": "text"}`}
            </small>
          </div>
        ))}
        {canManage && textChannels.length > 0 && (
          <>
            <input className="input" placeholder="Webhook name" value={name} onChange={(e) => setName(e.target.value)} />
            <select className="input" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              {textChannels.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>
            <button className="btn primary" onClick={() => void create()}>
              Create webhook
            </button>
          </>
        )}
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
