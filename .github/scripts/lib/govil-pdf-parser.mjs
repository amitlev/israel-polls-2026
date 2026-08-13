/*
 * Parses the text of a gov.il Section-16H poll-disclosure PDF (extracted via
 * pdf-parse) into structured fields. These PDFs are RTL Hebrew tables, and
 * pdf-parse's text extraction frequently splits a single visual cell across
 * multiple tab-separated tokens (rich-text formatting spans) without
 * reordering the digits themselves — see grabNumber() below.
 *
 * The disclosed *fields* are legally mandated but each firm generates its
 * own PDF, so the Hebrew label wording varies by pollster/vendor. Validated
 * directly against three real templates so far: Midgam/Lazar (share one
 * vendor's report template), Kantar (its own branded template), and Maagar
 * Mochot (a third, narrative-style template) — LABEL_ALIASES below carries
 * one entry per phrasing seen. An unvalidated pollster's template will
 * likely still return null for some fields (a label search that finds
 * nothing, not a wrong value) rather than throw — every field extractor is
 * independently nullable by design. Widening LABEL_ALIASES as new templates
 * turn up nulls in practice is expected ongoing maintenance, not a bug.
 */
import crypto from 'node:crypto';

const SEAT_QUESTION_MARKERS = ['לאיזו מפלגה היית מצביע', 'לאיזה מפלגה היית מצביע'];

// parseQuestionBlocks() keys off a literal "שאלה:" prefix to find seat/topical
// tables — true for the Midgam/Lazar-vendor and Maagar Mochot templates, but
// Kantar's template poses questions without that prefix (a different section
// convention, not just different wording), so undecidedPct/govilScenarios/
// topical come back empty for Kantar specifically until that's added. The
// metadata fields above are unaffected — they're found independently per-field.

function stripNoise(text){
  return text
    .replace(/--\s*\d+\s+of\s+\d+\s*--/g, ' ')   // pdf-parse page-break markers
    .replace(/`/g, '׳');                     // stray backtick -> Hebrew geresh (ג׳, סמוטריץ׳)
}

function headerSegment(text){
  const idx = text.indexOf('שאלה:');
  return idx >= 0 ? text.slice(0, idx) : text;
}

/* Strips all whitespace from the window after `label`, then takes the first digit run.
   Whitespace-stripping is safe here because Hebrew qualifier words between a label and
   its number (e.g. "מספר המשיבים <TAB> לסקר <TAB> בפועל <TAB> 502") never themselves
   contain digits, so the first digit run found is always the target value. */
function grabNumber(text, label, maxLen = 100){
  const idx = text.indexOf(label);
  if (idx < 0) return null;
  const window = text.slice(idx + label.length, idx + label.length + maxLen).replace(/\s+/g, '');
  const m = window.match(/\d[\d,]*(?:\.\d+)?/);
  return m ? parseFloat(m[0].replace(/,/g, '')) : null;
}

function grabText(text, label, stopLabels = [], maxLen = 200){
  const idx = text.indexOf(label);
  if (idx < 0) return null;
  let rest = text.slice(idx + label.length, idx + label.length + maxLen);
  let stopAt = rest.length;
  for (const s of stopLabels){ const p = rest.indexOf(s); if (p >= 0 && p < stopAt) stopAt = p; }
  rest = rest.slice(0, stopAt).replace(/[\t\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return rest || null;
}

// All the field-boundary labels seen across templates, used as a shared stop
// set for grabText so a text field never bleeds into the next one regardless
// of which alias matched.
const ALL_LABELS = [
  'מזמין הסקר', 'שם הגוף שהזמין את הסקר', 'עורך הסקר', 'הגורם שערך את הסקר',
  'שכתובתה', 'מועד איסוף הנתונים', "תאריכי", "התאריכים", 'שיטת הדגימה',
  'גודל המדגם ההתחלתי', 'גודל מדגם התחלתי', 'סוגי האוכלוסייה', 'סוג האוכלוסייה',
  'מספר המתבקשים', "מס' האנשים שהתבקשו", "מס' האנשים אליהם פנו",
  'מספר המשיבים', "מס' האנשים שהשתתפו", 'מספר האנשים שהשתתפו',
  'אחוז המשתתפים', 'שיעור ההיענות', 'שיעור היענות',
  'מספר האנשים ש', "מס' האנשים שסרבו", 'אחוז האנשים ש', 'שיעור האנשים שסרבו',
  'טעות הדגימה המרבית', 'מרווח הטעות', 'גודל הטעות הסטטיסטית',
  'שיטה סטטיסטית', 'אופן ביצוע הסקר', 'שאלה:',
];

function grabNumberAny(text, labels, maxLen = 100){
  for (const label of labels){
    const v = grabNumber(text, label, maxLen);
    if (v != null) return v;
  }
  return null;
}
function grabTextAny(text, labels, maxLen = 200){
  for (const label of labels){
    const v = grabText(text, label, ALL_LABELS.filter(l => l !== label), maxLen);
    if (v) return v;
  }
  return null;
}

function parseIsraeliDate(s){
  const m = (s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function topicHash(...parts){
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
}

export function parseMetadata(text){
  const h = headerSegment(stripNoise(text));
  return {
    commissioner: grabTextAny(h, ['מזמין הסקר', 'שם הגוף שהזמין את הסקר']),
    pollsterRaw: grabTextAny(h, ['עורך הסקר', 'הגורם שערך את הסקר']),
    fieldworkDate: parseIsraeliDate(grabText(h, 'מועד איסוף הנתונים', ALL_LABELS, 40)),
    samplingMethod: grabTextAny(h, ['שיטת הדגימה']),
    targetSampleSize: grabNumberAny(h, ['גודל המדגם ההתחלתי', 'גודל מדגם התחלתי']),
    populationSampled: grabTextAny(h, ['סוגי האוכלוסייה שנדגמו', 'סוג האוכלוסייה']),
    invited: grabNumberAny(h, ['מספר המתבקשים להשתתף', "מס' האנשים שהתבקשו להשתתף בסקר", "מס' האנשים אליהם פנו"]),
    respondents: grabNumberAny(h, ['מספר המשיבים', "מס' האנשים שהשתתפו בסקר בפועל", 'מספר האנשים שהשתתפו בסקר בפועל']),
    responseRate: grabNumberAny(h, ['אחוז המשתתפים בסקר', 'שיעור ההיענות לסקר', 'שיעור היענות']),
    refused: grabNumberAny(h, ['מספר האנשים ש', "מס' האנשים שסרבו"]),
    refusedPct: grabNumberAny(h, ['אחוז האנשים ש', 'שיעור האנשים שסרבו']),
    marginOfError: grabNumberAny(h, ['טעות הדגימה המרבית', 'מרווח הטעות', 'גודל הטעות הסטטיסטית']),
    statisticalMethod: grabTextAny(h, ['שיטה סטטיסטית']),
    mode: grabTextAny(h, ['אופן ביצוע הסקר'], 60),
  };
}

/* Pops trailing numeric tab-separated tokens off a table row line and joins
   the rest as the row's label — e.g. "ביחד\tבראשות\tנפתלי בנט\t15\t11.5%"
   -> { label: "ביחד בראשות נפתלי בנט", seats: 15, pct: 11.5 }. */
function parseRow(line){
  const tokens = line.split('\t').map(t => t.trim()).filter(Boolean);
  const nums = [];
  while (tokens.length && /^\d+(\.\d+)?%?$/.test(tokens[tokens.length - 1])){
    nums.unshift(tokens.pop());
  }
  const label = tokens.join(' ').trim();
  if (!label || !nums.length) return null;
  const pctTok = nums.find(t => t.includes('%'));
  const seatTok = nums.find(t => !t.includes('%'));
  return {
    label,
    seats: seatTok != null ? parseInt(seatTok, 10) : null,
    pct: pctTok != null ? parseFloat(pctTok) : null,
  };
}

function cleanLines(text){
  return text.split('\n')
    .map(l => l.replace(/\r$/, ''))
    .filter(l => l.trim() && !/^--\s*\d+\s+of\s+\d+\s*--$/.test(l.trim()));
}

/* Splits the full text into "שאלה:"-prefixed blocks, classifying each as a
   seat-projection table (main + what-if scenarios) or a topical opinion
   question, and parses the rows of each. */
export function parseQuestionBlocks(text){
  const lines = cleanLines(stripNoise(text));
  const qIdx = [];
  lines.forEach((l, i) => { if (l.trim().startsWith('שאלה:')) qIdx.push(i); });

  const seatTables = [];
  const topical = [];

  qIdx.forEach((start, bi) => {
    const end = bi + 1 < qIdx.length ? qIdx[bi + 1] : lines.length;
    const block = lines.slice(start, end);

    // Reassemble the (possibly multi-line-wrapped) question text up through its "?".
    let qEnd = 0;
    let qText = '';
    for (; qEnd < block.length; qEnd++){
      qText += (qText ? ' ' : '') + block[qEnd].replace(/\t/g, ' ');
      if (block[qEnd].includes('?')) { qEnd++; break; }
    }
    qText = qText.replace(/^שאלה:\s*/, '').replace(/\s+/g, ' ').trim();
    const body = block.slice(qEnd);
    const isSeatQuestion = SEAT_QUESTION_MARKERS.some(m => qText.includes(m));

    if (isSeatQuestion){
      const parties = [];
      let undecidedPct = null;
      for (const line of body){
        if (line.trim().startsWith('סה"כ')) continue;
        if (line.trim().startsWith('לא החליטו')){
          const m = line.match(/(\d+(?:\.\d+)?)%/);
          undecidedPct = m ? parseFloat(m[1]) : null;
          continue;
        }
        if (line.trim().startsWith('*')) continue;
        if (/^מנדטים|^אחוז/.test(line.trim())) continue; // column-header rows
        if (/^\)?\*\(?$/.test(line.trim())) continue; // "(*)" footnote marker
        const row = parseRow(line);
        if (row && row.seats != null) parties.push({ name: row.label, seats: row.seats, pctBefore: row.pct });
      }
      if (parties.length) seatTables.push({ label: qText, parties, undecidedPct });
    } else {
      // One question can present several "כלל/המדגם" sub-tables back to back
      // (e.g. separate PM-matchup pairs) — each becomes its own topical record.
      let i = 0;
      let sub = 0;
      while (i < body.length){
        if (body[i].trim() === 'כלל' && body[i + 1] && body[i + 1].trim() === 'המדגם'){
          i += 2;
          const responses = [];
          while (i < body.length && body[i].trim() !== 'כלל'){
            const row = parseRow(body[i]);
            if (row && row.pct != null) responses.push({ label: row.label, pct: row.pct });
            i++;
          }
          if (responses.length) topical.push({ label: qText, responses, subIndex: sub++ });
        } else {
          i++;
        }
      }
    }
  });

  return { seatTables, topical };
}

function classifyCategory(label){
  if (label.includes('ראש הממשלה') || label.includes('מתאים לתפקיד')) return 'pm-matchup';
  if (label.includes('סומך')) return 'trust';
  return 'policy';
}

/* Top-level entry point: parses one PDF's extracted text into the shapes
   consumed by the update-govil-polls.mjs merge step. */
export function parseGovilPdf(text, { sourceUrl } = {}){
  const metadata = parseMetadata(text);
  const { seatTables, topical } = parseQuestionBlocks(text);
  const [main, ...scenarios] = seatTables;

  const topicalRecords = topical.map(t => ({
    topicId: topicHash(t.label, t.subIndex),
    topicLabel: t.label,
    category: classifyCategory(t.label),
    responses: t.responses,
    sourceUrl,
  }));

  return {
    metadata,
    undecidedPct: main ? main.undecidedPct : null,
    govilScenarios: scenarios.map(s => ({ label: s.label, parties: s.parties, undecidedPct: s.undecidedPct })),
    topical: topicalRecords,
    sourceUrl,
  };
}
