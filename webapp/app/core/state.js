/* Shared mutable state + storage keys for the Mini App.
   The server keeps the truth for chat history (per-slot keyed "<identity>#c<slot>");
   locally we keep a light per-slot display cache + chat metadata (names). */

export const MAX_CHATS = 5;
export const MAX_MSG_LEN = 4000;
export const BOT_NAME = 'Горепочка';

export const LS_UI_KEY = 'miniapp-ui-history-v1'; // per-slot: LS_UI_KEY + '#c' + chatId
export const LS_CHATS_KEY = 'miniapp-chats-v1'; // { chats: [{id, name}], activeId }
export const LS_CLIENT_KEY = 'miniapp-client-v1'; // anonymous dev-mode session id

export const state = {
  sending: false,
  managing: false,
  profileOpen: false,
  voiceActive: false,
  voicePhase: 'text',
  recordingMode: 'voice',
  modalMode: null, // 'rename' | 'delete' | 'clear' | 'info' | null
  chats: [],
  activeId: null,
  chatsRevision: 0,
  model: '',
  // Attachment limits (updated from /api/meta; defaults are conservative).
  maxImageBytes: 10 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
  maxVideoBytes: 100 * 1024 * 1024,
  maxVideoDurationSeconds: 300,
  maxVideoNoteDurationSeconds: 60,
  maxAudioBytes: 20 * 1024 * 1024,
  maxAudioDurationSeconds: 300,
  pendingVideo: null,
  // The image staged in the composer, ready to send: { dataUrl, thumb, name, size } | null
  pendingImage: null,
  // The text file staged in the composer: { dataUrl, name, size, chars, snippet } | null
  pendingFile: null,
};

export function slotKey(chatId) {
  return `${LS_UI_KEY}#c${chatId}`;
}
