/* Imports `nameEn` and `nameAr` from a CSV a person filled in by hand.
 *
 *   npm run import:names -- <file.csv>             report only, writes nothing
 *   npm run import:names -- <file.csv> --write     apply to lists/*.json
 *
 * The columns are the ones `name-gaps.csv` exports — מפלגה, דירוג, שם, אנגלית, ערבית — so the
 * round trip is: export the gaps, fill them in a spreadsheet, import them back. Rows are
 * matched on party and rank, never on the name, because the name is the thing being edited.
 *
 * Everything imported is PINNED. These are a person's answers, and `enrich:names` would
 * otherwise overwrite them on its next run from Wikidata — which is frequently the worse
 * source here. Three of the first file's spellings disagreed with Wikidata's label and
 * agreed with the English Wikipedia article title: Yaron Zelekha, Matti Sarfati Harkavi,
 * Keren Terner Eyal. A hand-filled name is not a guess to be corrected later.
 *
 * The Arabic is checked for mixed script before it is written. A Hebrew letter sitting inside
 * an Arabic word is invisible on screen and breaks search, sorting and text-to-speech, and it
 * is exactly the typo a Hebrew keyboard produces: the first file's "أمير ستروغו" ended in a
 * Hebrew vav where an Arabic waw belongs. Only the confusables below are corrected, each one
 * reported; anything else is refused rather than guessed at.
 */
import fs from 'node:fs';
import path from 'node:path';

const LISTS = 'assets/candidate-lists/lists';
const args = process.argv.slice(2);
const write = args.includes('--write');
const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('usage: import:names -- <file.csv> [--write]'); process.exit(1); }

/* Hebrew letters typed into an Arabic word, and the Arabic letter meant. Only letters whose
   counterpart is unambiguous — this is a typo table, not a transliterator. */
const CONFUSABLE = { 'ו': 'و', 'י': 'ي', 'ר': 'ر', 'ד': 'د', 'ז': 'ز', 'ט': 'ط' };

const isArabic = ch => { const o = ch.codePointAt(0);
  return (o >= 0x0600 && o <= 0x06FF) || (o >= 0x0750 && o <= 0x077F) || (o >= 0xFB50 && o <= 0xFEFF); };
const isHebrew = ch => { const o = ch.codePointAt(0); return o >= 0x0590 && o <= 0x05FF; };

/* A CSV reader that handles quoted fields — ותק carries ח"כ, which is quote-escaped. */
function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift().map(h => h.replace(/^﻿/, '').trim());
  return rows.filter(r => r.some(v => v.trim()))
    .map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const lists = {};
for (const f of fs.readdirSync(LISTS).filter(f => f.endsWith('.json'))) {
  const p = path.join(LISTS, f);
  lists[JSON.parse(fs.readFileSync(p, 'utf8')).partyName] = { p, list: JSON.parse(fs.readFileSync(p, 'utf8')) };
}

const report = { filled: 0, same: 0, changed: [], fixed: [], refused: [], unmatched: [] };

for (const r of parseCsv(fs.readFileSync(file, 'utf8'))) {
  const entry = lists[r['מפלגה']];
  if (!entry) { report.unmatched.push(`${r['מפלגה']} ${r['דירוג']} ${r['שם']} — no such party`); continue; }
  const key = r['דירוג'];
  const c = [...(entry.list.candidates || []), ...(entry.list.unranked || [])]
    .find(x => (x.rank != null ? String(x.rank) : x.photo) === key);
  if (!c) { report.unmatched.push(`${r['מפלגה']} ${key} ${r['שם']} — no such candidate`); continue; }
  const who = `${r['מפלגה']} ${key} ${c.name}`;

  const held = new Set(c.pinned || []);
  for (const [field, col] of [['nameEn', 'אנגלית'], ['nameAr', 'ערבית']]) {
    let v = r[col];
    if (!v) continue;

    if (field === 'nameAr' && [...v].some(isHebrew)) {
      const fixedChars = [];
      const out = [...v].map(ch => {
        if (!isHebrew(ch)) return ch;
        const sub = CONFUSABLE[ch];
        if (sub) { fixedChars.push(`${ch}→${sub}`); return sub; }
        fixedChars.push(null); return ch;
      });
      if (fixedChars.includes(null)) {
        report.refused.push(`${who} — Arabic contains Hebrew letters with no obvious counterpart: ${v}`);
        continue;
      }
      v = out.join('');
      report.fixed.push(`${who} — ${fixedChars.join(', ')} in "${v}"`);
    }
    if (field === 'nameAr' && ![...v].some(isArabic)) {
      report.refused.push(`${who} — the Arabic column holds no Arabic: ${v}`);
      continue;
    }

    if (!c[field]) report.filled++;
    else if (c[field] === v) report.same++;
    else report.changed.push(`${who} — ${field} ${c[field]} → ${v}`);
    c[field] = v;
    held.add(field);
  }

  delete c.pinned;
  if (held.size) c.pinned = ['name', 'nameEn', 'nameAr', 'gender', 'mk'].filter(k => held.has(k));
}

if (write) for (const { p, list } of Object.values(lists))
  fs.writeFileSync(p, JSON.stringify(list, null, 2) + '\n');

const show = (title, arr) => { if (arr.length) { console.log(`\n${title} (${arr.length})`); for (const l of arr) console.log('  ' + l); } };
show('UNMATCHED — no candidate at that party and rank', report.unmatched);
show('REFUSED', report.refused);
show('MIXED SCRIPT, corrected', report.fixed);
show('CHANGED — a value that was already there', report.changed);
console.log(`\n${report.filled} names filled in, ${report.same} already identical, ${report.changed.length} changed.`);
console.log(`Everything imported is pinned. ${write ? 'Written.' : 'Report only — pass --write to apply.'}`);
