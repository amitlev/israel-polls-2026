/*
 * Maps a gov.il filing's Hebrew "עורך הסקר" (pollster) legal name to the
 * English `pollster` key already used in window.BASE_POLLS_DATA (see
 * FIRM_OUTLET in update-polls.mjs for the reverse-direction precedent).
 * Unmapped names should be logged and skipped, never guessed.
 */
export const GOVIL_POLLSTER_MAP = {
  'מדגם יעוץ ומחקר': 'Midgam',
  'קנטאר ישראל': 'Kantar',
  'מאגר מוחות': 'Maagar Mochot',
  'מנחם לזר': 'Lazar',
  'ד"ר מנחם לזר': 'Lazar',
  'טאטיקה מחקרים ומדיה': 'Yossi Tatika',
  // Rosner is the on-air face of Channel 13's poll; the fieldwork/panel is Midgam's.
  'שמואל רוזנר': 'Midgam',
};

export function mapGovilPollster(hebrewName){
  const name = (hebrewName || '').trim();
  if (!name) return null;
  // Exact match first, then substring (PDF "עורך הסקר" values often carry a
  // "בראשות X" (headed by X) suffix not present in the map's legal names).
  if (GOVIL_POLLSTER_MAP[name]) return GOVIL_POLLSTER_MAP[name];
  const hit = Object.keys(GOVIL_POLLSTER_MAP).find(k => name.includes(k));
  return hit ? GOVIL_POLLSTER_MAP[hit] : null;
}
