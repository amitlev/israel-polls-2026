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

/* pdf-parse sometimes wraps one response row over several lines, leaving the label
   on its own line(s) and the percentage alone on the next ("לא הוביל" / "לניצחון" /
   "62%"). Rejoin those; a column header never precedes a bare percentage, so it
   still reads as a table separator rather than a row. */
function takeWrappedRow(lines, i){
  const parts = [];
  for (let j = i; j < lines.length && parts.length < 3; j++){
    const t = lines[j].replace(/\t/g, ' ').trim();
    if (/^\d+(?:\.\d+)?%$/.test(t)){
      return parts.length ? { label: parts.join(' '), pct: parseFloat(t), next: j + 1 } : null;
    }
    if (/\d/.test(t)) return null;   // a normal row or numeric cell, not a wrapped label
    parts.push(t);
  }
  return null;
}

/* A question header: "שאלה:" possibly carrying an audience qualifier before the
   colon, as pdf-parse renders it ("שאלה\tלמצביעי האופוזיציה\t:\t…"). */
function isQuestionStart(line){
  return /^שאלה\s*[^:?]{0,40}:/.test(line.replace(/\t/g, ' ').trim());
}

/* Splits the full text into "שאלה:"-prefixed blocks, classifying each as a
   seat-projection table (main + what-if scenarios) or a topical opinion
   question, and parses the rows of each. */
export function parseQuestionBlocks(text){
  const lines = cleanLines(stripNoise(text));
  const qIdx = [];
  // Most questions open with a literal "שאלה:", but some carry an audience
  // qualifier before the colon ("שאלה <TAB> למצביעי האופוזיציה <TAB> : <TAB> ...").
  // Missing those didn't just lose the question — its rows were absorbed into the
  // PRECEDING question's block and rendered as extra responses on that question's
  // chart, so the qualifier form has to be recognised here.
  lines.forEach((l, i) => { if (isQuestionStart(l)) qIdx.push(i); });

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
    // Keep any audience qualifier in the label ("למצביעי האופוזיציה: לדעתך, …") —
    // it's what distinguishes the sub-population a question was asked of.
    qText = qText.replace(/^שאלה\s*/, '').replace(/^:\s*/, '').replace(/\s+:\s+/, ': ').replace(/\s+/g, ' ').trim();
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
        /* A row with a percentage but no seat number is a list the pollster measured and
           placed below the electoral threshold — "כחול לבן בראשות בני גנץ  0.8%". Those
           used to be dropped, which threw away the only vote shares this project has any
           access to: Wikipedia publishes seats and nothing else, so a party on 0 seats had
           no known size at all and the what-if panel had to ask the reader to assume one.
           They are also the whole of the wasted vote, which is what the 3.25% threshold is
           actually measured against. Keep any row that carries either number. */
        if (row && (row.seats != null || row.pct != null)) parties.push({ name: row.label, seats: row.seats, pctBefore: row.pct });
      }
      if (parties.length) seatTables.push({ label: qText, parties, undecidedPct });
    } else {
      // One question can present several sub-tables back to back (e.g. separate
      // PM-matchup pairs), each under its own column header. Rather than keying on
      // one literal header ("כלל"/"המדגם"), which silently swallowed tables headed
      // by a sub-population instead ("מתכוונים/להצביע/לאופוזיציה"), group runs of
      // consecutive percentage rows: any header line carries no percentage, so it
      // separates one sub-table from the next whatever it says.
      let i = 0;
      let sub = 0;
      while (i < body.length){
        const responses = [];
        while (i < body.length){
          const row = parseRow(body[i]);
          if (row && row.pct != null){ responses.push({ label: row.label, pct: row.pct }); i++; continue; }
          const wrapped = takeWrappedRow(body, i);
          if (!wrapped) break;
          responses.push({ label: wrapped.label, pct: wrapped.pct });
          i = wrapped.next;
        }
        // A lone percentage line is a stray footnote, not a table.
        if (responses.length >= 2) topical.push({ label: qText, responses, subIndex: sub++ });
        if (!responses.length) i++;
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

/* ── the main seat table, found by its shape rather than by its question ──
   parseQuestionBlocks() keys off a literal "שאלה:" prefix. Kantar's template poses its
   question without one, and words it "עבור איזו מפלגה היית מצביע" rather than the
   "לאיזו מפלגה" the markers list — so for that vendor the seat table was invisible and
   its vote shares were lost. Both facts are template trivia; the table itself is not.
   Every vendor's main table ends in a "סה"כ" row and holds rows carrying a percentage,
   a seat count, or both, so find it that way and the question wording stops mattering.
   Used only as a fallback, so the templates that already parse keep their existing path. */
function looseSeatRows(body){
  const rows = [];
  let carry = '';
  const isNums = toks => toks.length && toks.every(t => /^\d+(\.\d+)?%?$/.test(t));
  for (const line of body){
    const t = line.trim();
    if (!t || t.startsWith('*')) continue;
    if (t.startsWith('לא החליטו')) continue;
    if (/^\(?\s*נתונים גולמיים\s*\)?$/.test(t)) continue;
    if (/^(תחזית המנדטים|מנדטים|אחוזים)$/.test(t)) { carry = ''; continue; }
    const row = parseRow(line);
    if (row && (row.seats != null || row.pctBefore != null || row.pct != null)){
      rows.push({ name: (carry ? carry + ' ' : '') + row.label, seats: row.seats, pctBefore: row.pct });
      carry = '';
      continue;
    }
    /* pdf-parse wraps a long list name onto its own line(s) and leaves the numbers alone
       on the next — "…יועז הנדל וירון / זליכה / 4  3.3%". Rejoin those. */
    const toks = t.split('\t').map(x => x.trim()).filter(Boolean);
    if (isNums(toks) && carry){
      const pctTok = toks.find(x => x.includes('%')), seatTok = toks.find(x => !x.includes('%'));
      rows.push({ name: carry, seats: seatTok != null ? parseInt(seatTok, 10) : null,
                  pctBefore: pctTok != null ? parseFloat(pctTok) : null });
      carry = '';
      continue;
    }
    carry = carry ? carry + ' ' + t.replace(/\t/g, ' ') : t.replace(/\t/g, ' ');
  }
  return rows;
}

export function findMainSeatTable(text){
  const lines = cleanLines(stripNoise(text));
  const endIdx = lines.findIndex(l => l.trim().startsWith('סה"כ'));
  if (endIdx < 0) return null;
  /* Back up to the column header if there is one, otherwise take a bounded run of lines —
     far enough to hold the longest ballot, short enough not to reach the metadata block,
     whose "גודל המדגם ההתחלתי 550" would otherwise read as a party on 550 seats. */
  let start = -1;
  for (let i = endIdx - 1; i >= 0 && i > endIdx - 60; i--){
    if (/תחזית המנדטים|אחוזי התמיכה|^אחוזים$|^מנדטים$/.test(lines[i].trim())) { start = i + 1; break; }
  }
  if (start < 0) start = Math.max(0, endIdx - 40);
  const rows = looseSeatRows(lines.slice(start, endIdx));
  /* Accept only a table this reader clearly understood. Some vendors publish the main
     question as a multi-column TREND table — this week beside the last three — and
     pdf-parse flattens those columns into each other, so rows arrive with four numbers
     from four different weeks and neighbouring lists welded onto one line. That shape
     passes a naive "about 120 seats" check while being entirely wrong, and letting it
     through would poison the dataset with numbers nobody could trace. Reject anything
     that does not look like one clean ballot:
       · seats that were reported add up to about 120;
       · nearly every row carries a percentage, and those sum to about 100;
       · no list name still has a digit in it, which is the signature of column bleed. */
  if (rows.length < 5) return null;
  const seatSum = rows.reduce((a, r) => a + (r.seats || 0), 0);
  if (seatSum < 115 || seatSum > 125) return null;
  const withPct = rows.filter(r => r.pctBefore != null);
  if (withPct.length < rows.length * 0.8) return null;
  const pctSum = withPct.reduce((a, r) => a + r.pctBefore, 0);
  if (pctSum < 95 || pctSum > 105) return null;
  if (rows.some(r => /\d/.test(r.name))) return null;
  return rows;
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
    /* The main table's own rows, which used to be discarded in favour of its seat counts
       alone. They carry the raw vote share per list — including for the lists that won no
       seats — and that is the one thing the Wikipedia feed can never supply. */
    mainParties: main ? main.parties : findMainSeatTable(text),
    undecidedPct: main ? main.undecidedPct : null,
    govilScenarios: scenarios.map(s => ({ label: s.label, parties: s.parties, undecidedPct: s.undecidedPct })),
    topical: topicalRecords,
    sourceUrl,
  };
}
