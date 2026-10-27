/* Chat DOM lifecycle: clearing the conversation and restoring cached history. */

import { chatEl, welcomeCard, scrollLatest } from '../core/dom.js';
import { MAX_MSG_LEN, slotKey } from '../core/state.js';
import { persist } from './chatState.js';
import { hideAssistantTags } from '../core/assistantReply.js';
import { videoDescriptor } from '../video/video.js';
import { voiceDescriptor } from '../voice/voice.js';
import { prepareMessageReactions, closeReactionPicker } from '../reactions/reactions.js';
import { fillBubble, appendDate, appendTimestamp } from './renderMessages.js';

export function clearChatDom() {
  closeReactionPicker();
  chatEl.querySelectorAll('.bubble-voice').forEach((box) => {
    box.disposeVoice?.();
  });
  chatEl.querySelectorAll('.bubble-video').forEach((box) => {
    if (box.disposeVideo) box.disposeVideo();
  });
  chatEl.querySelectorAll('.msg').forEach((n) => n.remove());
  chatEl.querySelectorAll('.date-separator').forEach((n) => n.remove());
  welcomeCard.style.display = '';
  scrollLatest();
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

export function restore(slotId) {
  try {
    const raw = localStorage.getItem(slotKey(slotId));
    const items = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(items)) return;
    const isThumb = (v) => typeof v === 'string' && /^data:image\/jpeg;base64,/.test(v);
    const fileOf = (v) => {
      if (!v || typeof v !== 'object') return null;
      const name = typeof v.name === 'string' ? v.name.replace(/^📄\s*/, '').slice(0, 120) : '';
      const snippet = typeof v.snippet === 'string' ? v.snippet.slice(0, 240) : '';
      return name || snippet ? { name, snippet } : null;
    };
    const valid = items
      .filter((m) => m && (m.role === 'user' || m.role === 'bot'))
      .map((m) => ({
        ...m,
        text: m.role === 'bot' ? hideAssistantTags(m.text).trim() : m.text,
      }))
      .filter((m) => {
        const hasText = typeof m.text === 'string' && m.text.length > 0;
        const hasImage = isThumb(m.image);
        const hasFile = Boolean(fileOf(m.file));
        return (
          hasText ||
          hasImage ||
          hasFile ||
          m.attached === true ||
          Boolean(videoDescriptor(m.video)) ||
          Boolean(voiceDescriptor(m.voice))
        );
      });
    if (valid.length === 0) {
      persist();
      return;
    }
    welcomeCard.style.display = 'none';
    for (const m of valid) {
      const timestamp = validTimestamp(m.createdAt);
      appendDate(timestamp);
      const wrap = document.createElement('div');
      wrap.className = `msg ${m.role}`;
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      fillBubble(
        bubble,
        (m.text || '').slice(0, MAX_MSG_LEN),
        isThumb(m.image) ? m.image : null,
        m.attached === true,
        fileOf(m.file),
        videoDescriptor(m.video),
        voiceDescriptor(m.voice),
      );
      appendTimestamp(wrap, bubble, timestamp);
      wrap.appendChild(bubble);
      chatEl.appendChild(wrap);
      prepareMessageReactions(wrap, m.role === 'user' ? m.botReaction : m.userReaction);
    }
    scrollLatest();
    persist(); // rewrite legacy caches with tag-free assistant text
  } catch (e) {}
}
