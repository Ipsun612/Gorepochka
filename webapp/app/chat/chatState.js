/* Multi-chat state on top of localStorage:
   chat list metadata (names) + per-slot display history + one-time migration.
   The server keeps the authoritative per-identity history via /api/new|chat. */

import { state, MAX_CHATS, MAX_MSG_LEN, LS_UI_KEY, LS_CHATS_KEY, slotKey } from '../core/state.js';
import { chatEl } from '../core/dom.js';
import { normalizeReaction } from '../core/reactionValue.js';

export function findChat(id) {
  return state.chats.find((c) => c.id === id) ?? null;
}

export function saveChatMeta() {
  try {
    localStorage.setItem(LS_CHATS_KEY, JSON.stringify({ chats: state.chats, activeId: state.activeId }));
  } catch (e) {}
}

export function removeSlot(chatId) {
  try {
    localStorage.removeItem(slotKey(chatId));
  } catch (e) {}
}

export function defaultChatName(id) {
  return `Диалог ${id}`;
}

export function isLiveSlot(id) {
  return Number.isInteger(id) && id >= 1 && id <= MAX_CHATS;
}

export function loadChatMeta() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(LS_CHATS_KEY) || 'null');
  } catch (e) {
    data = null;
  }
  if (data && Array.isArray(data.chats)) {
    const seen = new Set();
    state.chats = data.chats
      .filter((c) => c && Number.isInteger(c.id) && c.id >= 1)
      .filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      })
      .slice(0, MAX_CHATS)
      .map((c) => ({ id: c.id, name: String(c.name || '').slice(0, 32) || defaultChatName(c.id) }));
  }
  if (data && Number.isInteger(data.activeId) && findChat(data.activeId)) state.activeId = data.activeId;
  if (state.chats.length === 0) {
    state.chats = [{ id: 1, name: defaultChatName(1) }];
    if (!state.activeId) state.activeId = 1;
    saveChatMeta();
    migrateOldHistory();
  }
  if (!state.activeId) state.activeId = state.chats[0].id;
  saveChatMeta();
}

// One-time migration: messages saved before multi-chat existed now belong
// to slot 1 (the default chat).
function migrateOldHistory() {
  try {
    const old = localStorage.getItem(LS_UI_KEY);
    if (old && !localStorage.getItem(slotKey(1))) {
      localStorage.setItem(slotKey(1), old);
    }
    localStorage.removeItem(LS_UI_KEY);
  } catch (e) {}
}

// --- lightweight UI persistence (display only; server keeps the truth) ---
export function persist() {
  if (state.activeId === null) return;
  try {
    const items = [];
    const nodes = chatEl.querySelectorAll('.msg');
    for (let i = Math.max(0, nodes.length - 30); i < nodes.length; i++) {
      const n = nodes[i];
      const role = n.classList.contains('user') ? 'user' : 'bot';
      const textNode = n.querySelector('.bubble-text');
      const txt = textNode ? textNode.innerText || '' : '';
      const item = { role, text: txt.slice(0, MAX_MSG_LEN) };
      const reaction = normalizeReaction(n.getAttribute('data-reaction'));
      if (reaction) item[role === 'user' ? 'botReaction' : 'userReaction'] = reaction;
      if (n.querySelector('.bubble-attach-note')) item.attached = true;
      const createdAt = n.getAttribute('data-created-at');
      if (createdAt && Number.isFinite(Date.parse(createdAt))) item.createdAt = createdAt;
      // Cache only our own small JPEG thumbnails (never arbitrary URLs/schemes).
      const img = n.querySelector('.bubble-image');
      const src = img ? img.getAttribute('src') || '' : '';
      if (/^data:image\/jpeg;base64,/.test(src)) item.image = src;
      // Cache a tiny descriptor for an attached text file (never its contents).
      const fileBox = n.querySelector('.bubble-file');
      if (fileBox) {
        const nameEl = fileBox.querySelector('.bubble-file-name');
        const snipEl = fileBox.querySelector('.bubble-file-snippet');
        const fname = nameEl ? String(nameEl.textContent || '').slice(0, 120) : '';
        const snippet = snipEl ? String(snipEl.textContent || '').slice(0, 240) : '';
        if (fname || snippet) item.file = { name: fname, snippet };
      }
      const videoBox = n.querySelector('.bubble-video');
      if (videoBox && videoBox.videoDescriptor) item.video = videoBox.videoDescriptor;
      const voiceBox = n.querySelector('.bubble-voice');
      if (voiceBox?.voiceDescriptor) item.voice = voiceBox.voiceDescriptor;
      items.push(item);
    }
    localStorage.setItem(slotKey(state.activeId), JSON.stringify(items));
  } catch (e) {}
}
