/* Local-only Telegram-style reactions. AI actions target a specific user wrap. */
import { state } from '../core/state.js';
import { chatEl, nearBottom, scrollLatest, updateLatest } from '../core/dom.js';
import { persist, isLiveSlot } from '../chat/chatState.js';
import { haptic } from '../core/telegram.js';
import { normalizeReaction } from '../core/reactionValue.js';

export const COMMON_REACTIONS = ['❤️', '👍', '👎', '🔥', '😂', '🥺', '😮', '😢', '👏', '🙏'];
const names = [
  'Сердце',
  'Нравится',
  'Не нравится',
  'Огонь',
  'Смех',
  'Умиление',
  'Удивление',
  'Грусть',
  'Аплодисменты',
  'Благодарность',
];
let target = null;
let targetSlot = null;
let initialized = false;
const picker = () => document.getElementById('reactionPicker');

export function setMessageReaction(wrap, value) {
  if (!wrap) return;
  const emoji = normalizeReaction(value);
  const bubble = wrap.querySelector('.bubble');
  if (!bubble) return;
  const follow = nearBottom();
  wrap.removeAttribute('data-reaction');
  bubble.querySelector('.bubble-reactions')?.remove();
  bubble.classList.toggle('has-reaction', Boolean(emoji));
  if (emoji) {
    wrap.setAttribute('data-reaction', emoji);
    const row = document.createElement('div');
    row.className = 'bubble-reactions';
    const pill = document.createElement(wrap.classList.contains('bot') ? 'button' : 'span');
    pill.className = 'reaction-pill';
    pill.setAttribute(
      'aria-label',
      `${wrap.classList.contains('bot') ? 'Ваша реакция' : 'Реакция Горепочки'}: ${emoji}`,
    );
    if (wrap.classList.contains('bot')) {
      pill.type = 'button';
      pill.setAttribute('aria-haspopup', 'dialog');
    }
    const emojiEl = document.createElement('span');
    emojiEl.className = 'reaction-emoji';
    emojiEl.textContent = emoji;
    pill.appendChild(emojiEl);
    pill.appendChild(buildReactionAvatar(wrap));
    row.appendChild(pill);
    bubble.insertBefore(row, bubble.querySelector('.meta'));
  }
  if (follow) scrollLatest();
  else updateLatest();
}

function reactorSourceId(wrap) {
  return wrap.classList.contains('bot') ? 'profileButtonAvatar' : 'botAvatar';
}

function buildReactionAvatar(wrap) {
  const isBotWrap = wrap.classList.contains('bot');
  const avatar = document.createElement('span');
  avatar.className = 'reaction-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  const fallback =
    (document.getElementById(reactorSourceId(wrap))?.textContent || '').trim().slice(0, 2) || (isBotWrap ? 'Я' : 'Г');
  const img = document.getElementById(reactorSourceId(wrap))?.querySelector?.('img');
  const src = img && typeof img.src === 'string' && img.src ? img.src : null;
  if (src) {
    const image = document.createElement('img');
    image.alt = '';
    image.decoding = 'async';
    image.onerror = () => {
      image.remove();
      avatar.textContent = fallback;
    };
    image.src = src;
    avatar.appendChild(image);
  } else {
    avatar.textContent = fallback;
  }
  return avatar;
}

export function refreshReactionAvatars() {
  if (!chatEl) return;
  const wraps = chatEl.querySelectorAll?.('.msg') || [];
  for (const wrap of wraps) {
    if (!wrap.getAttribute?.('data-reaction')) continue;
    const pill = wrap.querySelector?.('.reaction-pill');
    if (!pill) continue;
    const fresh = buildReactionAvatar(wrap);
    pill.querySelector?.('.reaction-avatar')?.remove?.();
    pill.appendChild(fresh);
  }
}

export function prepareMessageReactions(wrap, value) {
  if (wrap.classList.contains('bot')) {
    const bubble = wrap.querySelector('.bubble');
    bubble.setAttribute('tabindex', '0');
    bubble.setAttribute('aria-haspopup', 'dialog');
    bubble.setAttribute('aria-controls', 'reactionPicker');
    bubble.title = 'Нажмите, чтобы выбрать реакцию';
  }
  setMessageReaction(wrap, value);
}

export function closeReactionPicker(restoreFocus = false) {
  const previous = target;
  target = null;
  targetSlot = null;
  picker()?.classList.add('hidden');
  if (restoreFocus && previous && chatEl.contains(previous) && !state.profileOpen)
    previous.querySelector('.bubble')?.focus();
}

function canReact() {
  return isLiveSlot(state.activeId) && !state.managing && !state.profileOpen && !state.voiceActive;
}

export function openReactionPicker(wrap) {
  if (!wrap?.classList.contains('bot') || !chatEl.contains(wrap) || !canReact()) return;
  const panel = picker();
  if (target === wrap && !panel.classList.contains('hidden')) {
    closeReactionPicker(true);
    return;
  }
  target = wrap;
  targetSlot = state.activeId;
  panel.classList.remove('hidden');
  const buttons = panel.querySelectorAll('button');
  buttons.forEach((button, index) =>
    button.setAttribute('aria-pressed', String(COMMON_REACTIONS[index] === wrap.getAttribute('data-reaction'))),
  );
  // Position in the app root (not the scrolling chat), clamped to the visible chat.
  const root = document.getElementById('appRoot').getBoundingClientRect();
  const bounds = chatEl.getBoundingClientRect();
  const bubble = wrap.querySelector('.bubble').getBoundingClientRect();
  const width = Math.min(456, bounds.width - 12);
  panel.style.width = `${Math.max(0, width)}px`;
  const height = panel.getBoundingClientRect().height;
  panel.style.left = `${Math.max(bounds.left + 6, Math.min(bubble.left, bounds.right - width - 6)) - root.left}px`;
  const above = bubble.top - height - 8;
  panel.style.top = `${Math.max(bounds.top + 4, Math.min(above >= bounds.top ? above : bubble.bottom + 8, bounds.bottom - height - 4)) - root.top}px`;
  buttons[0]?.focus({ preventScroll: true });
  haptic('light');
}

export function initializeReactions() {
  if (initialized) return;
  initialized = true;
  const panel = picker();
  COMMON_REACTIONS.forEach((emoji, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = emoji;
    button.setAttribute('aria-label', names[index]);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      if (target && targetSlot === state.activeId && chatEl.contains(target) && canReact()) {
        setMessageReaction(target, target.getAttribute('data-reaction') === emoji ? null : emoji);
        persist();
        haptic('light');
      }
      closeReactionPicker(true);
    });
    panel.appendChild(button);
  });
  chatEl.addEventListener('click', (event) => {
    const wrap = event.target.closest?.('.msg');
    if (!wrap?.classList.contains('bot')) return;
    // Preserve links, text selections, and all media/control gestures.
    const pill = event.target.closest?.('.reaction-pill');
    if (
      !pill &&
      ['a', 'button', 'video', 'audio', 'input', '.bubble-voice', '.bubble-video'].some((selector) =>
        event.target.closest?.(selector),
      )
    )
      return;
    if (!pill && window.getSelection?.()?.toString()) return;
    if (event.target.closest?.('.bubble')) openReactionPicker(wrap);
  });
  chatEl.addEventListener('keydown', (event) => {
    if (event.target.classList?.contains('bubble') && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      openReactionPicker(event.target.closest('.msg'));
    }
  });
  document.addEventListener('click', (event) => {
    if (target && !panel.contains(event.target) && !target.contains(event.target)) closeReactionPicker();
  });
  panel.addEventListener('keydown', (event) => {
    const buttons = [...panel.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeReactionPicker(true);
    } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab'].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : (index +
                (event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey) ? -1 : 1) +
                buttons.length) %
              buttons.length;
      buttons[next]?.focus();
    }
  });
  chatEl.addEventListener('scroll', () => closeReactionPicker(), { passive: true });
  window.addEventListener('resize', () => closeReactionPicker());
  window.visualViewport?.addEventListener('resize', () => closeReactionPicker());
}
