/*
 * Maps a gov.il filing's Hebrew ballot-line label to the English party key used
 * in window.BASE_POLLS_DATA. Same contract as govil-pollster-map.mjs: an
 * unmapped label is reported and skipped, never guessed.
 *
 * The labels are free text a pollster typed, so they vary in every way text can:
 *
 *   "הליכוד בראשות בנימין נתניהו"
 *   "מפלג ת ישר! בראשות גדי איזנקוט"            ← pdf-parse splits a word
 *   "המילואמיניקים בראשות יועז הנדל"             ← the filing's own typo
 *   "רע\"מ בראשות מנסור עבאס"                    ← final mem for final nun
 *   "מפלגת ימין חדשה בראשות עופר וינטר"          ← a name we have never seen
 *
 * That last one is why every rule carries its leader as well as its name: a
 * pollster can invent a label for a list mid-cycle, but not a new leader for it.
 * Names are tried first and leaders only as a fallback, so a genuinely new party
 * under a familiar figure still comes back unmapped rather than being folded
 * into whatever that person led last.
 */

/* Both spellings of every quote mark, no vowel points, single spaces, and final
   letters folded — enough that a typo in the filing does not cost us a party. */
function norm(s){
  return (s || '')
    .replace(/[֑-ׇ]/g, '')            // niqqud / cantillation
    .replace(/["״“”]/g, '"')
    .replace(/['׳‘’]/g, "'")
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}
/* Final-form letters folded, so "רע\"מ" and "רע\"ם" are one string. */
const fold = s => norm(s).replace(/ם/g, 'מ').replace(/ן/g, 'נ').replace(/ך/g, 'כ').replace(/ף/g, 'פ').replace(/ץ/g, 'צ');

/* Order matters: the most specific name wins, so "ישראל ביתנו" and
   "עמך ישראל" are both settled before anything could match a bare "ישראל". */
const RULES = [
  { id: 'Yisrael Beiteinu',  names: ['ישראל ביתנו'],                     leaders: ['ליברמנ'] },
  { id: 'Amcha Yisrael',     names: ['עמכ ישראל'],                       leaders: ['וינטר'] },
  { id: 'Religious Zionism', names: ['הציונות הדתית'],                   leaders: ['סמוטריצ'] },
  { id: 'Otzma Yehudit',     names: ['עוצמה יהודית'],                    leaders: ['בנ גביר'] },
  { id: 'UTJ',               names: ['יהדות התורה', 'דגל התורה', 'אגודת ישראל'], leaders: ['גולדקנופפ'] },
  { id: 'Shas',              names: ['ש"ס'],                             leaders: ['דרעי'] },
  { id: 'Likud',             names: ['הליכוד'],                          leaders: ['נתניהו'] },
  { id: 'The Democrats',     names: ['הדמוקרטימ'],                       leaders: ['יאיר גולנ'] },
  { id: 'Yashar',            names: ['ישר!', 'ישר !'],                   leaders: ['איזנקוט'] },
  { id: 'Together',          names: ['ביחד', 'יחד'],                     leaders: ['נפתלי בנט'] },
  /* Zalicha is deliberately NOT a leader keyword. Where the filing names the joint list
     he is inside the name already; where it does not, it is because that pollster is
     testing his economic party as its own line beside Hendel's — and matching on him
     would then fold two separate rows onto one id and lose one of them. */
  { id: 'Reservists',        names: ['המילואימניקימ', 'המילואמיניקימ', 'המילואימניקיס'], leaders: ['הנדל'] },
  { id: 'Joint List',        names: ['הרשימה המשותפת', 'ובל"ד', 'חד"ש - תע"ל', 'חד"ש-תע"ל'], leaders: ['גבארינ', "ג'בארינ", "ג'אברינ", 'גאברינ'] },
  { id: "Ra'am",             names: ['רע"מ'],                            leaders: ['עבאס'] },
  { id: 'National Unity',    names: ['כחול לבנ'],                        leaders: ['בני גנצ'] },
  { id: 'Balad',             names: ['בל"ד'],                            leaders: ['אבו שחאדה'] },
  { id: 'Unity',             names: ['האחדות'],                          leaders: ['ארדנ'] },
];

/* Lists that really are on the ballot and that this project does not track. Named
   so an unmatched label can be reported as "known and untracked" rather than as a
   parsing failure — the difference between a party we chose to ignore and a column
   we are silently losing. Their votes still count towards the wasted share. */
const UNTRACKED = [
  'הציבור החרדי', 'נעמ', 'ישראל תחילה', 'עלה ירוק', 'הבית היהודי', 'מרצ', 'העבודה',
  /* Feiglin's Zehut, where a pollster tests it as its own list rather than folded into
     הציונות הדתית-זהות. It must NOT map to Religious Zionism — in that framing the two
     are separate lines on the same card and merging them would count the vote twice.
     The combined label still matches Religious Zionism by name, before this is reached. */
  'זהות',
  /* An aggregate bucket, not a party. Its votes are wasted votes and belong in the
     total; there is simply no list to attribute them to. */
  'מפלגות אחרות', 'אחרים',
  /* Zalicha's economic party where a pollster runs it separately from המילואימניקים. */
  'הכלכלית החדשה',
];

export function mapGovilParty(label){
  const f = fold(label);
  if (!f) return null;
  for (const r of RULES) if (r.names.some(n => f.includes(fold(n)))) return r.id;
  for (const r of RULES) if (r.leaders.some(l => f.includes(fold(l)))) return r.id;
  return null;
}

export function isKnownUntracked(label){
  const f = fold(label);
  return UNTRACKED.some(u => f.includes(fold(u)));
}
