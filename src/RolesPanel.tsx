import { useEffect, useState } from 'react';
import * as api from './lib/api';
import { PERM, can } from './lib/types';
import type { Role } from './lib/types';

const BITS: [string, number][] = [
  ['Administrator', PERM.ADMIN],
  ['Manage server', PERM.MANAGE_SERVER],
  ['Manage channels', PERM.MANAGE_CHANNELS],
  ['Manage roles', PERM.MANAGE_ROLES],
  ['Kick members', PERM.KICK],
  ['Manage messages', PERM.MANAGE_MESSAGES],
  ['Send messages', PERM.SEND_MESSAGES],
  ['Attach files', PERM.ATTACH_FILES],
  ['Manage webhooks', PERM.MANAGE_WEBHOOKS],
  ['Manage invites', PERM.MANAGE_INVITES],
];

interface Props {
  serverId: string;
  myPerms: number;
  onClose: () => void;
  onError: (msg: string) => void;
}

export function RolesPanel({ serverId, myPerms, onClose, onError }: Props) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#0a84ff');
  const [perms, setPerms] = useState(0);

  const load = () =>
    Promise.resolve(api.listRoles(serverId))
      .then(setRoles)
      .catch((e: Error) => onError(e.message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  const create = async () => {
    if (!name.trim()) return;
    try {
      await api.createRole(serverId, name.trim(), color, perms);
      setName('');
      setPerms(0);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not create role');
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteRole(id);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not delete role');
    }
  };

  const toggle = (bit: number) => setPerms((p) => (p & bit ? p & ~bit : p | bit));

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="glass modal" onClick={(e) => e.stopPropagation()}>
        <strong>Roles</strong>
        {roles.map((r) => (
          <div key={r.id} className="composer-row" style={{ justifyContent: 'space-between' }}>
            <span style={{ color: r.color, fontWeight: 600 }}>{r.name}</span>
            {!r.is_default && can(myPerms, PERM.MANAGE_ROLES) && (
              <button className="btn" onClick={() => void remove(r.id)}>Delete</button>
            )}
          </div>
        ))}
        {can(myPerms, PERM.MANAGE_ROLES) && (
          <>
            <input className="input" placeholder="Role name" value={name} onChange={(e) => setName(e.target.value)} />
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Role colour" />
            <div className="theme-row">
              {BITS.filter(([, bit]) => can(myPerms, bit)).map(([label, bit]) => (
                <button key={bit} type="button" className={`btn ${perms & bit ? 'primary' : ''}`} onClick={() => toggle(bit)}>
                  {label}
                </button>
              ))}
            </div>
            <button className="btn primary" onClick={() => void create()}>Create role</button>
          </>
        )}
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
