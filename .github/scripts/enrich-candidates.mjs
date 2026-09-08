/* Fills in `mk` and `gender` on every candidate in assets/candidate-lists/lists/.
 *
 * Both fields used to have no good source. `mk` was whatever the party printed on its
 * graphic — which works for Yisrael Beiteinu and fails completely for Together, whose
 * graphic prints no ח"כ marks at all, leaving five sitting MKs reading null. Gender had
 * no source whatsoever.
 *
 * The Knesset's own OData service answers both, for anyone who has ever been an MK:
 *
 *   KNS_Person            PersonID, FirstName, LastName, GenderDesc   (1,188 rows)
 *   KNS_PersonToPosition  PersonID, KnessetNum, PositionID=43 (=MK)   (2,982 rows)
 *
 * Small enough to pull whole and cache. From them:
 *
 *   holds an MK term now (IsCurrent)  → mk "current"
 *   held one and it has ended         → mk "former"
 *   in KNS_Person but never an MK,
 *     or not in KNS_Person at all     → mk "none"
 *   matched ambiguously               → mk null + verify
 *
 * `null` therefore stops meaning "the graphic said nothing" and starts meaning "not yet
 * determined" — a distinction the seat widget needs, because a null must not be quietly
 * grouped in with genuinely new candidates.
 *
 * KNS_Person is the complete roll of everyone who has ever served, so a candidate who is
 * absent from it really has never been an MK. The risk is not absence, it is a *missed*
 * match on someone who did serve, so matching is deliberately conservative and every
 * near-miss is printed rather than guessed at.
 *
 * Where the roster disagrees with what the party's own graphic printed, both are reported
 * and neither wins automatically — that is either a stale graphic or a bad match, and
 * both deserve a human.
 *
 * A field listed in a candidate's `pinned` is left exactly as it is. That is how a
 * correction made in the candidate editor survives this script: the roll is the best
 * automatic source, but it is not better than a person who looked. Pinned fields are
 * reported each run so a stale pin stays visible rather than silently outliving its reason.
 *
 *   npm run enrich:candidates             report only, writes nothing
 *   npm run enrich:candidates -- --write  apply to lists/*.json
 *   npm run enrich:candidates -- --refetch  ignore the cached API pull
 */
import fs from 'node:fs';
import path from 'node:path';

const LISTS = 'assets/candidate-lists/lists';
const CACHE = '.leaderheads/knesset';
const ODATA = 'https://knesset.gov.il/Odata/ParliamentInfo.svc';
/* KNS_Position is gendered: 43 is "חבר הכנסת" and 61 is "חברת הכנסת". Filtering on 43
   alone silently drops every woman in the Knesset's history — it read Naama Lazimi,
   Efrat Rayten and Shelly Tal Meron as having never served. */
const MK_POSITIONS = [43, 61];
const UA = { 'User-Agent': 'israel-polls-2026-dashboard/1.0 (https://github.com/amitlev/israel-polls-2026; candidate enrichment)' };

const args = process.argv.slice(2);
const write = args.includes('--write');
const refetch = args.includes('--refetch');

/* Gender for candidates the Knesset roll cannot answer — i.e. anyone who has never been
   an MK. Given names only, and only names that are unambiguous in Hebrew. Anything absent
   is left null and printed rather than guessed from morphology: a name ending in ה is
   usually feminine and sometimes very much not. */
const NAME_GENDER = {
  אבי: 'm', אבישי: 'm', אביתר: 'm', אחסאן: 'm', איהאב: 'm', איתי: 'm', אמיר: 'm',
  בנימין: 'm', גאלב: 'm', גרמי: 'm', דוד: 'm', דני: 'm', יאיר: 'm', יואב: 'm',
  יונתן: 'm',
  יעקב: 'm', ירון: 'm', יריב: 'm', ישראל: 'm', מאלכ: 'm', משה: 'm', נאור: 'm',
  נדאל: 'm', ניסן: 'm', נמרוד: 'm', עאיד: 'm', עמי: 'm', עמרי: 'm', ערן: 'm',
  צבי: 'm', רפי: 'm', תומר: 'm', אליסף: 'm', אלירן: 'm', אלי: 'm', אלון: 'm', אריק: 'm',
  גידי: 'm', דוידי: 'm', יוסף: 'm', יורם: 'm', כמיל: 'm', ניר: 'm', עופר: 'm', רון: 'm',
  רונן: 'm', רועי: 'm', רן: 'm', שאול: 'm', שלומי: 'm', אהרון: 'm', איתיאל: 'm',
  גדי: 'm', חנמאל: 'm', יוסי: 'm', יניב: 'm', ישי: 'm', מסלה: 'm', מרדכי: 'm',
  צחי: 'm', שימי: 'm', ואליד: 'm',
  אולסיה: 'f', אורלי: 'f', אלוירה: 'f', אליס: 'f', אסתי: 'f',
  ברוריה: 'f', הדס: 'f', טליה: 'f', יעל: 'f', לילי: 'f', מאיה: 'f', מהרטה: 'f',
  מיכאלה: 'f', מיכל: 'f', נאווה: 'f', סומיה: 'f', ענבל: 'f', קטי: 'f', קרן: 'f',
  תמי: 'f', אושרת: 'f', אליענה: 'f', גוסלין: 'f', דבורה: 'f', הילה: 'f', הלן: 'f',
  טלי: 'f', יפה: 'f', ליאן: 'f', לילך: 'f', ללי: 'f', נטעלי: 'f', סיגל: 'f', ענבר: 'f',
  פלר: 'f', שירה: 'f', שירן: 'f', תאיר: 'f',
};

/* Unisex given names, decided per person and checked against the portrait. These are
   deliberately NOT in NAME_GENDER: this list already carries both a שרון who is a man and
   a שרון who is a woman, so a given name is simply not evidence here, and a future
   candidate must be looked at rather than inheriting one of these. Keyed like RESOLVED. */
const GENDER = {
  'Yisrael_Beiteinu 6': 'm',    // שרון שרעבי
  'Yisrael_Beiteinu 17': 'f',   // מור דקל
  'Yisrael_Beiteinu 23': 'm',   // עדי מורדכייב
  'Yisrael_Beiteinu 25': 'f',   // סתיו בויאנג'ו-מצא
  /* אוליביה is almost always a woman's name in Hebrew and this is the second man on these
     lists carrying it. Read as 'f' here until the name pass turned up his Hebrew Wikipedia
     article (Q94427585, "איש תקשורת, פרשן ויועץ אסטרטגי", P21 male) — which agrees with the
     portrait. Two independent sources against a guess from the given name. */
  'Yisrael_Beiteinu 19': 'm',   // אוליביה רפוביץ'
  'Together 5': 'f',            // לירן אבישר בן חורין
  'Together 6': 'm',            // נעם תיבון
  'Together 19': 'm',           // שחר ורון
  'Together 22': 'f',           // נטע אטיאס
  'Together 28': 'm',           // מתי גיל
  'Together 31': 'f',           // רוני פנטנש מלכאי
  'Together 35': 'm',           // עמית ברדה
  'The_Democrats 12': 'f',      // מורן זר קצנשטיין
  'The_Democrats 19': 'f',      // רתם סיון
  'The_Democrats u11': 'm',     // גיל ביילין
  'The_Democrats u12': 'm',     // דימה שפירא — Dima here is a man, checked against the portrait
  'The_Democrats u20': 'f',     // לי הופמן אגיב
  'The_Democrats u24': 'f',     // מורן מישל
  'The_Democrats u03': 'm',     // אוליביה עמנואל דה לם — Olivier, not Olivia
  'Yashar 4': 'f',              // עדי אלטשולר
  'Yashar 15': 'f',             // אלקס ריף — Alex Rif
  'Yashar 19': 'f',             // טל אוחנה חכמון
  'Yashar 24': 'm',             // שי פישר
  'Yashar 27': 'm',             // זיו רוזן
  'Yashar 31': 'm',             // גיל אבריאל
  'Amcha_Yisrael 9': 'm',       // אביב עזרא
  'Amcha_Yisrael 13': 'm',      // עלם איברהים
  'Amcha_Yisrael 17': 'm',      // רז מלכה
  'Amcha_Yisrael 18': 'm',      // דור יצחק
  'Otzma_Yehudit 20': 'm',      // אור אליה יומטוביאן
};

/* Matches a human has ruled on, keyed by "<Party_id> <rank>". A PersonID accepts that
   match; null rejects it outright.
   An *exact* name match is not proof of identity, which is why this applies to those too.
   The roll holds exactly one דוד אזולאי — the Shas MK, who died in 2018 — so Yisrael
   Beiteinu's 13th candidate matched him perfectly and was written up as a former MK. No
   amount of string matching can catch that; only a person can. Every current/former call
   is therefore printed on each run, so the list stays reviewable as parties are added. */
const RESOLVED = {
  'Yisrael_Beiteinu 13': null,   // דוד אזולאי is NOT Shas's late דוד אזולאי (#483, d. 2018)
  'The_Democrats 4': 30808,   // אפרת רייטן = אפרת רייטן מרום
  'The_Democrats 9': null,    // משה רדמן אבוטבול is NOT Shas's משה אבוטבול (#30749)
  'Together 20': 30783,       // יסמין סאקס פרידמן, in the roll as יסמין פרידמן
  'Together 24': 30777,       // משה "קינלי" טור-פז = משה טור פז
  'Together 29': 30871,       // שלי טל מירון, split as first "שלי טל" + last "מירון"
  /* The roll writes ווליד, the press writes ואליד. Collapsing וו to ו leaves וליד against
     ואליד — the difference is an א standing in for a vowel, and stripping those generally
     would start matching strangers. A sitting Ra'am MK, so worth pinning by hand. */
  'Ra_am 3': 30752,           // ואליד טאהא = ווליד טאהא
};

/* ── the Knesset roll ── */

/* The service caps a page at 100 rows however large a $top you ask for, so page on what
   actually came back rather than on what was requested — asking for 1000 and stopping
   when the batch is "short" silently returns the first 100 rows and nothing else. */
async function odata(entity, select, filter) {
  const rows = [];
  for (let skip = 0; ; ) {
    const q = new URLSearchParams({ $format: 'json', $select: select, $top: '1000', $skip: String(skip) });
    if (filter) q.set('$filter', filter);
    const r = await fetch(`${ODATA}/${entity}?${q}`, { headers: UA });
    if (!r.ok) throw new Error(`${entity}: HTTP ${r.status}`);
    const batch = (await r.json()).value;
    if (!batch.length) return rows;
    rows.push(...batch);
    skip += batch.length;
    process.stdout.write(`\r  ${entity}: ${rows.length} rows`);
  }
}

async function roll() {
  fs.mkdirSync(CACHE, { recursive: true });
  const f = `${CACHE}/roll.json`;
  if (fs.existsSync(f) && !refetch) return JSON.parse(fs.readFileSync(f, 'utf8'));

  const people = await odata('KNS_Person', 'PersonID,FirstName,LastName,GenderDesc');
  /* IsCurrent, not KnessetNum === 25. Dan Illouz's 25th-Knesset term ended on
     2026-08-13, so "has a row for the 25th" reads him as a sitting MK when Yisrael
     Beiteinu's own graphic correctly calls him a former one. A term row records that
     someone served, not that they still do. */
  const posts = await odata('KNS_PersonToPosition', 'PersonID,KnessetNum,IsCurrent', MK_POSITIONS.map(n => `PositionID eq ${n}`).join(' or '));
  const byId = new Map();
  for (const p of people) byId.set(p.PersonID, { id: p.PersonID, first: p.FirstName || '', last: p.LastName || '', gender: p.GenderDesc === 'נקבה' ? 'f' : p.GenderDesc === 'זכר' ? 'm' : null, served: false, sitting: false });
  for (const q of posts) { const p = byId.get(q.PersonID); if (!p) continue; p.served = true; if (q.IsCurrent) p.sitting = true; }
  const out = { fetched: new Date().toISOString().slice(0, 10), people: [...byId.values()] };
  fs.writeFileSync(f, JSON.stringify(out));
  console.log(`Knesset roll: ${out.people.length} people, ${posts.length} MK terms → ${f}`);
  return out;
}

/* ── name matching ──
 * Hebrew names arrive with gershayim, geresh, hyphens and parenthetical nicknames, and
 * the roll carries full legal names ("אריה מכלוף דרעי", "יולי יואל אדלשטיין"). Normalise
 * both to bare tokens, then require the *given* name to match exactly and the surname to
 * overlap in one direction or the other. Anything looser starts matching strangers. */

/* Hebrew spells the same name several ways and the roll picked one of them. Flatten the
   differences that are orthographic rather than personal: the roll holds ווליד טאהא where
   the press writes ואליד טאהא, and ואליד אלהואשלה where the press writes ואליד אל-הואשלה.
   Both are sitting Ra'am MKs, and both were read as having never served. */
const norm = s => String(s || '')
  .replace(/[׳״"'`]/g, '')
  .replace(/\([^)]*\)/g, ' ')
  .replace(/[-–—]/g, ' ')
  .replace(/וו/g, 'ו').replace(/יי/g, 'י')
  .replace(/\s+/g, ' ')
  .trim();

const tokens = s => norm(s).split(' ').filter(Boolean);

function match(name, people) {
  const c = tokens(name);
  if (!c.length) return { hits: [] };
  const rest = c.slice(1);
  const exact = [], loose = [];
  for (const p of people) {
    const pf = tokens(p.first), pl = tokens(p.last);
    if (!pf.length || pf[0] !== c[0]) continue;
    /* Compare the surname with spaces collapsed too: "אל הואשלה" and "אלהואשלה" are one
       name written two ways, not two people. */
    if (rest.join(' ') === pl.join(' ') || (rest.length && pl.length && rest.join('') === pl.join(''))) { exact.push(p); continue; }
    if (!rest.length || !pl.length) continue;
    const covers = pl.every(t => rest.includes(t)) || rest.every(t => pl.includes(t));
    if (covers) loose.push(p);
  }
  return { hits: exact.length ? exact : loose, loose: !exact.length && loose.length > 0 };
}

/* ── run ── */

const { people } = await roll();

const GRAPHIC_SAID = { current: 'ח"כ', former: 'חכ"ל' };
/* The table is written in each name's natural spelling; look it up through the same
   normaliser the matcher uses, so a variant like נאווה/נאוה resolves to one entry rather
   than falling through and reporting a gap. */
const NAME_GENDER_N = {};
for (const k in NAME_GENDER) NAME_GENDER_N[norm(k)] = NAME_GENDER[k];

const report = { changed: [], disagree: [], ambiguous: [], noGender: [], served: [], pinned: [] };

for (const file of fs.readdirSync(LISTS).filter(f => f.endsWith('.json'))) {
  const p = path.join(LISTS, file);
  const list = JSON.parse(fs.readFileSync(p, 'utf8'));
  const slug = file.replace(/\.json$/, '');
  const rows = [...(list.candidates || []), ...(list.unranked || [])];

  for (const c of rows) {
    const who = `${list.partyName} ${c.rank ?? c.photo} ${c.name}`;
    const key = `${slug} ${c.rank ?? c.photo}`;
    /* Set by hand in the editor. The roll does not get to overwrite a person's decision. */
    const held = new Set(c.pinned || []);
    let { hits, loose } = match(c.name, people);
    if (key in RESOLVED) {
      /* Select from the whole roll, not from what the matcher found. Filtering its hits
         would let the table reject a wrong match but never assert a missed one, and the
         misses are the cases that need a human most — ואליד טאהא returned nothing at all. */
      const want = RESOLVED[key];
      hits = want == null ? [] : people.filter(h => h.id === want);
      loose = false;
    }

    let mk, gender = null;
    if (hits.length > 1) {
      mk = null;
      report.ambiguous.push(`${who} — ${hits.length} people in the roll match (${hits.map(h => h.id).join(', ')})`);
      if (!held.has('mk') && !held.has('gender'))
        c.verify = `name matches ${hits.length} people in the Knesset roll; mk and gender left undetermined`;
    } else if (hits.length === 1) {
      const h = hits[0];
      mk = h.sitting ? 'current' : h.served ? 'former' : 'none';
      gender = h.gender;
      if (loose) report.ambiguous.push(`${who} — matched loosely to "${h.first} ${h.last}" (#${h.id}), mk=${mk}`);
    } else {
      mk = 'none';
    }

    /* The party's own graphic is corroboration, not an override — a disagreement is
       either a stale graphic or a bad match, and both want a human. */
    const before = c.mk;
    if (before && mk && before !== mk && !held.has('mk'))
      report.disagree.push(`${who} — graphic said ${GRAPHIC_SAID[before] || before}, roll says ${mk}`);

    if (GENDER[key] != null) gender = GENDER[key];
    if (gender == null) gender = NAME_GENDER_N[tokens(c.name)[0]] ?? null;
    if (gender == null && !held.has('gender')) report.noGender.push(`${who} — given name "${tokens(c.name)[0]}"`);

    if (mk === 'current' || mk === 'former') report.served.push(`${mk === 'current' ? 'ח"כ ' : 'לשעבר'} ${who}`);
    if (!held.has('mk') && !held.has('gender') && (before !== mk || c.gender !== gender))
      report.changed.push(`${who}: mk ${before ?? '—'} → ${mk ?? '—'}, gender ${c.gender ?? '—'} → ${gender ?? '—'}`);

    /* Report what the roll would have said, so a pin that has outlived its reason — the
       roll corrected, the person elected since — shows up instead of quietly diverging. */
    for (const [f, v] of [['mk', mk], ['gender', gender]]) {
      if (!held.has(f)) { c[f] = v; continue; }
      report.pinned.push(`${who} — ${f} pinned to ${c[f] ?? '—'}${c[f] === v ? '' : `, the roll says ${v ?? '—'}`}`);
    }
  }

  if (write) fs.writeFileSync(p, JSON.stringify(list, null, 2) + '\n');
}

const show = (title, arr) => { if (arr.length) { console.log(`\n${title} (${arr.length})`); for (const l of arr) console.log('  ' + l); } };
show('AMBIGUOUS — check these by hand', report.ambiguous);
show('DISAGREEMENT between the party graphic and the Knesset roll', report.disagree);
show('NO GENDER — add the given name to NAME_GENDER', report.noGender);
show('PINNED — set by hand in the editor and left alone', report.pinned.sort());
show('MATCHED TO THE KNESSET ROLL — check these are the right people', report.served.sort());
console.log(`\n${report.changed.length} candidates changed. ${write ? 'Written.' : 'Report only — pass --write to apply.'}`);
