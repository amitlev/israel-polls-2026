/* Fills in `nameEn` and `nameAr` on candidates, from Wikidata.
 *
 * The dashboard is authored in Hebrew and translated by a phrase table, but people's names
 * are not phrases — they are data, and there is no table for them. So an Arabic or English
 * reader sees every one of the 120 faces labelled in Hebrew.
 *
 * Wikidata is the right source for the ones it has: it carries he/en/ar labels for public
 * figures, maintained by people who know how the name is actually written, which is not the
 * same as a transliteration produced from consonants. The Knesset's own OData service has
 * no English or Arabic names at all — it is Hebrew-only — so it cannot help here.
 *
 * Matching is deliberately narrow. A candidate is accepted only when Wikidata holds an item
 * whose HEBREW label is exactly the name we have, and which is an instance of human (Q5).
 * A near-match is not taken: "אלי כהן" would otherwise cheerfully resolve to whichever Eli
 * Cohen has the better-optimised item, and a wrong name on a face is worse than a Hebrew one.
 *
 * What is left over is genuinely unpublished — private individuals whose name has never
 * been written in English or Arabic anywhere. Those keep `null` and stay Hebrew on screen,
 * which is the honest outcome; the report prints them so the gap is visible and countable
 * rather than silent.
 *
 * Also reports Wikidata's portrait (P18) for anyone who has one, since a party site that
 * carries no photographs may still have candidates who are public figures.
 *
 *   npm run enrich:names             report only, writes nothing
 *   npm run enrich:names -- --write  apply to lists/*.json
 *   npm run enrich:names -- --refetch  ignore the cached lookups
 */
import fs from 'node:fs';
import path from 'node:path';

const LISTS = 'assets/candidate-lists/lists';
const CACHE = '.leaderheads/knesset/wikidata.json';
const API = 'https://www.wikidata.org/w/api.php';
const UA = { 'User-Agent': 'israel-polls-2026-dashboard/1.0 (https://github.com/amitlev/israel-polls-2026; candidate name lookup)' };

const args = process.argv.slice(2);
const write = args.includes('--write');
const refetch = args.includes('--refetch');

/* Hebrew writes the same name several ways — geresh or not, hyphen or space, one vav or
   two — and Wikidata picked one of them. Compare on a form with all of that flattened, and
   keep the original for display. */
const norm = s => String(s || '')
  .replace(/[׳'`״"]/g, '')          /* ח'טיב and חטיב are the same person */
  .replace(/[-–—\s]/g, '')          /* אל-הואשלה, אל הואשלה, אלהואשלה */
  .replace(/וו/g, 'ו').replace(/יי/g, 'י')   /* ווליד / ואליד */
  .trim();

/* Wikidata items a human has pinned, for candidates its Hebrew search cannot reach at all.
   Ra'am's Arab MKs are the case that forced this: all three are on Wikidata with full he/en/ar
   labels, but searching their Hebrew name returns zero hits, because the Hebrew spelling
   Wikidata holds differs from the one the Israeli press uses. When the search finds nothing
   there is no label left to compare, however forgiving the comparison — only an id helps.
   This matters more than the count suggests: for an Arab candidate the Arabic name is the
   real one, and leaving it out shows an Arabic reader a Hebrew transliteration of their own
   name. */
const WIKIDATA = {
  'Ra_am 3': 'Q67958229',    // ואליד טאהא — Wikidata has ווליד טאהא
  'Ra_am 4': 'Q115051875',   // ואליד אל-הואשלה — Wikidata has ואליד אלהואשלה
  'Ra_am 5': 'Q87125690',    // אימאן חטיב-יאסין — Wikidata has אימאן ח'טיב-יאסין
};

const cache = fs.existsSync(CACHE) && !refetch ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Wikidata drops connections on a long run of small requests, so every call retries with
   backoff. The cache is what makes that cheap: a reset partway through costs the requests
   still outstanding, not the ones already answered. */
async function api(params) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(`${API}?${new URLSearchParams(params)}`, { headers: UA });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (attempt >= 4) throw e;
      await sleep(600 * (attempt + 1));
    }
  }
}

function shape(id, ent) {
  const L = ent.labels || {}, C = ent.claims || {};
  const img = (C.P18 || [])[0]?.mainsnak?.datavalue?.value || null;
  return { id, en: L.en?.value ?? null, ar: L.ar?.value ?? null,
    img: img ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(img)}?width=800` : null };
}

async function byId(id) {
  if (id in cache) return cache[id];
  const ents = (await api({ action: 'wbgetentities', format: 'json',
    props: 'labels|claims', languages: 'en|ar|he', ids: id })).entities || {};
  const out = ents[id] ? shape(id, ents[id]) : null;
  cache[id] = out;
  await sleep(120);
  return out;
}

async function lookup(he) {
  if (he in cache) return cache[he];
  const hits = ((await api({ action: 'wbsearchentities', format: 'json', language: 'he',
    uselang: 'he', type: 'item', limit: '8', search: he })).search || []);
  let out = null;
  if (hits.length) {
    const ids = hits.map(h => h.id).join('|');
    const ents = (await api({ action: 'wbgetentities', format: 'json',
      props: 'labels|claims', languages: 'en|ar|he', ids })).entities || {};
    for (const h of hits) {
      const ent = ents[h.id]; if (!ent) continue;
      const L = ent.labels || {}, C = ent.claims || {};
      const human = (C.P31 || []).some(c => c.mainsnak?.datavalue?.value?.id === 'Q5');
      if (!human) continue;
      if (norm(L.he?.value) !== norm(he)) continue;   /* exact Hebrew label only */
      out = shape(h.id, ent);
      break;
    }
  }
  cache[he] = out;
  await sleep(120);
  return out;
}

const report = { en: 0, ar: 0, both: 0, none: [], img: [] };
let total = 0;

for (const file of fs.readdirSync(LISTS).filter(f => f.endsWith('.json'))) {
  const p = path.join(LISTS, file);
  const list = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const c of [...(list.candidates || []), ...(list.unranked || [])]) {
    total++;
    const pin = WIKIDATA[`${file.replace('.json', '')} ${c.rank ?? c.photo}`];
    const hit = pin ? await byId(pin) : await lookup(c.name);
    process.stdout.write(`\r  ${total} looked up`);
    c.nameEn = hit?.en ?? null;
    c.nameAr = hit?.ar ?? null;
    if (c.nameEn) report.en++;
    if (c.nameAr) report.ar++;
    if (c.nameEn && c.nameAr) report.both++;
    if (!c.nameEn && !c.nameAr) report.none.push(`${list.partyName} ${c.rank ?? c.photo} ${c.name}`);
    if (hit?.img) report.img.push(`${file.replace('.json','')} ${c.rank ?? c.photo} ${c.name} — ${hit.img}`);
    if (total % 20 === 0) { fs.mkdirSync(path.dirname(CACHE), { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify(cache)); }
  }
  if (write) fs.writeFileSync(p, JSON.stringify(list, null, 2) + '\n');
}

fs.mkdirSync(path.dirname(CACHE), { recursive: true });
fs.writeFileSync(CACHE, JSON.stringify(cache));

console.log(`\n\n${total} candidates: ${report.en} have an English name, ${report.ar} Arabic, ${report.both} both.`);
console.log(`${report.none.length} have neither and stay Hebrew on screen.`);
console.log(`${report.img.length} have a Wikidata portrait.`);
if (!write) console.log('\nReport only — pass --write to apply.');
fs.writeFileSync('.leaderheads/knesset/name-gaps.txt', report.none.join('\n'));
fs.writeFileSync('.leaderheads/knesset/wikidata-portraits.txt', report.img.join('\n'));
console.log('gaps → .leaderheads/knesset/name-gaps.txt   portraits → .leaderheads/knesset/wikidata-portraits.txt');
