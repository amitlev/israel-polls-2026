/* Bakes the tug-of-war head cutouts.
 *
 * The rope figures need something the 48px table avatars in PHOTOS_DATA can't give:
 * a head cut out of its background, sharp at ~46px on a retina screen, and facing a
 * known direction. This downloads each leader's Wikipedia lead image, crops to the
 * head, masks it to a hand-tuned silhouette, normalises the facing, and splices the
 * result into both HTML files as window.TUG_HEADS_DATA.
 *
 * The automatic masks are curated by eye — `npm run build:heads -- --preview` writes a
 * contact sheet to .leaderheads/preview.png instead of touching the HTML, which is the
 * loop used to tune the numbers below.
 *
 * A hand-made cutout in assets/leader-heads/cutouts/<Name>.png overrides the automatic
 * one for that leader; `npm run build:heads -- --export` lays out that workspace. See
 * assets/leader-heads/README.md for the contract a hand-made file has to meet.
 *
 * Facing convention: every baked head faces LEFT. The dashboard mirrors the whole
 * opposition team at render time so both sides look at the rope (see tugHead()).
 *
 * Sources are Wikipedia lead images (Wikimedia Commons); the filenames used are
 * printed on every run and recorded in .leaderheads/manifest.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { FILES, regenAll } from './lib/restore-chunks.mjs';

const WORK = '.leaderheads', SRC = `${WORK}/src`;
const ASSETS = 'assets/leader-heads';                 // the hand-editing workspace
const CUTOUTS = `${ASSETS}/cutouts`;                  // hand-made heads win over the auto bake
const SIZE = 192;             // baked square, ~2x the largest on-screen head
const UA = { 'User-Agent': 'israel-polls-2026-dashboard/1.0 (https://github.com/amitlev/israel-polls-2026; leader head asset bake)' };

/* Per leader, all in fractions:
 *   title  Wikipedia article, when it differs from the photoKey
 *   box    [x, y, w, h] head+neck crop out of the source image
 *   head   [cx, cy, rx, ry] silhouette ellipse inside that crop
 *   tilt   degrees, rotates the head into the pull (+ leans the face toward the rope)
 *   flip   mirror the source so this head ends up facing LEFT like all the others
 */
const HEADS = {
  'Benjamin Netanyahu':   { box: [0.324, 0.045, 0.335, 0.420] },
  'Bezalel Smotrich':     { box: [0.288, 0.085, 0.370, 0.460] },
  'Itamar Ben-Gvir':      { box: [0.309, 0.095, 0.415, 0.570] },
  'Aryeh Deri':           { box: [0.245, 0.075, 0.420, 0.570], head: [0.545, 0.425, 0.470, 0.440] },
  'Yitzhak Goldknopf':  { title: 'Yitzhak Goldknopf', box: [0.060, 0.045, 0.720, 0.820] },
  'Yair Lapid':           { box: [0.392, 0.145, 0.275, 0.400] },
  'Benny Gantz':          { box: [0.245, 0.065, 0.385, 0.580], head: [0.550, 0.420, 0.470, 0.440] },
  'Avigdor Lieberman':    { box: [0.307, 0.075, 0.460, 0.550] },
  'Yair Golan':           { box: [0.455, 0.095, 0.250, 0.400], head: [0.470, 0.420, 0.480, 0.435] },
  'Naftali Bennett':      { box: [0.333, 0.100, 0.275, 0.290] },
  'Gadi Eisenkot':        { box: [0.274, 0.105, 0.335, 0.545] },
  'Yoaz Hendel':          { box: [0.470, 0.165, 0.205, 0.305], head: [0.425, 0.430, 0.455, 0.445] },
  'Youssef Jabarin':    { title: 'Yousef Jabareen', box: [0.415, 0.025, 0.210, 0.250] },
  'Ahmad Tibi':         { title: 'Ahmad Tibi', box: [0.310, 0.030, 0.320, 0.290] },
  'Mansour Abbas':        { box: [0.269, 0.035, 0.450, 0.560] },
  'Sami Abou Shehadeh':   { title: 'Sami Abu Shehadeh', box: [0.411, 0.045, 0.215, 0.280] },
  'Yuli Edelstein':       { box: [0.223, 0.075, 0.395, 0.490] },
  'Gilad Erdan':          { box: [0.260, 0.045, 0.460, 0.500] },
  'Ofer Winter':          { box: [0.315, 0.120, 0.365, 0.565], head: [0.520, 0.440, 0.480, 0.440] },
};
const DEFAULT_HEAD = [0.5, 0.42, 0.50, 0.44];   // cx, cy, rx, ry

const slug = k => k.replace(/[^A-Za-z0-9]/g, '_');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const kindOf = b => (b[0] === 0xFF && b[1] === 0xD8) ? 'jpg' : (b[0] === 0x89 && b[1] === 0x50) ? 'png' : null;

/* ── source images, cached on disk ── */
async function ensureSources() {
  fs.mkdirSync(SRC, { recursive: true });
  const titles = [...new Set(Object.entries(HEADS).map(([k, v]) => v.title || k))].join('|');
  const api = 'https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1' +
    `&titles=${encodeURIComponent(titles)}&prop=pageimages&piprop=thumbnail|name&pithumbsize=1400`;
  const q = (await (await fetch(api, { headers: UA })).json()).query;
  const byTitle = {};
  for (const p of Object.values(q.pages)) byTitle[p.title] = p;
  for (const n of q.normalized || []) byTitle[n.from] = byTitle[n.to];
  for (const r of q.redirects  || []) byTitle[r.from] = byTitle[r.to];

  const manifest = {};
  for (const [key, cfg] of Object.entries(HEADS)) {
    const page = byTitle[cfg.title || key];
    if (!page?.thumbnail) { console.warn(`  no Wikipedia lead image for ${key}`); continue; }
    let file = ['jpg', 'png'].map(e => `${SRC}/${slug(key)}.${e}`).find(f => fs.existsSync(f));
    for (let attempt = 1; attempt <= 4 && !file; attempt++) {
      await sleep(attempt === 1 ? 600 : 2500 * attempt);     // Wikimedia rate-limits bursts
      const res = await fetch(page.thumbnail.source, { headers: UA });
      const buf = Buffer.from(await res.arrayBuffer()), kind = kindOf(buf);
      if (res.ok && kind) { file = `${SRC}/${slug(key)}.${kind}`; fs.writeFileSync(file, buf); }
    }
    if (!file) { console.warn(`  download failed for ${key}`); continue; }
    manifest[key] = { file, source: page.pageimage };
  }
  fs.writeFileSync(`${WORK}/manifest.json`, JSON.stringify(manifest, null, 2));
  return manifest;
}

/* A head is not an ellipse: widest at the temples, tapering to a rounded chin.
   Cutting on an ellipse clips the temples and leaves background at the jaw. */
function headPath(c, cx, cy, rx, ry) {
  const top = cy - ry, bot = cy + ry, wide = cy - ry * 0.22;
  c.moveTo(cx, top);
  c.bezierCurveTo(cx + rx*0.74, top,            cx + rx, wide - ry*0.32, cx + rx, wide);
  c.bezierCurveTo(cx + rx,      wide + ry*0.44, cx + rx*0.76, bot - ry*0.28, cx + rx*0.36, bot - ry*0.05);
  c.bezierCurveTo(cx + rx*0.17, bot,            cx - rx*0.17, bot,          cx - rx*0.36, bot - ry*0.05);
  c.bezierCurveTo(cx - rx*0.76, bot - ry*0.28,  cx - rx, wide + ry*0.44,    cx - rx, wide);
  c.bezierCurveTo(cx - rx,      wide - ry*0.32, cx - rx*0.74, top,          cx, top);
}

/* A hand-made cutout, if one exists, is used as-is — only normalised so every head
   ends up the same size in the square: the opaque content is the head, cut at the
   jaw, scaled so its height fills the square and centred horizontally. */
function cutoutPath(key) {
  return ['png', 'webp'].map(e => `${CUTOUTS}/${slug(key)}.${e}`).find(f => fs.existsSync(f));
}
async function bakeCutout(file) {
  const img = await loadImage(file);
  const probe = createCanvas(img.width, img.height), pc = probe.getContext('2d');
  pc.drawImage(img, 0, 0);
  const d = pc.getImageData(0, 0, img.width, img.height).data;
  let x0 = img.width, x1 = -1, y0 = img.height, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (d[(y*img.width + x)*4 + 3] > 24) { if (x<x0)x0=x; if (x>x1)x1=x; if (y<y0)y0=y; if (y>y1)y1=y; }
  }
  if (x1 < 0) throw new Error(`${file} is fully transparent`);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  // A tight crop legitimately touches all four edges; what actually signals a missed
  // cut-out is no meaningful transparency anywhere in the frame.
  let clear = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 24) clear++;
  if (clear / (img.width * img.height) < 0.03) console.warn(`  ${file}: almost no transparency — is the background actually cut out?`);
  const cv = createCanvas(SIZE, SIZE), c = cv.getContext('2d');
  const sc = SIZE / bh, dw = bw * sc;
  c.drawImage(img, x0, y0, bw, bh, (SIZE - dw) / 2, 0, dw, SIZE);
  return cv;
}

/* ── crop → silhouette mask → square RGBA canvas ── */
async function bakeOne(key, cfg, file, { ignoreHand = false } = {}) {
  const hand = ignoreHand ? null : cutoutPath(key);
  if (hand) return bakeCutout(hand);
  const img = await loadImage(file);
  const [bx, by, bw, bh] = cfg.box;
  const sx = bx * img.width, sy = by * img.height, sw = bw * img.width, sh = bh * img.height;

  const cv = createCanvas(SIZE, SIZE), c = cv.getContext('2d');
  // the crop keeps its own aspect; fit it inside the square and centre it
  const scale = Math.min(SIZE / sw, SIZE / sh);
  const dw = sw * scale, dh = sh * scale, dx = (SIZE - dw) / 2, dy = (SIZE - dh) / 2;

  const [hcx, hcy, hrx, hry] = cfg.head || DEFAULT_HEAD;
  const cx = dx + hcx*dw, cy = dy + hcy*dh, rx = hrx*dw, ry = hry*dh;
  c.save();
  c.beginPath();
  headPath(c, cx, cy, rx, ry);
  c.clip();
  if (cfg.flip) { c.translate(SIZE, 0); c.scale(-1, 1); }
  c.drawImage(img, sx, sy, sw, sh, cfg.flip ? SIZE - dx - dw : dx, dy, dw, dh);
  c.restore();
  return cv;
}

/* ── contact sheet for tuning the masks by eye ── */
async function preview(manifest) {
  const keys = Object.keys(manifest), COLS = 6, CELL = SIZE + 16, LBL = 22;
  const rows = Math.ceil(keys.length / COLS);
  const cv = createCanvas(COLS * CELL, rows * (CELL + LBL) * 2);
  const c = cv.getContext('2d');
  c.fillStyle = '#eef2f7'; c.fillRect(0, 0, cv.width, cv.height / 2);
  c.fillStyle = '#141b26'; c.fillRect(0, cv.height / 2, cv.width, cv.height / 2);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i], head = await bakeOne(k, HEADS[k], manifest[k].file);
    const x = (i % COLS) * CELL + 8, y = Math.floor(i / COLS) * (CELL + LBL) + LBL;
    for (const [oy, ink] of [[0, '#0c1f3f'], [cv.height / 2, '#e8ecf3']]) {
      c.drawImage(head, x, y + oy);
      c.fillStyle = ink; c.font = 'bold 13px sans-serif'; c.textAlign = 'center';
      c.fillText(k, x + SIZE / 2, y + oy - 6);
    }
  }
  fs.writeFileSync(`${WORK}/preview.png`, cv.toBuffer('image/png'));
  console.log(`\npreview → ${WORK}/preview.png (light band on top, dark band below)`);
}

/* ── splice into both HTML files ── */
function splice(blob) {
  const line = `window.TUG_HEADS_DATA = ${JSON.stringify(blob)};`;
  const existing = /window\.TUG_HEADS_DATA = \{.*?\};/s;
  const anchor = /(window\.PHOTOS_DATA = \{.*?\};\n)/s;
  for (const f of FILES) {
    const html = fs.readFileSync(f, 'utf8');
    // replacement passed as a function: base64 is $-free, but never rely on that
    const hit = existing.test(html) ? existing : anchor;
    if (!hit.test(html)) throw new Error(`could not find where to splice TUG_HEADS_DATA in ${f}`);
    const next = hit === existing
      ? html.replace(existing, () => line)
      : html.replace(anchor, (_, m) => `${m}</script>\n<script>\n${line}\n`);
    fs.writeFileSync(f, next);   // an unchanged result just means the heads did not change
  }
  regenAll();
}

/* ── --export: the hand-editing workspace ── */
async function exportWorkspace(manifest) {
  for (const d of ['originals', 'source-crops', 'auto-cutouts', 'cutouts']) fs.mkdirSync(`${ASSETS}/${d}`, { recursive: true });
  const lines = [];
  for (const [key, cfg] of Object.entries(HEADS)) {
    if (!manifest[key]) continue;
    const name = slug(key), img = await loadImage(manifest[key].file);
    fs.copyFileSync(manifest[key].file, `${ASSETS}/originals/${name}${path.extname(manifest[key].file)}`);

    // head box plus enough margin to cut wide of the hair, capped so the files stay
    // workable — 1400px of head is 7x what the 192px bake needs
    const [bx, by, bw, bh] = cfg.box, PAD = 0.15, MAX = 1400;
    const sx = Math.max(0, (bx - bw*PAD) * img.width), sy = Math.max(0, (by - bh*PAD) * img.height);
    const sw = Math.min(img.width - sx, bw * (1 + PAD*2) * img.width);
    const sh = Math.min(img.height - sy, bh * (1 + PAD*2) * img.height);
    const k = Math.min(1, MAX / Math.max(sw, sh));
    const cv = createCanvas(Math.round(sw*k), Math.round(sh*k));
    cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw*k, sh*k);
    fs.writeFileSync(`${ASSETS}/source-crops/${name}.png`, cv.toBuffer('image/png'));

    // what the automatic bake currently produces, as a size/proportion reference
    fs.writeFileSync(`${ASSETS}/auto-cutouts/${name}.png`, (await bakeOne(key, cfg, manifest[key].file, { ignoreHand: true })).toBuffer('image/png'));
    lines.push(`| ${key} | ${name}.png | ${Math.round(sw)}x${Math.round(sh)} | ${manifest[key].source} |`);
  }
  fs.writeFileSync(`${ASSETS}/SOURCES.md`,
    '# Leader head sources\n\nEvery file below is the lead image of that person\'s English Wikipedia article,\n' +
    'via Wikimedia Commons. Crops made from them are derivative works of the same files.\n\n' +
    '| Leader | File | Crop size | Commons file |\n|---|---|---|---|\n' + lines.join('\n') + '\n');
  console.log(`\nworkspace → ${ASSETS}/  (${lines.length} leaders)`);
  console.log(`  source-crops/  generous head crops — cut these`);
  console.log(`  auto-cutouts/  what the bake makes today, for size reference`);
  console.log(`  cutouts/       drop finished PNGs here; the bake prefers them`);
}

const previewOnly = process.argv.includes('--preview');
const exportOnly = process.argv.includes('--export');
const manifest = await ensureSources();
if (exportOnly) { await exportWorkspace(manifest); process.exit(0); }
if (previewOnly) { await preview(manifest); process.exit(0); }

const blob = {}; let total = 0;
for (const [key, cfg] of Object.entries(HEADS)) {
  if (!manifest[key]) continue;
  const buf = (await bakeOne(key, cfg, manifest[key].file)).toBuffer('image/webp', 88);
  blob[key] = `data:image/webp;base64,${buf.toString('base64')}`;
  total += buf.length;
  console.log(`${key.padEnd(20)} ${String((buf.length/1024).toFixed(1)).padStart(5)} KB   ${manifest[key].source}`);
}
splice(blob);
console.log(`\n${Object.keys(blob).length} heads, ${(total/1024).toFixed(0)} KB total, spliced into both HTML files.`);
