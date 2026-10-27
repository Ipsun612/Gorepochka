import { characterState as p, isCharacterDirty, validCharacterDraft } from './characterState.js';

export const characterEls = Object.fromEntries(
  [
    'characterScreen',
    'characterTitle',
    'characterBack',
    'characterSave',
    'characterStatus',
    'characterError',
    'characterReload',
    'characterName',
    'characterUsername',
    'characterFullName',
    'characterAge',
    'characterBiography',
    'characterTabs',
    'characterGroups',
    'characterForm',
    'characterReset',
    'characterSummary',
    'characterDiscard',
    'characterKeepEditing',
    'characterDiscardConfirm',
    'botAvatar',
  ].map((id) => [id, document.getElementById(id)]),
);
export const traitControls = new Map();
const tabs = new Map();
const panels = new Map();
let catalogVersion = '';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function selectTraitGroup(id, focus = false) {
  if (!panels.has(id)) return;
  p.activeGroup = id;
  for (const [key, tab] of tabs) {
    tab.setAttribute('aria-selected', String(key === id));
    tab.tabIndex = key === id ? 0 : -1;
    panels.get(key).classList.toggle('hidden', key !== id);
  }
  if (focus) tabs.get(id).focus();
}

export function buildTraitControls(onEdit) {
  const version = JSON.stringify([p.groups, p.traits]);
  if (version === catalogVersion) return;
  catalogVersion = version;
  characterEls.characterTabs.textContent = '';
  characterEls.characterGroups.textContent = '';
  traitControls.clear();
  tabs.clear();
  panels.clear();
  for (const group of p.groups) {
    const tab = element('button', 'trait-tab', group.label);
    tab.type = 'button';
    tab.id = `trait-tab-${group.id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `trait-panel-${group.id}`);
    tab.addEventListener('click', () => selectTraitGroup(group.id));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = p.groups.findIndex((item) => item.id === group.id);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? p.groups.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + p.groups.length) % p.groups.length;
      selectTraitGroup(p.groups[next].id, true);
    });
    tabs.set(group.id, tab);
    characterEls.characterTabs.appendChild(tab);
    const panel = element('section', 'trait-panel');
    panel.id = `trait-panel-${group.id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panel.appendChild(element('p', 'trait-group-description', group.description));
    panels.set(group.id, panel);
    characterEls.characterGroups.appendChild(panel);
    for (const trait of p.traits.filter((item) => item.group === group.id)) {
      const field = element('fieldset', 'trait-block');
      field.appendChild(element('legend', '', trait.label));
      const hint = element('p', 'trait-hint', trait.hint);
      hint.id = `trait-hint-${trait.id}`;
      field.appendChild(hint);
      field.setAttribute('aria-describedby', hint.id);
      const choices = element('div', 'trait-options');
      const inputs = [];
      trait.levels.forEach((text, level) => {
        const label = element('label', 'trait-option');
        const input = element('input');
        input.type = 'radio';
        input.name = `trait-${trait.id}`;
        input.value = String(level);
        input.addEventListener('change', () => {
          if (input.checked) onEdit(trait.id, level);
        });
        label.appendChild(input);
        label.appendChild(element('span', '', text));
        choices.appendChild(label);
        inputs.push(input);
      });
      field.appendChild(choices);
      panel.appendChild(field);
      traitControls.set(trait.id, { field, inputs });
    }
  }
  selectTraitGroup(panels.has(p.activeGroup) ? p.activeGroup : p.groups[0].id);
}

export function renderCharacter() {
  const e = characterEls;
  const locked = !p.loaded || p.loading || p.saving;
  for (const [id, control] of traitControls) {
    control.field.disabled = locked;
    control.inputs.forEach((input, index) => {
      input.checked = p.draft[id] === index;
    });
  }
  e.characterSave.disabled = locked || p.conflict || !validCharacterDraft() || !isCharacterDirty();
  e.characterSave.textContent = p.saving ? 'Сохранение…' : 'Сохранить';
  e.characterBack.disabled = p.saving;
  e.characterReset.disabled = locked || p.traits.every((trait) => p.draft[trait.id] === p.defaults[trait.id]);
  e.characterReload.disabled = p.loading || p.saving;
  e.characterReload.classList.toggle('hidden', !p.error && !p.conflict);
  e.characterError.textContent = p.error;
  e.characterError.classList.toggle('hidden', !p.error);
  const modified = p.traits.filter((trait) => p.draft[trait.id] !== p.defaults[trait.id]);
  const changed = modified.length;
  for (const group of p.groups) {
    const count = p.traits.filter(
      (trait) => trait.group === group.id && p.draft[trait.id] !== p.defaults[trait.id],
    ).length;
    tabs.get(group.id).textContent = group.label + (count ? ` · ${count}` : '');
  }
  e.characterSummary.textContent = !p.loaded
    ? ''
    : !changed
      ? `Исходный характер: ${p.character.personalitySummary}`
      : `Изменено ${changed} из 15 черт: ` +
        modified
          .slice(0, 4)
          .map((trait) => `${trait.label.toLowerCase()} — ${trait.levels[p.draft[trait.id]]}`)
          .join('; ') +
        (changed > 4 ? `; и ещё ${changed - 4}` : '');
  e.characterStatus.textContent = p.loading
    ? 'Загрузка характера…'
    : p.saving
      ? 'Сохранение изменений…'
      : !p.loaded
        ? 'Профиль не загружен. Попробуйте ещё раз.'
        : !p.loaded.verified
          ? 'Локальная настройка: исчезнет после перезапуска сервера.'
          : isCharacterDirty()
            ? 'Есть несохранённые изменения'
            : p.loaded.revision === 0
              ? 'Исходный характер · только для вас'
              : 'Характер сохранён только для вас';
  if (p.character) {
    e.characterName.textContent = p.character.name;
    e.characterUsername.textContent = `@${p.character.username}`;
    e.characterFullName.textContent = p.character.fullName;
    e.characterAge.textContent = `${p.character.age} лет`;
    e.characterBiography.textContent = p.character.biography;
  }
}
