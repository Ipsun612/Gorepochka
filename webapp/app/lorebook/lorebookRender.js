import {
  lorebookState as p,
  cleanLoreText,
  cleanLoreTitle,
  splitKeywords,
  isLorebookDirty,
  validLorebookDraft,
} from './lorebookState.js';

export const lorebookEls = Object.fromEntries(
  [
    'lorebookScreen',
    'lorebookTitle',
    'lorebookBack',
    'lorebookSave',
    'lorebookStatus',
    'lorebookError',
    'lorebookReload',
    'lorebookPrimary',
    'lorebookEntries',
    'lorebookAdd',
    'lorebookCount',
    'lorebookEmpty',
    'lorebookForm',
    'lorebookBtn',
    'lorebookDiscard',
    'lorebookDiscardTitle',
    'lorebookDiscardDescription',
    'lorebookKeepEditing',
    'lorebookDiscardConfirm',
  ].map((id) => [id, document.getElementById(id)]),
);
export const userLoreControls = [];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function buildLorebookControls(onChange, onDelete) {
  const e = lorebookEls;
  e.lorebookPrimary.textContent = '';
  for (const entry of Object.values(p.primary)) {
    const card = element('details', 'lore-entry lore-primary');
    card.appendChild(
      element(
        'summary',
        '',
        entry.comment ||
          Array.from(entry.content).slice(0, 70).join('') + (Array.from(entry.content).length > 70 ? '…' : ''),
      ),
    );
    card.appendChild(
      element(
        'p',
        'lore-badge',
        'Только для чтения · ' + (entry.constant ? 'Постоянная запись' : 'По ключевым словам'),
      ),
    );
    const keys = element('div', 'lore-keywords');
    for (const key of entry.key) keys.appendChild(element('span', 'lore-keyword', key));
    card.appendChild(keys);
    card.appendChild(element('p', 'lore-content', entry.content));
    e.lorebookPrimary.appendChild(card);
  }
  e.lorebookEntries.textContent = '';
  userLoreControls.length = 0;
  p.draft.forEach((entry, index) => {
    const field = element('fieldset', 'lore-entry');
    field.appendChild(element('legend', '', `Запись ${index + 1}`));
    const commentLabel = element('label', 'profile-label', 'Название (необязательно)');
    commentLabel.setAttribute('for', `lore-title-${index}`);
    const comment = element('input', 'lore-input lore-title-input');
    comment.type = 'text';
    comment.id = `lore-title-${index}`;
    comment.maxLength = 80;
    comment.value = entry.comment;
    comment.placeholder = 'Название записи';
    const commentCounter = element('p', 'profile-counter');
    commentCounter.id = `lore-title-counter-${index}`;
    comment.setAttribute('aria-describedby', commentCounter.id);
    comment.addEventListener('input', () => {
      entry.comment = comment.value;
      onChange();
    });
    const contentLabel = element('label', 'profile-label', 'Содержание');
    contentLabel.setAttribute('for', `lore-content-${index}`);
    const content = element('textarea', 'lore-input');
    content.id = `lore-content-${index}`;
    content.rows = 4;
    content.maxLength = 600;
    content.value = entry.content;
    content.placeholder = 'Факт или контекст, который стоит учитывать…';
    const counter = element('p', 'profile-counter');
    counter.id = `lore-counter-${index}`;
    content.setAttribute('aria-describedby', counter.id);
    content.addEventListener('input', () => {
      entry.content = content.value;
      onChange();
    });
    const keyLabel = element('label', 'profile-label', 'Ключевые слова');
    keyLabel.setAttribute('for', `lore-keys-${index}`);
    const keys = element('textarea', 'lore-input lore-key-input');
    keys.id = `lore-keys-${index}`;
    keys.rows = 2;
    keys.maxLength = 2000;
    keys.value = entry.key.join(', ');
    keys.placeholder = 'Через запятую или с новой строки';
    const keyCounter = element('p', 'profile-counter');
    keyCounter.id = `lore-key-counter-${index}`;
    keys.setAttribute('aria-describedby', `${keyCounter.id} lorebookKeywordHint`);
    keys.addEventListener('input', () => {
      entry.key = splitKeywords(keys.value);
      onChange();
    });
    const constantLabel = element('label', 'lore-constant');
    const constant = element('input');
    constant.type = 'checkbox';
    constant.checked = entry.constant;
    constant.addEventListener('change', () => {
      entry.constant = constant.checked;
      onChange();
    });
    constantLabel.appendChild(constant);
    constantLabel.appendChild(element('span', '', 'Всегда в контексте'));
    const remove = element('button', 'profile-link lore-remove', 'Удалить запись');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Удалить личную запись ${index + 1}`);
    remove.addEventListener('click', () => onDelete(index));
    for (const node of [
      commentLabel,
      comment,
      commentCounter,
      contentLabel,
      content,
      counter,
      keyLabel,
      keys,
      keyCounter,
      constantLabel,
      remove,
    ])
      field.appendChild(node);
    e.lorebookEntries.appendChild(field);
    userLoreControls.push({ field, comment, commentCounter, content, counter, keys, keyCounter, constant, remove });
  });
}
export function renderLorebook() {
  const e = lorebookEls;
  const locked = !p.loaded || p.loading || p.saving;
  userLoreControls.forEach((control, index) => {
    const entry = p.draft[index];
    const count = Array.from(cleanLoreText(entry.content)).length;
    const titleCount = Array.from(cleanLoreTitle(entry.comment)).length;
    control.field.disabled = locked;
    control.comment.disabled = locked;
    control.commentCounter.textContent = `${titleCount} / 40`;
    control.comment.setAttribute('aria-invalid', String(titleCount > 40));
    control.content.disabled = locked;
    control.keys.disabled = locked;
    control.constant.disabled = locked;
    control.remove.disabled = locked;
    control.counter.textContent = `${count} / 300`;
    control.content.setAttribute('aria-invalid', String(!count || count > 300));
    control.keyCounter.textContent = `${entry.key.length} / 10 · до 60 символов на ключ`;
    control.keys.setAttribute(
      'aria-invalid',
      String(
        entry.key.length > 10 ||
          entry.key.some((key) => Array.from(key).length > 60) ||
          (!entry.constant && !entry.key.length),
      ),
    );
  });
  e.lorebookCount.textContent = `${p.draft.length} / 3`;
  e.lorebookEmpty.classList.toggle('hidden', !p.loaded || p.draft.length > 0);
  e.lorebookAdd.disabled = locked || p.draft.length >= 3;
  e.lorebookSave.disabled = locked || p.conflict || !isLorebookDirty() || !validLorebookDraft();
  e.lorebookSave.textContent = p.saving ? 'Сохранение…' : 'Сохранить';
  e.lorebookBack.disabled = p.saving;
  e.lorebookReload.disabled = p.loading || p.saving;
  e.lorebookReload.classList.toggle('hidden', !p.error && !p.conflict);
  e.lorebookError.textContent = p.error;
  e.lorebookError.classList.toggle('hidden', !p.error);
  e.lorebookStatus.textContent = p.loading
    ? 'Загрузка лорбука…'
    : p.saving
      ? 'Сохранение изменений…'
      : !p.loaded
        ? 'Лорбук не загружен. Попробуйте ещё раз.'
        : !p.loaded.verified
          ? 'Локальные записи: исчезнут после перезапуска сервера.'
          : isLorebookDirty()
            ? 'Есть несохранённые изменения'
            : 'Личные записи — только для вас, во всех пяти диалогах';
}
