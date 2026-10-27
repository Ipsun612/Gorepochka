import { api, chatPayload } from '../core/api.js';

export async function fetchServerHistory(chatId, limit = 50) {
  const params = new URLSearchParams({ chatId: String(chatId), limit: String(limit) });
  return api(`/api/chat/history?${params.toString()}`, null, { method: 'GET' });
}

export async function postReaction(chatId, messageId, reaction) {
  return api('/api/chat/reaction', { ...chatPayload(chatId), messageId, reaction }, { method: 'POST' });
}

export async function fetchChats() {
  return api('/api/chats', null, { method: 'GET' });
}

export async function saveChats(tabs, activeSlot, revision) {
  return api('/api/chats', { tabs, activeSlot, revision }, { method: 'PUT' });
}
