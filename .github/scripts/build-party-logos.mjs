/* Bakes the party logos shown in the "לפי מפלגה" table.
 *
 * Keyed by party id, not photoKey: two parties can share a leader but never a logo
 * (Joint List and Hadash-Ta'al are the obvious case).
 *
 * Logos arrive with wildly different framing — some transparent, some on a white
 * card, some square, some wide — so each is trimmed back to its own ink and the
 * dashboard renders it on a fixed light tile. That tile is deliberately light in
 * both themes: a black-on-transparent mark like ש"ס would otherwise disappear in
 * dark mode, and mixed logo backgrounds never look consistent on a dark ground.
 *
 * LICENSING IS NOT UNIFORM — see the `licence` field on every entry and the
 * generated assets/party-logos/SOURCES.md. Several are non-free trademarks used
 * for identification; that is a publishing decision, recorded here rather than
 * quietly flattened into "from Wikipedia".
 *
 *   npm run build:logos              bake and splice into both HTML files
 *   npm run build:logos -- --preview contact sheet only, HTML untouched
 */
import fs from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { FILES, regenAll } from './lib/restore-chunks.mjs';

const WORK = '.leaderheads/logos', SRC = `${WORK}/src`;
const LOCAL = 'assets/party-logos/incoming';   // hand-supplied files land here
const MAX = 200;                               // long edge of the baked logo
const UA = { 'User-Agent': 'israel-polls-2026-dashboard/1.0 (https://github.com/amitlev/israel-polls-2026; party logo bake)' };

/* commons: a Commons file title, resolved to a URL at bake time.
   url:     a direct URL.
   local:   a file the maintainer dropped into assets/party-logos/incoming/.       */
const LOGOS = {
  'Likud':             { commons: 'Likud Logo.svg',                        licence: 'Public domain (Commons)' },
  'Religious Zionism': { commons: 'Parti sioniste religieux logo 2022.png', licence: 'Public domain (Commons)' },
  'Otzma Yehudit':     { commons: 'Otzma Yehudit 2021 logo.svg',           licence: 'Public domain (Commons)' },
  'Yisrael Beiteinu':  { commons: 'Israel-beytenu-logo.svg',               licence: 'Public domain (Commons)' },
  'The Democrats':     { commons: 'The Democrats led by Yair Golan.svg',   licence: 'Public domain (Commons)' },
  'Together':          { commons: 'Bennet2026logo.png',                    licence: 'Public domain (Commons)' },
  'Yashar':            { commons: 'Yashar party logo.png',                 licence: 'Public domain (Commons)' },
  'Joint List':        { commons: 'Joint List logo.svg',                   licence: 'Public domain (Commons)' },
  "Ra'am":             { commons: 'Raam logo 2021.svg',                    licence: 'Public domain (Commons)' },
  'Balad':             { commons: 'Balad-logo.jpg',                        licence: 'Public domain (Commons)' },
  "Hadash-Ta'al":      { commons: "Logo Hadash Ta'al.png",                 licence: 'CC BY-SA 4.0 (Commons) — attribution required' },
  'Reservists':        { commons: 'המילואימניקים לוגו וויקיפדיה.jpg',        licence: 'CC BY-SA 4.0 (Commons) — attribution required' },

  /* Non-free trademarks, used to identify the party they belong to. */
  'Shas':          { url: 'https://upload.wikimedia.org/wikipedia/he/0/05/Shas_logo.svg',
                     licence: 'NON-FREE trademark — he-wiki "שימוש הוגן בסמליל" (fair use)' },
  'UTJ':           { url: 'https://www.idi.org.il/media/30808/%D7%99%D7%94%D7%93%D7%95%D7%AA-%D7%94%D7%AA%D7%95%D7%A8%D7%94-%D7%9C%D7%95%D7%92%D7%95-1290-%D7%A2%D7%9C-860.png?mode=crop&width=259&height=169',
                     licence: 'NON-FREE trademark — via idi.org.il, no licence granted' },
  'Amcha Yisrael': { url: 'https://upload.wikimedia.org/wikipedia/he/5/5e/%D7%A2%D7%9E%D7%9A-%D7%99%D7%A9%D7%A8%D7%90%D7%9C-%D7%A1%D7%9E%D7%9C.png',
                     licence: 'NON-FREE trademark — he-wiki "שימוש הוגן בסמליל" (fair use)' },
  'National Unity':{ local: 'National_Unity.png',
                     licence: 'NON-FREE trademark — supplied by the maintainer' },
  'Unity':         { local: 'Unity.png',
                     licence: 'NON-FREE trademark — supplied by the maintainer' },
};

const slug = id => id.replace(/[^A-Za-z0-9]/g, '_');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function commonsUrl(title) {
  const api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url&titles=' +
    encodeURIComponent('File:' + title);
  const q = (await (await fetch(api, { headers: UA })).json()).query;
  const page = Object.values(q.pages)[0];
  if (!page.imageinfo) throw new Error(`Commons file not found: ${title}`);
  return page.imageinfo[0].url;
}

async function source(id, cfg) {
  if (cfg.local) {
    const f = `${LOCAL}/${cfg.local}`;
    return fs.existsSync(f) ? f : null;
  }
  fs.mkdirSync(SRC, { recursive: true });
  const cached = fs.readdirSync(SRC).find(f => f.startsWith(slug(id) + '.'));
  if (cached) return `${SRC}/${cached}`;
  const url = cfg.url || await commonsUrl(cfg.commons);
  await sleep(400);
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${id}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = /^<\?xml|^<svg/i.test(buf.slice(0, 200).toString()) ? 'svg'
            : buf[0] === 0x89 ? 'png' : buf[0] === 0xFF ? 'jpg' : 'bin';
  const f = `${SRC}/${slug(id)}.${ext}`;
  fs.writeFileSync(f, buf);
  return f;
}

/* Crop away a uniform border — transparent, white card, whatever the logo shipped
   with — so every mark fills its tile to the same degree. */
function trim(img) {
  const cv = createCanvas(img.width, img.height), c = cv.getContext('2d');
  c.drawImage(img, 0, 0);
  const d = c.getImageData(0, 0, img.width, img.height).data;
  const at = (x, y) => { const i = (y * img.width + x) * 4; return [d[i], d[i+1], d[i+2], d[i+3]]; };
  const corners = [at(0,0), at(img.width-1,0), at(0,img.height-1), at(img.width-1,img.height-1)];
  const bg = corners[0];
  const same = (p, q) => (p[3] < 16 && q[3] < 16) || (Math.abs(p[0]-q[0]) < 18 && Math.abs(p[1]-q[1]) < 18 && Math.abs(p[2]-q[2]) < 18 && Math.abs(p[3]-q[3]) < 24);
  // only trim when the border really is uniform, otherwise leave the art alone
  if (!corners.every(k => same(k, bg))) return cv;
  let x0 = img.width, x1 = -1, y0 = img.height, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (!same(at(x, y), bg)) { if (x<x0)x0=x; if (x>x1)x1=x; if (y<y0)y0=y; if (y>y1)y1=y; }
  }
  if (x1 < 0) return cv;
  const pad = Math.round(Math.max(img.width, img.height) * 0.02);
  x0 = Math.max(0, x0-pad); y0 = Math.max(0, y0-pad);
  x1 = Math.min(img.width-1, x1+pad); y1 = Math.min(img.height-1, y1+pad);
  const out = createCanvas(x1-x0+1, y1-y0+1);
  out.getContext('2d').drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

async function bakeOne(id, cfg) {
  const file = await source(id, cfg);
  if (!file) return null;
  const trimmed = trim(await loadImage(file));
  const k = Math.min(1, MAX / Math.max(trimmed.width, trimmed.height));
  const cv = createCanvas(Math.round(trimmed.width*k), Math.round(trimmed.height*k));
  const c = cv.getContext('2d');
  c.imageSmoothingQuality = 'high';
  c.drawImage(trimmed, 0, 0, cv.width, cv.height);
  return cv;
}

function splice(blob) {
  const line = `window.PARTY_LOGOS_DATA = ${JSON.stringify(blob)};`;
  const existing = /window\.PARTY_LOGOS_DATA = \{.*?\};/s;
  const anchor = /(window\.TUG_HEADS_DATA = \{.*?\};\n)/s;
  for (const f of FILES) {
    const html = fs.readFileSync(f, 'utf8');
    const hit = existing.test(html) ? existing : anchor;
    if (!hit.test(html)) throw new Error(`could not find where to splice PARTY_LOGOS_DATA in ${f}`);
    const next = hit === existing
      ? html.replace(existing, () => line)
      : html.replace(anchor, (_, m) => `${m}</script>\n<script>\n${line}\n`);
    fs.writeFileSync(f, next);
  }
  regenAll();
}

const previewOnly = process.argv.includes('--preview');
const blob = {}, rows = [];
let total = 0, missing = [];
for (const [id, cfg] of Object.entries(LOGOS)) {
  let cv;
  try { cv = await bakeOne(id, cfg); }
  catch (e) { console.warn(`  ${id}: ${e.message}`); missing.push(id); continue; }
  if (!cv) { console.warn(`  ${id}: no source yet (expects ${LOCAL}/${cfg.local})`); missing.push(id); continue; }
  const buf = cv.toBuffer('image/webp', 92);
  blob[id] = `data:image/webp;base64,${buf.toString('base64')}`;
  total += buf.length;
  rows.push(`| ${id} | ${cv.width}x${cv.height} | ${cfg.licence} | ${cfg.commons || cfg.url || cfg.local} |`);
  console.log(`${id.padEnd(19)} ${String((buf.length/1024).toFixed(1)).padStart(5)} KB  ${cv.width}x${cv.height}`);
}

if (previewOnly) {
  const keys = Object.keys(blob), COLS = 4, W = 230, H = 110;
  const cv = createCanvas(COLS*W, Math.ceil(keys.length/COLS)*(H+22)*2), c = cv.getContext('2d');
  c.fillStyle = '#f0f4f9'; c.fillRect(0, 0, cv.width, cv.height/2);
  c.fillStyle = '#0b0f17'; c.fillRect(0, cv.height/2, cv.width, cv.height/2);
  for (let i = 0; i < keys.length; i++) {
    const img = await loadImage(Buffer.from(blob[keys[i]].split(',')[1], 'base64'));
    const x = (i%COLS)*W + 12, y = Math.floor(i/COLS)*(H+22) + 20;
    for (const [oy, ink] of [[0, '#0c1f3f'], [cv.height/2, '#e8ecf3']]) {
      c.fillStyle = '#fff';                                  // the light tile the table uses
      c.beginPath(); c.roundRect(x, y+oy, W-24, H-16, 7); c.fill();
      const s = Math.min((W-44)/img.width, (H-30)/img.height);
      c.drawImage(img, x+(W-24-img.width*s)/2, y+oy+(H-16-img.height*s)/2, img.width*s, img.height*s);
      c.fillStyle = ink; c.font = 'bold 12px sans-serif'; c.textAlign = 'left';
      c.fillText(keys[i], x, y+oy-6);
    }
  }
  fs.writeFileSync(`${WORK}/preview.png`, cv.toBuffer('image/png'));
  console.log(`\npreview → ${WORK}/preview.png`);
} else {
  splice(blob);
  fs.mkdirSync('assets/party-logos', { recursive: true });
  fs.writeFileSync('assets/party-logos/SOURCES.md',
    '# Party logo sources and licensing\n\n' +
    'Generated by `.github/scripts/build-party-logos.mjs`. **Licensing here is not uniform.**\n' +
    'The Commons entries are freely licensed; the ones marked NON-FREE are trademarks shown to\n' +
    'identify the party they belong to, and are a publishing decision rather than a free licence.\n' +
    'The CC BY-SA entries additionally require attribution.\n\n' +
    '| Party | Baked size | Licence | Source |\n|---|---|---|---|\n' + rows.join('\n') + '\n');
  console.log(`\n${Object.keys(blob).length} logos, ${(total/1024).toFixed(0)} KB, spliced into both HTML files.`);
}
if (missing.length) console.log(`still missing: ${missing.join(', ')}`);
