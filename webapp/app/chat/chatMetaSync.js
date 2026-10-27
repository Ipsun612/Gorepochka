import { state, MAX_CHATS } from '../core/state.js';
import { toast } from '../core/dom.js';
import { findChat, saveChatMeta, defaultChatName } from './chatState.js';
import { renderTabs } from './chatTabs.js';
import { fetchChats, saveChats } from '../history/historyApi.js';

function normalizeTabs(tabs) {
  if (!Array.isArray(tabs)) return [{ id: 1, name: defaultChatName(1) }];
  const seen = new Set();
  const cleaned = tabs
    .filter((t) => t && Number.isInteger(t.slot) && t.slot >= 1 && t.slot <= MAX_CHATS)
    .filter((t) => {
      if (seen.has(t.slot)) return false;
      seen.add(t.slot);
      return true;
    })
    .slice(0, MAX_CHATS)
    .map((t) => ({ id: t.slot, name: String(t.name || '').slice(0, 32) || defaultChatName(t.slot) }));
  return cleaned.length > 0 ? cleaned : [{ id: 1, name: defaultChatName(1) }];
}

export async function syncChatsFromServer() {
  try {
    const data = await fetchChats();
    const meta = data?.chats;
    if (!meta || !Array.isArray(meta.tabs)) return false;
    const tabs = normalizeTabs(meta.tabs);
    const activeSlot =
      Number.isInteger(meta.activeSlot) && tabs.some((t) => t.id === meta.activeSlot) ? meta.activeSlot : tabs[0].id;
    const revision = Number.isInteger(meta.revision) ? meta.revision : 0;
    const same =
      state.activeId === activeSlot &&
      (state.chatsRevision ?? 0) === revision &&
      state.chats.length === tabs.length &&
      state.chats.every((c, i) => c.id === tabs[i].id && c.name === tabs[i].name);
    if (same) return false;
    state.chats = tabs;
    state.activeId = activeSlot;
    state.chatsRevision = revision;
    saveChatMeta();
    renderTabs();
    return true;
  } catch {
    return false;
  }
}

export async function pushChatsToServer() {
  try {
    const tabs = state.chats
      .filter((c) => Number.isInteger(c.id) && c.id >= 1 && c.id <= MAX_CHATS)
      .map((c) => ({ slot: c.id, name: String(c.name || '').slice(0, 32) || defaultChatName(c.id) }));
    const data = await saveChats(tabs, state.activeId, state.chatsRevision ?? 0);
    const meta = data?.chats;
    // Echo carries the new revision; keep local tabs/active (we just sent them)
    // so concurrent fire-and-forget pushes cannot clobber newer local state.
    if (meta && Number.isInteger(meta.revision)) {
      state.chatsRevision = meta.revision;
      saveChatMeta();
    }
    return true;
  } catch (error) {
    if (error && (error.code === 'CHATS_CONFLICT' || error.status === 409)) {
      toast('Диалоги изменены на другом устройстве. Загружена актуальная версия.');
      await syncChatsFromServer();
    }
    return false;
  }
}

export { normalizeTabs };
export function getChatMetaPayload() {
  return {
    tabs: state.chats.map((c) => ({ slot: c.id, name: c.name })),
    activeSlot: state.activeId,
    revision: state.chatsRevision ?? 0,
  };
}
export function findChatById(id) {
  return findChat(id);
}
