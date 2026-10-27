import { chatEl, welcomeCard, scrollLatest } from '../core/dom.js';
import { MAX_MSG_LEN } from '../core/state.js';
import { clearChatDom } from '../chat/renderRestore.js';
import { fillBubble, appendDate, appendTimestamp } from '../chat/renderMessages.js';
import { prepareMessageReactions } from '../reactions/reactions.js';
import { persist } from '../chat/chatState.js';
import { hideAssistantTags } from '../core/assistantReply.js';
import { fetchServerHistory } from './historyApi.js';

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function lastCacheCreatedAt(slotId) {
  try {
    const { slotKey } = { slotKey: (id) => `miniapp-ui-history-v1#c${id}` };
    const raw = localStorage.getItem(slotKey(slotId));
    const items = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(items) || items.length === 0) return null;
    const last = items[items.length - 1];
    return typeof last?.createdAt === 'string' && Number.isFinite(Date.parse(last.createdAt)) ? last.createdAt : null;
  } catch {
    return null;
  }
}

function shouldReplaceWithServer(serverMessages, slotId) {
  if (!Array.isArray(serverMessages) || serverMessages.length === 0) return false;
  try {
    const { slotKey } = { slotKey: (id) => `miniapp-ui-history-v1#c${id}` };
    const raw = localStorage.getItem(slotKey(slotId));
    const cached = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(cached) || cached.length === 0) return true;
    const serverLast = serverMessages[serverMessages.length - 1];
    const cacheLast = cached[cached.length - 1];
    if (serverLast?.createdAt && cacheLast?.createdAt) {
      return Date.parse(serverLast.createdAt) > Date.parse(cacheLast.createdAt);
    }
    return serverMessages.length !== cached.length;
  } catch {
    return true;
  }
}

export function renderServerHistory(messages) {
  clearChatDom();
  if (!Array.isArray(messages) || messages.length === 0) {
    persist();
    return;
  }
  welcomeCard.style.display = 'none';
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'bot')) continue;
    const text = m.role === 'bot' ? hideAssistantTags(m.text || '').trim() : String(m.text || '');
    const hasText = text.length > 0;
    const hasMedia = Boolean(m.image || m.file || m.video || m.voice || m.hasImage || m.hasVideo || m.hasAudio);
    if (!hasText && !hasMedia) continue;
    const timestamp = validTimestamp(m.createdAt);
    appendDate(timestamp);
    const wrap = document.createElement('div');
    wrap.className = `msg ${m.role}`;
    if (typeof m.id === 'string' && m.id) wrap.setAttribute('data-message-id', m.id);
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const attached = Boolean((m.hasImage && !m.image) || (m.hasVideo && !m.video) || (m.hasAudio && !m.voice));
    fillBubble(
      bubble,
      text.slice(0, MAX_MSG_LEN),
      m.image || null,
      attached,
      m.file || null,
      m.video || null,
      m.voice || null,
    );
    appendTimestamp(wrap, bubble, timestamp);
    wrap.appendChild(bubble);
    chatEl.appendChild(wrap);
    prepareMessageReactions(wrap, m.role === 'user' ? m.botReaction : m.userReaction);
  }
  scrollLatest();
  persist();
}

export async function syncHistoryFromServer(slotId, limit = 50) {
  try {
    const data = await fetchServerHistory(slotId, limit);
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    if (!shouldReplaceWithServer(messages, slotId)) return { replaced: false, count: messages.length };
    const { state } = await import('../core/state.js');
    if (state.activeId !== slotId) return { replaced: false, count: messages.length };
    renderServerHistory(messages);
    return { replaced: true, count: messages.length };
  } catch {
    return { replaced: false, count: 0 };
  }
}

export { lastCacheCreatedAt };
