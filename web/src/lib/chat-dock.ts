/** Open the staff floating chat window, optionally on a lead thread with a suggested quote. */
export type ChatDockOpen = { leadId?: string; quoteId?: string | null };

export function openChatDock(opts: ChatDockOpen = {}) {
  window.dispatchEvent(new CustomEvent('se:chat-dock', { detail: opts }));
}

export const CHAT_DOCK_KEY = 'se.chatDock';
export interface ChatDockPersisted {
  open: boolean;
  view: 'inbox' | 'thread';
  inboxId: string | null;
  leadId: string | null;
  conversationId: string | null;
  quoteId: string | null;
}

export function loadChatDock(): ChatDockPersisted {
  try {
    const raw = sessionStorage.getItem(CHAT_DOCK_KEY);
    if (!raw) return { open: false, view: 'inbox', inboxId: null, leadId: null, conversationId: null, quoteId: null };
    const j = JSON.parse(raw);
    return {
      open: !!j.open,
      view: j.view === 'thread' ? 'thread' : 'inbox',
      inboxId: j.inboxId ?? null,
      leadId: j.leadId ?? null,
      conversationId: j.conversationId ?? null,
      quoteId: j.quoteId ?? null,
    };
  } catch {
    return { open: false, view: 'inbox', inboxId: null, leadId: null, conversationId: null, quoteId: null };
  }
}

export function saveChatDock(s: ChatDockPersisted) {
  try { sessionStorage.setItem(CHAT_DOCK_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}
