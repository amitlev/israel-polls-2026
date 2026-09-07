/* Bakes one portrait per candidate on a party's list.
 *
 * There are two places a candidate's face comes from, and they are good at different
 * things:
 *
 *   the party's list graphic   every candidate is on it, already framed the way the
 *                              party wants them framed — but at whatever size the
 *                              designer exported, often ~130px a head.
 *   the party's website        the original studio photograph, at full camera
 *                              resolution — but a loose landscape frame that has to be
 *                              cropped, and it does not always carry the whole list.
 *
 * So take both: the framing from the graphic, the pixels from the website. For a party
 * with `site`, each card in the graphic is located inside the corresponding original by
 * normalised cross-correlation, and the crop that wins is the one the party's own
 * designer chose, lifted back onto the full-resolution file. Anyone the site is missing
 * falls back to the graphic crop, and the run says who.
 *
 *   npm run build:candidates                      every party below
 *   npm run build:candidates -- Together          just one
 *   npm run build:candidates -- --preview         contact sheets only, no files written
 *   npm run build:candidates -- --refetch         ignore the cached originals
 *
 * Originals are cached under .leaderheads/candidates/ (gitignored) — they run to
 * hundreds of megabytes, and nothing needs them after the bake.
 *
 * Nothing here touches the HTML. Portraits land in assets/candidate-lists/portraits/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const ASSETS = 'assets/candidate-lists';
const WORK = '.leaderheads/candidates';
const OUT = 192;            // CAP on the baked square, matching the leader heads — never an upscale
const QUALITY = 92;         // JPEG, 0-100 (NOT 0-1 — @napi-rs/canvas takes the percentage).
                            // These are photographs; a PNG of one is ~4x the bytes.
const UA = { 'User-Agent': 'israel-polls-2026-dashboard/1.0 (https://github.com/amitlev/israel-polls-2026; candidate portrait bake)' };

/* ── the list graphics ──────────────────────────────────────────────────────────────
 * Per graphic, all boxes in fractions of the source image:
 *   cols/rows  the grid as printed
 *   order      'rtl' — rank 1 is the TOP-RIGHT card, ranks run right to left
 *   cell       [x, y, w, h] of the FIRST card's photo area (excluding its name plate)
 *   step       [dx, dy] pitch between neighbouring cards; dx moves against `order`
 *
 * Measure rather than eyeball. These graphics are laid out on a grid, so a card's name
 * plate gives you the whole geometry: its x-spans are the card columns, its top is the
 * row pitch, and the photo area is the gap up to the card above. Eyeballed numbers drift
 * a few px per row and by the bottom row the plate is inside the crop. Keep `cell` square
 * in *pixels* (the two denominators differ), so a crop never reaches outside its card.
 */
const GRIDS = {
  /* 1206x1609. Columns at x=966/746/528/308/88 (pitch 219.5, width 154);
     white name plates at y=419/687/955/1224/1492 (pitch 268.25); photo area 154x169. */
  Yisrael_Beiteinu: {
    file: 'Yisrael_Beiteinu.png',
    cols: 5, rows: 5, count: 25, order: 'rtl',
    cell: [0.800995, 0.155376, 0.127695, 0.095712],
    step: [0.182007, 0.166719],
  },

  /* 900x1600, 7 rows. This graphic's name plate is dark navy rather than white, so the
     grid was found by the orange rank badge on each plate instead — one saturated blob
     per card, which also confirms the count. Columns at x=667/527/387/247/107 (pitch
     140, width 127); card tops at y=196..1283 (pitch 181.17); photo area 127x131. */
  Together: {
    file: 'Together.png',
    cols: 5, rows: 7, count: 35, order: 'rtl',
    cell: [0.741111, 0.122500, 0.141111, 0.080625],
    step: [0.155556, 0.113229],
  },
};

/* ── the party websites ─────────────────────────────────────────────────────────────
 * `page` is scanned for image URLs whose filename starts with the candidate's rank, the
 * convention every one of these WordPress sites has followed so far ("12-רם-בן-ברק-
 * 1536x1024.jpg"). The size suffix is stripped to get the original upload.
 */
const SITES = {
  Together: { page: 'https://be-yahad.org.il/team/' },
};

const args = process.argv.slice(2);
const preview = args.includes('--preview');
const refetch = args.includes('--refetch');
const only = args.filter(a => !a.startsWith('--'));

/* ── graphic ── */

/* Card n (0-based) → its photo box in source pixels. */
function boxFor(g, n, W, H) {
  const col = n % g.cols, row = Math.floor(n / g.cols);
  const [cx, cy, cw, ch] = g.cell, [dx, dy] = g.step;
  const x = g.order === 'rtl' ? cx - col * dx : cx + col * dx;
  return [x * W, (cy + row * dy) * H, cw * W, ch * H];
}

function cardCanvas(img, g, n) {
  const [x, y, w, h] = boxFor(g, n, img.width, img.height);
  const c = createCanvas(Math.round(w), Math.round(h));
  c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}

/* ── site originals ── */

async function fetchOriginals(name, site, count) {
  const dir = `${WORK}/${name}_src`;
  fs.mkdirSync(dir, { recursive: true });
  const html = await (await fetch(site.page, { headers: UA })).text();
  const re = /https?:\/\/[^"'\s,)\\]+?\/wp-content\/uploads\/\d{4}\/\d{2}\/[^"'\s,)\\]+?\.(?:jpg|jpeg|png)/gi;

  const byRank = new Map();
  for (const raw of html.match(re) || []) {
    let u; try { u = decodeURIComponent(raw); } catch { u = raw; }
    const m = u.match(/\/(\d+)-(.+?)(?:-\d+x\d+)?\.(jpg|jpeg|png)$/i);
    if (!m) continue;
    const rank = +m[1];
    if (rank < 1 || rank > count || byRank.has(rank)) continue;
    byRank.set(rank, { rank, name: m[2].replace(/-/g, ' ').replace(/ \d+$/, ''), url: u.replace(/-\d+x\d+(\.\w+)$/, '$1') });
  }

  for (const c of byRank.values()) {
    const f = `${dir}/${String(c.rank).padStart(2, '0')}.jpg`;
    c.file = f;
    if (fs.existsSync(f) && !refetch) continue;
    const r = await fetch(encodeURI(c.url), { headers: UA });
    if (!r.ok) { console.warn(`⚠ ${name} #${c.rank}: HTTP ${r.status} for ${c.url}`); byRank.delete(c.rank); continue; }
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    await new Promise(s => setTimeout(s, 120));
  }
  return byRank;
}

/* ── framing the original by matching the graphic's card into it ── */

function gray(img, w, h) {
  const c = createCanvas(w, h), x = c.getContext('2d');
  x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, g = new Float64Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) g[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return g;
}

function moments(a) {
  let s = 0; for (const v of a) s += v;
  const m = s / a.length;
  let q = 0; for (const v of a) q += (v - m) * (v - m);
  return [m, Math.sqrt(q) || 1];
}

/* Best square placement of `card` inside `photo`, scored by zero-mean NCC. `bound`
   restricts the search to a neighbourhood, which is how the fine pass stays cheap. */
function ncc(photo, card, PH, kLo, kHi, kStep, stride, bound) {
  const PW = Math.round(PH * photo.width / photo.height);
  const P = gray(photo, PW, PH);
  let best = { score: -2 };
  for (let k = kLo; k <= kHi; k += kStep) {
    if (k < 8 || k > Math.min(PW, PH)) continue;
    const T = gray(card, k, k), [tm, ts] = moments(T);
    const x0 = bound ? Math.max(0, bound.x - bound.r) : 0, x1 = bound ? Math.min(PW - k, bound.x + bound.r) : PW - k;
    const y0 = bound ? Math.max(0, bound.y - bound.r) : 0, y1 = bound ? Math.min(PH - k, bound.y + bound.r) : PH - k;
    for (let y = y0; y <= y1; y += stride) for (let x = x0; x <= x1; x += stride) {
      let s = 0, q = 0, dot = 0;
      for (let j = 0; j < k; j++) {
        const row = (y + j) * PW + x;
        for (let i = 0; i < k; i++) { const v = P[row + i]; s += v; q += v * v; dot += v * T[j * k + i]; }
      }
      const n = k * k, m = s / n;
      const score = (dot - n * m * tm) / (Math.sqrt(Math.max(q - n * m * m, 1e-9)) * ts);
      if (score > best.score) best = { score, x, y, k, PH };
    }
  }
  return best;
}

/* Coarse pass over the whole frame, then a fine pass around the winner. */
function frameFromCard(photo, card) {
  const c = ncc(photo, card, 100, 32, 98, 6, 2, null);
  if (c.score < -1) return null;
  const z = 4;
  const f = ncc(photo, card, 100 * z, (c.k - 6) * z, (c.k + 6) * z, 2 * z, 3, { x: c.x * z, y: c.y * z, r: 6 * z });
  const scale = photo.height / f.PH;
  return { score: f.score, box: [f.x * scale, f.y * scale, f.k * scale, f.k * scale] };
}

/* ── output ── */

function square(label, img, [sx, sy, sw, sh]) {
  const skew = Math.abs(sw / sh - 1);
  if (skew > 0.05) console.warn(`⚠ ${label}: crop box is ${(skew * 100).toFixed(0)}% off square (${Math.round(sw)}x${Math.round(sh)}) — it will be stretched`);
  /* Never enlarge past what the source actually holds. A card printed at 154px baked to
     192 is bigger bytes and the same detail, and it hides how coarse the source was. */
  const side = Math.min(OUT, Math.round(sw));
  const c = createCanvas(side, side), ctx = c.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, side, side);
  return c;
}

function contactSheet(name, cuts) {
  const cols = 6, cell = 150, pad = 5;
  const rows = Math.ceil(cuts.length / cols);
  const c = createCanvas(cols * (cell + pad) + pad, rows * (cell + pad + 14) + pad);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#222'; ctx.fillRect(0, 0, c.width, c.height);
  cuts.forEach((cut, i) => {
    const x = pad + (i % cols) * (cell + pad), y = pad + Math.floor(i / cols) * (cell + pad + 14);
    ctx.drawImage(cut.canvas, x, y, cell, cell);
    ctx.fillStyle = cut.from === 'graphic' ? '#e8a' : '#ddd';
    ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${cut.rank}${cut.from === 'graphic' ? ' (graphic)' : ''}`, x + cell / 2, y + cell + 11);
  });
  fs.mkdirSync(WORK, { recursive: true });
  const f = `${WORK}/${name}.png`;
  fs.writeFileSync(f, c.toBuffer('image/png'));
  return f;
}

/* ── run ── */

for (const name of Object.keys(GRIDS)) {
  if (only.length && !only.includes(name)) continue;
  const g = GRIDS[name];

  const src = path.join(ASSETS, 'sources', g.file);
  if (!fs.existsSync(src)) { console.error(`✗ ${name}: no source graphic at ${src}`); continue; }
  const graphic = await loadImage(src);

  const listFile = path.join(ASSETS, 'lists', `${name}.json`);
  const list = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, 'utf8')) : null;
  if (list && list.candidates.length !== g.count)
    console.warn(`⚠ ${name}: grid says ${g.count} cards, ${listFile} has ${list.candidates.length} candidates`);

  const originals = SITES[name] ? await fetchOriginals(name, SITES[name], g.count) : new Map();
  if (SITES[name]) {
    const missing = [];
    for (let r = 1; r <= g.count; r++) if (!originals.has(r)) missing.push(r);
    console.log(`${name}: ${originals.size}/${g.count} originals from ${SITES[name].page}` +
      (missing.length ? `; ranks ${missing.join(', ')} fall back to the graphic` : ''));
  }

  const cuts = [], provenance = [];
  for (let n = 0; n < g.count; n++) {
    const rank = n + 1;
    const card = cardCanvas(graphic, g, n);
    const orig = originals.get(rank);
    let placed = null, photo = null;
    if (orig) {
      photo = await loadImage(orig.file);
      placed = frameFromCard(photo, card);
      if (!placed || placed.score < 0.55) {
        console.warn(`⚠ ${name} #${rank}: weak match (${placed ? placed.score.toFixed(2) : 'none'}) — using the graphic instead`);
        placed = null;
      }
    }
    if (placed) {
      cuts.push({ rank, from: 'site', canvas: square(`${name} #${rank}`, photo, placed.box) });
      provenance.push({ rank, from: 'site', url: orig.url, ncc: +placed.score.toFixed(3) });
    } else {
      cuts.push({ rank, from: 'graphic', canvas: square(`${name} #${rank}`, graphic, boxFor(g, n, graphic.width, graphic.height)) });
      provenance.push({ rank, from: 'graphic' });
    }
  }

  if (preview) { console.log(`${name}: contact sheet → ${contactSheet(name, cuts)}`); continue; }

  const dir = path.join(ASSETS, 'portraits', name);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/\.jpe?g$/i.test(f)) fs.unlinkSync(path.join(dir, f));
  for (const cut of cuts)
    fs.writeFileSync(path.join(dir, `${String(cut.rank).padStart(2, '0')}.jpg`), cut.canvas.toBuffer('image/jpeg', QUALITY));

  const fromSite = provenance.filter(p => p.from === 'site').length;
  const soft = cuts.filter(c => c.canvas.width < OUT).map(c => c.rank);
  fs.writeFileSync(path.join(dir, 'SOURCES.json'), JSON.stringify({ party: name, generated: new Date().toISOString().slice(0, 10), site: SITES[name]?.page ?? null, graphic: g.file, portraits: provenance }, null, 1));
  console.log(`${name}: ${cuts.length} portraits → ${dir}/  (${fromSite} from the site, ${cuts.length - fromSite} from the graphic` +
    (soft.length ? `; ${soft.length} under ${OUT}px and soft: ${soft.join(', ')}` : '') + ')');
}
