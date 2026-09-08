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
 * Three things reach past that first pass without loosening it:
 *
 *   · **Sitelink titles.** A missing label does not mean a missing name. Shelly Tal Meron's
 *     item is labelled שלי מירון and carries no English label at all, but the English
 *     Wikipedia article about her is titled "Shelly Tal Meron" — which is the name, written
 *     by people who checked. Used only where the label is absent.
 *   · **Hebrew Wikipedia's search**, when Wikidata's finds nothing. Wikidata searches labels
 *     and aliases; Wikipedia searches article text, and finds people the other cannot —
 *     משה "קינלי" טור-פז returns nothing on Wikidata and his article on the first hit.
 *     A hit is accepted only when the article title is exactly the name; anything else is
 *     reported for review rather than guessed at.
 *   · **`WIKIDATA`**, below: an item id a person has ruled is the right one, or `null` to
 *     rule one out. That is the only way to accept a near-match, and the only place where a
 *     name that differs from what we hold can be attached to a candidate.
 *
 * And an exact name is still not an identity, so a match is refused outright when:
 *
 *   · **the person has died** (P570). Three matches failed on this alone — a Slavic scholar
 *     who died in 2012, a Greek-Jewish officer killed in 1940, and Shas's דוד אזולאי, who
 *     died in 2018 and whose name had already been rejected once for `mk` in the sibling
 *     script. Nobody on a 2026 candidate list has a date of death.
 *   · **more than one item matches the name exactly.** Wikidata holds six יורם כהן, and the
 *     first one the search happened to rank was a bare ORCID record. When a name resolves to
 *     several people it resolves to none of them.
 *   · **the item has no article in any language and no Hebrew description.** That is the
 *     shape of a record imported from ORCID or a thesis index — nobody has written about the
 *     person in Hebrew, so matching their Hebrew name is a coincidence.
 *
 * All three cost at most a name that stays Hebrew, which is the safe direction to fail in.
 *
 * What is left over is genuinely unpublished — private individuals whose name has never
 * been written in English or Arabic anywhere. Those keep `null` and stay Hebrew on screen,
 * which is the honest outcome; the report prints them so the gap is visible and countable
 * rather than silent.
 *
 * Also reports Wikidata's portrait (P18) for anyone who has one, since a party site that
 * carries no photographs may still have candidates who are public figures.
 *
 * A field listed in a candidate's `pinned` is left exactly as it is — that is how a name
 * typed into the candidate editor survives this script. Wikidata is the best automatic
 * source for the names it has, and it is still not better than a person who checked.
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
const HEWIKI = 'https://he.wikipedia.org/w/api.php';
/* Bumped when the shape of a cached answer changes, so old entries are re-fetched rather
   than read with fields that were never filled in. Cheaper than telling people to --refetch. */
const V = 3;
const UA = { 'User-Agent': 'israel-polls-2026-dashboard/1.0 (https://github.com/amitlev/israel-polls-2026; candidate name lookup)' };

const args = process.argv.slice(2);
const write = args.includes('--write');
const refetch = args.includes('--refetch');

/* Hebrew writes the same name several ways — geresh or not, hyphen or space, one vav or
   two — and Wikidata picked one of them. Compare on a form with all of that flattened, and
   keep the original for display. */
const norm = s => String(s || '')
  .replace(/"[^"]*"|\([^)]*\)/g, ' ')  /* the nickname a party prints: משה "קינלי" טור-פז */
  .replace(/[׳'`״"]/g, '')          /* ח'טיב and חטיב are the same person */
  .replace(/[-–—\u05be\s]/g, '')    /* אל-הואשלה, אל הואשלה, אלהואשלה — \u05be is the maqaf */
  .replace(/וו/g, 'ו').replace(/יי/g, 'י')   /* ווליד / ואליד */
  .trim();

/* A Wikipedia title carries a disambiguator the name does not: "משה כהן (פוליטיקאי)". */
const bare = t => t ? String(t).replace(/\s*\([^)]*\)\s*$/, '').trim() : null;

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
  /* Wikidata and Hebrew Wikipedia both know him as יאיא פינק / "Yaya Fink" — his nickname,
     not a different person. The item is his; the English spelling is pinned in the list. */
  'The_Democrats 5': 'Q122260479',   // יאיר פינק
  /* Found by reading the review report. Each is an article under a name that is not quite
     the one the party printed, which is the one thing no comparison can settle by itself. */
  'Together 29': 'Q116603688',       // שלי טל מירון — the item is labelled שלי מירון
  'Yashar 13': 'Q26265248',          // כמיל אבו רוקן — the item spells it כמיל אבו רוקון
  'Yashar 19': 'Q58059328',          // טל אוחנה חכמון — the item is טל אוחנה, before the married name
  /* null rejects a name outright. These are people Wikidata has under exactly this name who
     are demonstrably somebody else, and whom no automatic guard above catches. */
  /* Two living Israelis are called עמרי רונן — a lawyer and social activist, and a radio
     broadcaster — so the ambiguity guard refuses both. The portrait on the item is the same
     man as the one the party's site published. */
  'The_Democrats 7': 'Q133888758',
  /* Names shared by several people on Wikidata, where the description settles which one.
     אלי כהן is the extreme case: five living people share it exactly, and two more who have
     died were refused first — one of them the spy executed in Damascus in 1965. */
  'Likud 2': 'Q19634024',            // אלי כהן — "פוליטיקאי ישראלי, שר האנרגיה"
  'Likud 16': 'Q139384404',          // דוד פטר — "עורך דין ופרשן משפטי ישראלי", not the Czech rabbi
  'Likud 27': 'Q30005051',           // ארז תדמור — "פעיל פוליטי, פובליציסט ושדרן", not the film director
  'Shas 7': 'Q7054034',              // משה אבוטבול — "חבר כנסת וסגן שר", not the footballer
  'National_Unity 2': 'Q3663047',    // פנינה תמנו שטה — the item is labelled פנינה תמנו
  'Shas 9': 'Q96754353',             // יוסף טייב — the item is labelled יוסי טייב
  'Yashar 2': null,        // יורם כהן — six items share the name; none of them is this one
  'Together 10': null,     // יונתן שלו — the only item is a doctoral-thesis record from 1996
};

/* Fields on an otherwise-correct item that must not be used. Wikidata is edited by anyone,
   and a label can be wrong, or worse. Gaby Lasky's Arabic label is a slur; Yael Cohen
   Paran's Arabic label is a different politician's name; Orit Farkash-HaCohen's renders
   הכהן as "the Jew". The item is the right person in all three — the field is not. */
const DROP = {
  'The_Democrats 6': ['nameAr'],     // גבי לסקי
  'The_Democrats u17': ['nameAr'],   // יעל כהן פארן — ar reads ياعيل جرمان, Yael German
  'Yashar 3': ['nameAr'],            // אורית פרקש הכהן — ar reads أوريت فركاش اليهودي
};

const cache = fs.existsSync(CACHE) && !refetch ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Wikidata drops connections on a long run of small requests, so every call retries with
   backoff. The cache is what makes that cheap: a reset partway through costs the requests
   still outstanding, not the ones already answered. */
async function api(params, base = API) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(`${base}?${new URLSearchParams(params)}`, { headers: UA });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (attempt >= 4) throw e;
      await sleep(600 * (attempt + 1));
    }
  }
}

const ENTITY = { action: 'wbgetentities', format: 'json', props: 'labels|claims|descriptions|sitelinks',
  languages: 'en|ar|he', sitefilter: 'enwiki|arwiki' };

function shape(id, ent) {
  const L = ent.labels || {}, C = ent.claims || {}, S = ent.sitelinks || {}, D = ent.descriptions || {};
  const img = (C.P18 || [])[0]?.mainsnak?.datavalue?.value || null;
  /* Label first, then the title of that language's own article. An item can carry a Hebrew
     label and no English one while an English article about the same person exists — the
     name is published, it is just not in the field we looked at first. */
  return { v: V, id, he: L.he?.value ?? null,
    en: L.en?.value ?? bare(S.enwiki?.title) ?? null,
    ar: L.ar?.value ?? bare(S.arwiki?.title) ?? null,
    desc: D.he?.value || D.en?.value || null,
    descHe: D.he?.value || null,
    died: (C.P570 || []).length > 0,
    sites: Object.keys(S).length,
    img: img ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(img)}?width=800` : null };
}

/* Why an item cannot be this candidate, or null if nothing rules it out. Applies to every
   route that finds an item on its own; a `WIKIDATA` pin is a person's ruling and overrides
   it, though a pinned item that trips a guard is still reported. */
const disqualified = e =>
  e.died ? 'the item is a person who has died'
  : !e.sites && !e.descHe ? 'no article in any language and no Hebrew description'
  : null;

/* Every answer is stamped with V beside it, misses included — a miss is the entry most
   likely to be answerable by a new source, so bumping V has to re-try those too. The stamp
   is a separate key because an answer can be an object, an array or null. */
const fresh = k => cache[`${k}!`] === V;
const remember = (k, v) => { cache[k] = v; cache[`${k}!`] = V; return v; };

async function byId(id) {
  if (fresh(id)) return cache[id];
  const ents = (await api({ ...ENTITY, ids: id })).entities || {};
  await sleep(120);
  return remember(id, ents[id] ? shape(id, ents[id]) : null);
}

/* Every item whose Hebrew label is exactly this name — not the first one, which is what the
   search's own ranking would give you, and which is how a bare ORCID record beat five other
   people called יורם כהן. */
async function lookup(he) {
  if (fresh(he)) return cache[he];
  const hits = ((await api({ action: 'wbsearchentities', format: 'json', language: 'he',
    uselang: 'he', type: 'item', limit: '8', search: he })).search || []);
  const out = [];
  if (hits.length) {
    const ids = hits.map(h => h.id).join('|');
    const ents = (await api({ ...ENTITY, ids })).entities || {};
    for (const h of hits) {
      const ent = ents[h.id]; if (!ent) continue;
      const L = ent.labels || {}, C = ent.claims || {};
      const human = (C.P31 || []).some(c => c.mainsnak?.datavalue?.value?.id === 'Q5');
      if (!human) continue;
      if (norm(L.he?.value) !== norm(he)) continue;   /* exact Hebrew label only */
      out.push(shape(h.id, ent));
    }
  }
  await sleep(120);
  return remember(he, out);
}

/* Hebrew Wikipedia, for the people Wikidata's search cannot reach. Returns the item behind
   an article titled exactly this name — and, separately, whatever else the search turned up,
   which is a lead for a human and never an answer on its own. Hebrew Wikipedia has an
   article for almost every sitting MK and a good share of the rest; the whole reason it
   finds more is that it searches the article, not just the label. */
async function viaWiki(he) {
  const k = `wiki:${he}`;
  if (!fresh(k)) {
    const hits = ((await api({ action: 'query', format: 'json', list: 'search',
      srsearch: he, srlimit: '5', srnamespace: '0' }, HEWIKI)).query?.search || []).map(h => h.title);
    await sleep(150);
    let found = [];
    if (hits.length) {
      const pages = Object.values((await api({ action: 'query', format: 'json',
        prop: 'pageprops', ppprop: 'wikibase_item', titles: hits.join('|') }, HEWIKI)).query?.pages || {});
      await sleep(150);
      found = pages.map(p => ({ title: p.title, id: p.pageprops?.wikibase_item }))
        .filter(p => p.id)
        .sort((a, b) => hits.indexOf(a.title) - hits.indexOf(b.title));
    }
    remember(k, found);
  }
  const out = { exact: null, near: [] };
  for (const p of cache[k] || []) {
    const ent = await byId(p.id);
    if (!ent) continue;
    if (!out.exact && norm(bare(p.title)) === norm(he)) out.exact = ent;
    else out.near.push({ ...ent, title: p.title });
  }
  return out;
}

const report = { en: 0, ar: 0, both: 0, none: [], img: [], pinned: [], viaWiki: [],
  review: [], matched: [], refused: [], ambiguous: [] };
let total = 0;

for (const file of fs.readdirSync(LISTS).filter(f => f.endsWith('.json'))) {
  const p = path.join(LISTS, file);
  const list = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const c of [...(list.candidates || []), ...(list.unranked || [])]) {
    total++;
    const slug = file.replace('.json', '');
    const key = `${slug} ${c.rank ?? c.photo}`;
    const who = `${list.partyName} ${c.rank ?? c.photo} ${c.name}`;
    const pinned_id = key in WIKIDATA;
    const pin = WIKIDATA[key];
    let hit = null;
    if (pinned_id) {
      /* A ruling, either way: an id to accept, or null to refuse the name outright. */
      hit = pin ? await byId(pin) : null;
      const why = hit && disqualified(hit);
      if (why) report.refused.push(`${who} — PINNED to ${hit.id}, which trips a guard: ${why}`);
    } else {
      const found = (await lookup(c.name)).filter(e => {
        const why = disqualified(e);
        if (why) report.refused.push(`${who} — ${e.id} refused: ${why} (${e.desc || ''})`);
        return !why;
      });
      if (found.length === 1) hit = found[0];
      else if (found.length > 1)
        report.ambiguous.push(`${who} — ${found.length} people share this name exactly: ` +
          found.map(f => `${f.id} ${f.desc || ''}`).join('; '));

      /* Only when Wikidata's own search came back with nothing — an item it did find and we
         rejected was rejected on purpose, and Wikipedia must not be a way around that. */
      if (!hit && !found.length) {
        const w = await viaWiki(c.name);
        const why = w.exact && disqualified(w.exact);
        if (why) report.refused.push(`${who} — ${w.exact.id} refused: ${why} (${w.exact.desc || ''})`);
        else if (w.exact) { hit = w.exact; report.viaWiki.push(`${who} — ${hit.id} ${hit.desc || ''}`); }
        if (!hit && w.near.length)
          report.review.push(`${who}\n` + w.near.map(n =>
            `      ${n.id}  ${n.title}  en=${n.en || '—'}  ar=${n.ar || '—'}  ${n.desc || ''}`).join('\n'));
      }
    }
    process.stdout.write(`\r  ${total} looked up`);
    /* What the editor offers as a portrait, keyed by the name we hold rather than by the
       route that found the item. */
    if (hit) cache[`hit:${c.name}`] = hit;
    /* Set by hand in the editor; Wikidata does not get to overwrite a person's decision. */
    const held = new Set(c.pinned || []);
    const drop = new Set(DROP[key] || []);
    for (const [f, v0] of [['nameEn', hit?.en ?? null], ['nameAr', hit?.ar ?? null]]) {
      const v = drop.has(f) ? null : v0;
      if (!held.has(f)) { c[f] = v; continue; }
      report.pinned.push(`${who} — ${f} pinned to ${c[f] ?? '—'}${c[f] === v ? '' : `, Wikidata says ${v ?? '—'}`}`);
    }
    if (c.nameEn) report.en++;
    if (c.nameAr) report.ar++;
    if (c.nameEn && c.nameAr) report.both++;
    /* Every accepted match, with the item's own description of who it is. An exact name is
       not proof of identity — the roll holds exactly one דוד אזולאי and it was the wrong one
       — so the full list has to stay readable by a person, not just countable. */
    if (hit) report.matched.push(`${who}\n      ${hit.id}  en=${hit.en || '—'}  ar=${hit.ar || '—'}  ${hit.desc || ''}`);
    if (!c.nameEn && !c.nameAr) report.none.push(who);
    if (hit?.img) report.img.push(`${key} ${c.name} — ${hit.img}`);
    if (total % 20 === 0) { fs.mkdirSync(path.dirname(CACHE), { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify(cache)); }
  }
  if (write) fs.writeFileSync(p, JSON.stringify(list, null, 2) + '\n');
}

fs.mkdirSync(path.dirname(CACHE), { recursive: true });
fs.writeFileSync(CACHE, JSON.stringify(cache));

console.log(`\n\n${total} candidates: ${report.en} have an English name, ${report.ar} Arabic, ${report.both} both.`);
console.log(`${report.none.length} have neither and stay Hebrew on screen.`);
if (report.pinned.length) {
  console.log(`\nPINNED — set by hand in the editor and left alone (${report.pinned.length})`);
  for (const l of report.pinned.sort()) console.log('  ' + l);
  console.log('');
}
console.log(`${report.img.length} have a Wikidata portrait.`);
if (!write) console.log('\nReport only — pass --write to apply.');
const show = (title, arr) => { if (arr.length) { console.log(`\n${title} (${arr.length})`); for (const l of arr.sort()) console.log('  ' + l); } };
/* An item can be found twice — once by Wikidata's search and again through its Wikipedia
   article — and refused both times. One line per refusal, not per route. */
show('REFUSED — an item matched the name and cannot be the person', [...new Set(report.refused)]);
show('AMBIGUOUS — the name resolves to several people, so it resolves to none', report.ambiguous);
if (report.viaWiki.length) {
  console.log(`\nFOUND THROUGH HEBREW WIKIPEDIA — article titled exactly this name (${report.viaWiki.length})`);
  for (const l of report.viaWiki.sort()) console.log('  ' + l);
}
fs.writeFileSync('.leaderheads/knesset/name-gaps.txt', report.none.join('\n'));
fs.writeFileSync('.leaderheads/knesset/wikidata-portraits.txt', report.img.join('\n'));
/* Leads, not answers. An article whose title is not exactly the name may be the same person
   under a shorter one (Shelly Tal Meron's is titled שלי מירון) or a stranger who happens to
   share a surname, and nothing but a person reading the description can tell which. Pin the
   right ones by id in WIKIDATA above; the rest are noise and stay unpinned. */
fs.writeFileSync('.leaderheads/knesset/name-review.txt', report.review.join('\n'));
fs.writeFileSync('.leaderheads/knesset/name-matches.txt', report.matched.join('\n'));
console.log(`\n${report.review.length} candidates have a possible article under another title — review .leaderheads/knesset/name-review.txt and pin the right ids in WIKIDATA.`);
console.log('gaps → name-gaps.txt   matches → name-matches.txt   portraits → wikidata-portraits.txt   (all under .leaderheads/knesset/)');
