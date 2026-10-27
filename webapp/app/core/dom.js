/* DOM element refs + tiny UI helpers (toast, status, safe text rendering). */

export const chatEl = document.getElementById('chat');
export const inputEl = document.getElementById('input');
export const sendBtn = document.getElementById('sendBtn');
export const voiceBtn = document.getElementById('voiceBtn');
export const typingEl = document.getElementById('typing');
export const toastEl = document.getElementById('toast');
export const statusDot = document.getElementById('statusDot');
export const statusText = document.getElementById('statusText');
export const welcomeCard = document.getElementById('welcomeCard');
export const botAvatarEl = document.getElementById('botAvatar');
export const botTitleEl = document.getElementById('botTitle');

// --- Multi-chat elements (max 5 chats, each with its own history) ---
export const chatTabsEl = document.getElementById('chatTabs');
export const addChatBtn = document.getElementById('addChatBtn');
export const chatMenuEl = document.getElementById('chatMenu');
export const menuRenameBtn = document.getElementById('menuRenameBtn');
export const menuDeleteBtn = document.getElementById('menuDeleteBtn');
export const menuClearBtn = document.getElementById('newChatBtn');
export const modelBtn = document.getElementById('modelBtn');
export const lorebookBtn = document.getElementById('lorebookBtn');
export const chatMenuBtn = document.getElementById('chatMenuBtn');
export const archiveNotice = document.getElementById('archiveNotice');
export const latestBtn = document.getElementById('latestBtn');
export const announcement = document.getElementById('messageAnnouncement');
export const modalEl = document.getElementById('modal');
export const modalTitleEl = document.getElementById('modalTitle');
export const modalDescription = document.getElementById('modalDescription');
export const modalInputEl = document.getElementById('modalInput');
export const modalCancelBtn = document.getElementById('modalCancel');
export const modalOkBtn = document.getElementById('modalOk');

// --- Attachments (composer): one paperclip button + picker for images & text files ---
export const attachBtn = document.getElementById('attachBtn');
export const attachInput = document.getElementById('attachInput');
export const attachPreview = document.getElementById('attachPreview');
export const attachThumb = document.getElementById('attachThumb');
export const attachName = document.getElementById('attachName');
export const attachSize = document.getElementById('attachSize');
export const attachRemoveBtn = document.getElementById('attachRemove');

// --- Text-file attachment preview (shares the one picker above) ---
export const filePreview = document.getElementById('filePreview');
export const fileIcon = document.getElementById('fileIcon');
export const fileName = document.getElementById('fileName');
export const fileSize = document.getElementById('fileSize');
export const fileRemoveBtn = document.getElementById('fileRemove');

export const videoPreview = document.getElementById('videoPreview');
export const videoPlayer = document.getElementById('videoPlayer');
export const videoName = document.getElementById('videoName');
export const videoSize = document.getElementById('videoSize');
export const videoRemoveBtn = document.getElementById('videoRemove');
export const cancelSendBtn = document.getElementById('cancelSend');

let toastTimer = null;
let connection = { mode: '', text: 'Подключение…' };
let busy = false;
let managing = false;
let archived = false;
let chatVisible = true;

export function setChatVisible(value) {
  chatVisible = value;
}

export function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 4200);
}

export function setStatus(mode, text) {
  connection = { mode, text };
  if (busy) return;
  statusDot.className = `dot${mode ? ` ${mode}` : ''}`;
  statusText.textContent = text;
}

export function setBusy(b) {
  busy = b;
  updateComposer();
  typingEl.classList.toggle('hidden', !b);
  if (b) setActivity('Горепочка отвечает…');
  else statusText.textContent = connection.text;
  statusDot.className = `dot${b ? ' online' : connection.mode ? ` ${connection.mode}` : ''}`;
}

export function setActivity(text) {
  if (!busy) return;
  statusText.textContent = text;
  const label = typingEl.querySelector('em');
  if (label) label.textContent = text;
}

function updateComposer() {
  sendBtn.disabled = busy || managing || archived;
  attachBtn.disabled = busy || managing || archived;
  voiceBtn.disabled = busy || managing || archived;
  inputEl.disabled = managing || archived;
  inputEl.placeholder = archived ? 'Архив — только для чтения' : 'Сообщение…';
}

export function setManaging(value) {
  managing = value;
  updateComposer();
}

export function setArchived(value) {
  archived = value;
  archiveNotice.classList.toggle('hidden', !value);
  updateComposer();
}

export function nearBottom() {
  if (!chatVisible) return false;
  return chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 100;
}

export function updateLatest() {
  if (!chatVisible) return;
  latestBtn.classList.toggle('hidden', nearBottom());
}

export function scrollLatest() {
  if (!chatVisible) return;
  chatEl.scrollTop = chatEl.scrollHeight;
  updateLatest();
}

export function focusModal() {
  const focusable = modalInputEl.style.display !== 'none' ? modalInputEl : modalOkBtn;
  focusable.focus();
}

export function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Tiny safe renderer: code blocks, inline code, bold, links, line breaks.
export function renderText(raw) {
  let esc = escapeHtml(raw);
  const blocks = [];
  esc = esc.replace(/```([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre><code>${code.replace(/^\n+|\n+$/g, '')}</code></pre>`);
    return `\u0000BLOCK${blocks.length - 1}\u0000`;
  });
  esc = esc
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br>');
  esc = esc.replace(/\u0000BLOCK(\d+)\u0000/g, (_, i) => blocks[Number(i)] || '');
  return esc;
}

export function timeLabel(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}
