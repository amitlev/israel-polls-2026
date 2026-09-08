/* Downloads Wikidata's portrait (P18) for candidates who have no photograph from any other
 * source, into assets/candidate-lists/wikidata/<Party>/<key>.jpg.
 *
 *   npm run fetch:portraits            report only, downloads nothing
 *   npm run fetch:portraits -- --write download and crop
 *
 * This is the third source of a face, and the weakest of the three: a party graphic and a
 * party site both show the candidate as the party wants them seen, in a photograph taken for
 * this campaign. A Commons portrait may be ten years old and cropped for a different purpose.
 * So the bake prefers graphic and site, and reaches for these only when neither has anything —
 * which for the four biggest lists is every single candidate, because none of them published
 * a graphic or a site with photographs.
 *
 * Which item a name resolves to is NOT decided here. It is read from the cache
 * enrich-candidate-names.mjs writes, so a portrait can only come from an item that already
 * survived that script's guards — not dead, not one of several people sharing the name, not an
 * auto-imported stub. A wrong face is worse than no face, and the identity work is done once.
 *
 * Cropping is a heuristic and says so. A square is taken centred horizontally and anchored
 * near the top, because that is where a head is in a portrait; it is not face detection, and
 * a photograph that breaks the assumption will be visibly wrong. Run with --contact to write
 * a contact sheet per party and look at them. Anything wrong gets a hand-picked file in
 * overrides/, which beats this and everything else.
 *
 * Licensing: these are Wikimedia Commons files, and the square crops are derivative works of
 * them. Every file used is recorded with its Commons filename in the party's SOURCES.md, the
 * same way assets/leader-heads/SOURCES.md records the leader photographs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const ASSETS = 'assets/candidate-lists';
const LISTS = `${ASSETS}/lists`;
const OUT_DIR = `${ASSETS}/wikidata`;
const PORTRAITS = `${ASSETS}/portraits`;
const OVERRIDES = `${ASSETS}/overrides`;
const CACHE = '.leaderheads/knesset/wikidata.json';
const UA = { 'User-Agent': 'israel-polls-2026-dashboard/1.0 (https://github.com/amitlev/israel-polls-2026; candidate portraits)' };

const args = process.argv.slice(2);
const write = args.includes('--write');
const contact = args.includes('--contact');
const MAX_RANK = 40;      /* the deepest the seat grid can reach — see MAX_SEATS in the bake */
const OUT = 192, QUALITY = 92;
/* Where the head is in a portrait, as a fraction of the height above the square's top edge.
   Zero would crop from the very top of the frame and 0.5 would centre it; a little off the
   top keeps hair in and chins out of the bottom edge. */
const HEAD_BIAS = 0.06;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Commons file name back out of the Special:FilePath URL the cache stores. */
const commonsFile = url => {
  const m = /Special:FilePath\/([^?]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : url;
};

function squareCrop(img) {
  const side = Math.min(img.width, img.height);
  const sx = (img.width - side) / 2;
  const sy = Math.min(Math.max(0, img.height * HEAD_BIAS), img.height - side);
  const out = Math.min(OUT, side);
  const c = createCanvas(out, out);
  c.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, out, out);
  return c;
}

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const wanted = [];

for (const f of fs.readdirSync(LISTS).filter(f => f.endsWith('.json'))) {
  const slug = f.replace(/\.json$/, '');
  const list = JSON.parse(fs.readFileSync(path.join(LISTS, f), 'utf8'));
  for (const c of (list.candidates || [])) {
    if (!c.rank || c.rank > MAX_RANK) continue;
    const key = String(c.rank).padStart(2, '0');
    /* Anything the bake can already dress this seat with wins; this is the last resort. */
    if (fs.existsSync(path.join(OVERRIDES, slug, `${key}.jpg`))) continue;
    if (fs.existsSync(path.join(PORTRAITS, slug, `${key}.jpg`))) continue;
    const hit = cache[`hit:${c.name}`] || cache[c.name];
    const img = hit && !Array.isArray(hit) ? hit.img : null;
    if (img) wanted.push({ slug, key, name: c.name, url: img, id: hit.id, file: commonsFile(img) });
  }
}

const by = {};
wanted.forEach(w => (by[w.slug] = by[w.slug] || []).push(w));
console.log(`${wanted.length} candidates at ranks 1-${MAX_RANK} have no photograph and a Wikidata portrait:`);
for (const [slug, rows] of Object.entries(by).sort((a, b) => b[1].length - a[1].length))
  console.log(`  ${slug.padEnd(20)} ${String(rows.length).padStart(3)}  ${rows.map(r => r.key).join(' ')}`);

if (!write) { console.log('\nReport only — pass --write to download.'); process.exit(0); }

let ok = 0; const failed = [];
for (const [slug, rows] of Object.entries(by)) {
  const dir = path.join(OUT_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  const sheet = [];
  for (const w of rows) {
    try {
      const r = await fetch(w.url, { headers: UA });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const img = await loadImage(Buffer.from(await r.arrayBuffer()));
      const c = squareCrop(img);
      fs.writeFileSync(path.join(dir, `${w.key}.jpg`), c.toBuffer('image/jpeg', QUALITY));
      sheet.push({ ...w, w: img.width, h: img.height, side: c.width });
      ok++;
      process.stdout.write(`\r  ${ok}/${wanted.length} downloaded`);
    } catch (e) {
      failed.push(`${slug} ${w.key} ${w.name} — ${e.message}`);
    }
    await sleep(250);   /* Commons is a volunteer-funded service; do not hammer it */
  }
  fs.writeFileSync(path.join(dir, 'SOURCES.md'),
    `# ${slug} — portraits from Wikimedia Commons\n\n` +
    'Each file below is the portrait (P18) on that candidate\'s Wikidata item. The square crops\n' +
    'in this directory are derivative works of those files, and carry their licences.\n\n' +
    '| Rank | Candidate | Wikidata | Commons file | Original |\n|---|---|---|---|---|\n' +
    sheet.map(s => `| ${s.key} | ${s.name} | ${s.id} | ${s.file} | ${s.w}×${s.h} |`).join('\n') + '\n');
}

console.log(`\n\n${ok} portraits → ${OUT_DIR}/<party>/`);
if (failed.length) { console.log(`\n${failed.length} failed:`); failed.forEach(f => console.log('  ' + f)); }
if (contact) console.log('\nRun `npm run build:candidates -- --preview` for the contact sheets, and check every face.');
console.log('A crop that came out wrong is fixed by a hand-picked file in overrides/, which beats this.');
