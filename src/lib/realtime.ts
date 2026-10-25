import { supabase } from './supabase';
import type { Message } from './types';

// Live updates use Realtime broadcast, so no table publication is needed.
// Each text channel and DM has its own topic.
export type ChatEvent =
  | { type: 'message'; message: Message }
  | { type: 'typing'; userId: string; nickname: string }
  | { type: 'edit'; message: Message }
  | { type: 'delete'; id: string };

export function subscribeChannel(channelId: string, onEvent: (e: ChatEvent) => void) {
  const ch = supabase.channel(`burble:${channelId}`, { config: { broadcast: { self: false } } });
  ch.on('broadcast', { event: 'chat' }, ({ payload }) => onEvent(payload as ChatEvent)).subscribe();
  return {
    send(event: ChatEvent) {
      void ch.send({ type: 'broadcast', event: 'chat', payload: event });
    },
    close() {
      void supabase.removeChannel(ch);
    },
  };
}
