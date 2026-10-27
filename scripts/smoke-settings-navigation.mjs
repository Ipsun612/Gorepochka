/* Shared by the real-shell smoke harness; settings remains a separately tested feature. */
import assert from 'node:assert/strict';

export async function checkSettingsNavigation({ els, state, keydown, importApp }) {
  const input = els.get('input');
  input.value = 'черновик';
  els.get('chatMenuBtn').dispatch('click');
  els.get('settingsBtn').dispatch('click');
  assert.equal(state.profileOpen, true);
  assert.equal(els.get('settingsScreen').classList.contains('hidden'), false);
  assert.equal(els.get('settingsVersion').textContent, 'Версия 3.7.0');
  els.get('changelogBtn').dispatch('click');
  assert.equal(els.get('changelogPage').classList.contains('hidden'), false);
  assert.match(els.get('changelogList').textContent, /тёмная тем/i);
  keydown('Escape', document.activeElement);
  assert.equal(els.get('settingsHome').classList.contains('hidden'), false);
  els.get('settingsBack').dispatch('click');
  assert.equal(state.profileOpen, false);
  assert.equal(input.value, 'черновик');
  assert.equal(document.activeElement, els.get('chatMenuBtn'));
  input.value = '';

  // Native Settings uses the same registered navigation and cannot discard a profile draft.
  const navigation = await importApp('profile/profileNavigation.js');
  const profile = await importApp('profile/profileActions.js');
  els.get('profileBtn').dispatch('click');
  await profile.loadUserProfile();
  els.get('profileBio').value = 'несохранённый профиль';
  els.get('profileBio').dispatch('input');
  navigation.requestProfileNavigation('settings');
  assert.equal(els.get('profileDiscard').classList.contains('hidden'), false);
  els.get('profileKeepEditing').dispatch('click');
  assert.equal(els.get('profileScreen').classList.contains('hidden'), false);
  els.get('profileBack').dispatch('click');
  els.get('profileDiscardConfirm').dispatch('click');
  assert.equal(state.profileOpen, false);
}

export function checkSettingsRecordingGuard({ els, state, openSettings }) {
  openSettings();
  assert.equal(state.profileOpen, false, 'settings cannot hide a live recording');
  assert.equal(els.get('voiceDiscard').classList.contains('hidden'), false);
  els.get('voiceKeep').dispatch('click');
}
