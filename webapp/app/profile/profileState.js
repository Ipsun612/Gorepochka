/* Personal data stays in memory, never in localStorage or chat caches. */
export const profileState = {
  open: false,
  loaded: null,
  draft: { biography: '', day: '', month: '', year: '' },
  limits: { biographyMaxChars: 2000, birthdayMinYear: 1900, birthdayMaxYear: new Date().getUTCFullYear() },
  loading: false,
  saving: false,
  error: '',
  conflict: false,
};

export function draftOf(profile) {
  return {
    biography: profile.biography,
    day: profile.birthday ? String(profile.birthday.day) : '',
    month: profile.birthday ? String(profile.birthday.month) : '',
    year: profile.birthday?.year ? String(profile.birthday.year) : '',
  };
}
export function isProfileDirty() {
  return Boolean(
    profileState.loaded && JSON.stringify(profileState.draft) !== JSON.stringify(draftOf(profileState.loaded)),
  );
}
export function profileValidation() {
  const { draft, limits } = profileState;
  if (Array.from(draft.biography).length > limits.biographyMaxChars)
    return `О себе: не более ${limits.biographyMaxChars} символов.`;
  const { day, month, year } = draft;
  if (!day && !month && !year) return '';
  if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || (year && !/^\d{4}$/.test(year))) {
    return 'Укажите день и месяц. Год можно оставить пустым.';
  }
  const d = Number(day),
    m = Number(month),
    y = year ? Number(year) : 2000;
  if (
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > new Date(Date.UTC(y, m, 0)).getUTCDate() ||
    (year &&
      (y < limits.birthdayMinYear ||
        y > limits.birthdayMaxYear ||
        Date.UTC(y, m - 1, d) >
          Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())))
  ) {
    return 'Укажите существующую дату рождения, не позднее сегодняшнего дня.';
  }
  return '';
}
