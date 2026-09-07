/* Cuts the per-candidate portraits out of a party's published list graphic.
 *
 * A party announcing its list publishes one image: a grid of official portraits,
 * numbered, with a name plate under each. That single file is the only place most
 * of a list's candidates have a usable photo at all — below the top few names,
 * nobody has a Wikipedia article to take a lead image from — so the grid is the
 * source, and this script is the knife.
 *
 * Geometry is hand-tuned per graphic, the way build-leader-heads.mjs tunes its
 * crop boxes: run with --preview to get a contact sheet in .leaderheads/candidates/
 * and nudge the numbers in GRIDS until every face sits in its box.
 *
 *   npm run build:candidates                    cut every party in GRIDS
 *   npm run build:candidates -- Yisrael_Beiteinu  just one
 *   npm run build:candidates -- --preview        contact sheet only, no files written
 *
 * Nothing here touches the HTML. Portraits land in assets/candidate-lists/portraits/
 * and stay there until something is built that shows them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const ASSETS = 'assets/candidate-lists';
const WORK = '.leaderheads/candidates';
const OUT = 192;            // baked square per portrait, matching the leader heads
const QUALITY = 0.85;       // JPEG — these are photographs, and a PNG of one is ~6x the bytes

/* Per graphic, all boxes in fractions of the source image:
 *   cols/rows  the grid as printed
 *   order      'rtl' — rank 1 is the TOP-RIGHT card, ranks run right to left
 *   cell       [x, y, w, h] of the FIRST card's photo area (excluding its name plate)
 *   step       [dx, dy] pitch between neighbouring cards; dx moves against `order`
 *
 * Measure rather than eyeball. These graphics are laid out on a grid, so a card's
 * name plate — a solid white band the full width of the card — gives you the whole
 * geometry: the plates' x-spans are the card columns, their tops are the row pitch,
 * and the photo area is the gap between one plate top and the card above it. Eyeballed
 * numbers drift by a few px per row and by the bottom row the plate is in the crop.
 * Keep `cell` square (w/h equal in *pixels*, not in fractions — the two denominators
 * differ), so the crop never has to reach outside the card to fill the output square.
 */
const GRIDS = {
  /* 1206x1609. Columns at x=966/746/528/308/88 (pitch 219.5, width 154);
     name plates at y=419/687/955/1224/1492 (pitch 268.25); photo area 154x169. */
  Yisrael_Beiteinu: {
    file: 'Yisrael_Beiteinu.png',
    cols: 5, rows: 5, count: 25, order: 'rtl',
    cell: [0.800995, 0.155376, 0.127695, 0.095712],
    step: [0.182007, 0.166719],
  },
};

const args = process.argv.slice(2);
const preview = args.includes('--preview');
const only = args.filter(a => !a.startsWith('--'));

/* Card n (0-based) → its photo box in source pixels. */
function boxFor(g, n, W, H) {
  const col = n % g.cols, row = Math.floor(n / g.cols);
  const [cx, cy, cw, ch] = g.cell, [dx, dy] = g.step;
  const x = g.order === 'rtl' ? cx - col * dx : cx + col * dx;
  return [x * W, (cy + row * dy) * H, cw * W, ch * H];
}

/* Scale the box into the output square. Deliberately not a cover-fit: reaching outside
   a nearly-square box to square it up would pull in the graphic's own background, which
   is what the aspect warning is here to catch instead. */
function square(name, n, img, [sx, sy, sw, sh]) {
  if (n === 0 && sw < OUT) console.warn(`⚠ ${name}: cards are ${Math.round(sw)}px in the source, baked to ${OUT} — portraits will be soft`);
  const skew = Math.abs(sw / sh - 1);
  if (skew > 0.05) console.warn(`⚠ ${name} card ${n + 1}: crop box is ${(skew * 100).toFixed(0)}% off square (${Math.round(sw)}x${Math.round(sh)}) — it will be stretched`);
  const c = createCanvas(OUT, OUT), ctx = c.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUT, OUT);
  return c;
}

function contactSheet(name, cuts) {
  const cols = 5, cell = 128, pad = 8;
  const rows = Math.ceil(cuts.length / cols);
  const c = createCanvas(cols * (cell + pad) + pad, rows * (cell + pad + 16) + pad);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, c.width, c.height);
  cuts.forEach((cut, i) => {
    const x = pad + (i % cols) * (cell + pad), y = pad + Math.floor(i / cols) * (cell + pad + 16);
    ctx.drawImage(cut.canvas, x, y, cell, cell);
    ctx.fillStyle = '#bbb'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(String(cut.rank), x + cell / 2, y + cell + 12);
  });
  fs.mkdirSync(WORK, { recursive: true });
  const f = `${WORK}/${name}.png`;
  fs.writeFileSync(f, c.toBuffer('image/png'));
  return f;
}

for (const [name, g] of Object.entries(GRIDS)) {
  if (only.length && !only.includes(name)) continue;

  const src = path.join(ASSETS, 'sources', g.file);
  if (!fs.existsSync(src)) { console.error(`✗ ${name}: no source graphic at ${src}`); continue; }

  const listFile = path.join(ASSETS, 'lists', `${name}.json`);
  const list = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, 'utf8')) : null;
  if (list && list.candidates.length !== g.count)
    console.warn(`⚠ ${name}: grid says ${g.count} cards, ${listFile} has ${list.candidates.length} candidates`);

  const img = await loadImage(src);
  const cuts = [];
  for (let n = 0; n < g.count; n++) cuts.push({ rank: n + 1, canvas: square(name, n, img, boxFor(g, n, img.width, img.height)) });

  if (preview) { console.log(`${name}: contact sheet → ${contactSheet(name, cuts)}`); continue; }

  const dir = path.join(ASSETS, 'portraits', name);
  fs.mkdirSync(dir, { recursive: true });
  for (const cut of cuts)
    fs.writeFileSync(path.join(dir, `${String(cut.rank).padStart(2, '0')}.jpg`), cut.canvas.toBuffer('image/jpeg', QUALITY));
  console.log(`${name}: ${cuts.length} portraits → ${dir}/  (${img.width}×${img.height} source)`);
}
