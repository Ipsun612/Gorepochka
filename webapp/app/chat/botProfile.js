/* Bot profile sync: fixed persona name plus the optional Telegram avatar. */

import { botAvatarEl, botTitleEl } from '../core/dom.js';
import { BOT_NAME } from '../core/state.js';
import { refreshReactionAvatars } from '../reactions/reactions.js';

// The mini-app persona is fixed; Telegram supplies only its optional avatar.
export function applyBotProfile(bot) {
  if (botTitleEl) botTitleEl.textContent = BOT_NAME;
  if (!bot) return;
  const characterAvatar = document.getElementById('characterAvatar');
  if (characterAvatar) {
    characterAvatar.textContent = 'Г';
    if (bot.avatarUrl) {
      const image = document.createElement('img');
      image.alt = '';
      image.decoding = 'async';
      image.onerror = () => {
        characterAvatar.textContent = 'Г';
      };
      image.src = bot.avatarUrl;
      characterAvatar.textContent = '';
      characterAvatar.appendChild(image);
    }
  }
  if (!botAvatarEl) return;
  if (bot.avatarUrl && !botAvatarEl.querySelector('img')) {
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.onload = () => {
      botAvatarEl.innerHTML = '';
      botAvatarEl.appendChild(img);
      refreshReactionAvatars();
    };
    img.onerror = () => {
      img.remove();
      refreshReactionAvatars();
    };
    img.src = bot.avatarUrl;
  } else if (!bot.avatarUrl && !botAvatarEl.querySelector('img')) {
    const initial = BOT_NAME.charAt(0);
    if (initial && botAvatarEl.getAttribute('data-synced') !== '1') {
      botAvatarEl.setAttribute('data-synced', '1');
      botAvatarEl.innerHTML = '';
      const s = document.createElement('span');
      s.textContent = initial;
      s.setAttribute('aria-hidden', 'true');
      botAvatarEl.appendChild(s);
      refreshReactionAvatars();
    }
  }
}
