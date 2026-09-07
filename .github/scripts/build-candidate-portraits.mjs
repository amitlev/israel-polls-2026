/* Bakes one portrait per candidate on a party's list.
 *
 * There are two places a candidate's face comes from, and they are good at different
 * things:
 *
 *   the party's list graphic   every candidate is on it, already framed the way the
 *                              party wants them framed — but at whatever size the
 *                              designer exported, often ~130px a head.
 *   the party's website        the original photograph, often at full camera
 *                              resolution — but not always the whole list, and not
 *                              always cropped to a face.
 *
 * So a party here has a graphic, a site, or both, and the bake takes the best of what
 * it has:
 *
 *   graphic only   cut each card out of the grid.
 *   site only      use the site's photo; square ones are already framed, anything else
 *                  is centre-cropped.
 *   both           the framing from the graphic, the pixels from the site — each card
 *                  is located inside the corresponding original by normalised cross-
 *                  correlation, and the crop that wins (the one the party's own
 *                  designer chose) is lifted onto the full-resolution file. Anyone the
 *                  site is missing falls back to the graphic, and the run says who.
 *
 *   npm run build:candidates                      every party below
 *   npm run build:candidates -- Together          just one
 *   npm run build:candidates -- --preview         contact sheets only, no files written
 *   npm run build:candidates -- --refetch         ignore the cached originals
 *
 * Originals are cached under .leaderheads/candidates/ (gitignored) — they run to
 * hundreds of megabytes, and nothing needs them after the bake. Each run also writes
 * <Party>_manifest.json there: what the site said, before any hand-curation. That is
 * what lists/<Party>.json is built from, and what to diff a site against later.
 *
 * Nothing here touches the HTML. Portraits land in assets/candidate-lists/portraits/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { FILES, regenAll } from './lib/restore-chunks.mjs';

const ASSETS = 'assets/candidate-lists';
const WORK = '.leaderheads/candidates';
const OUT = 192;            // CAP on the baked square, matching the leader heads — never an upscale
const QUALITY = 92;         // JPEG, 0-100 (NOT 0-1 — @napi-rs/canvas takes the percentage).
                            // These are photographs; a PNG of one is ~4x the bytes.
const UA = { 'User-Agent': 'israel-polls-2026-dashboard/1.0 (https://github.com/amitlev/israel-polls-2026; candidate portrait bake)' };

/* What gets spliced into the dashboard, which is a different question from what gets
   committed to portraits/. The seat grid draws faces at ~34px, so 64 is a retina tile and
   anything larger is bytes with nothing in them. They go in as ONE sprite per party rather
   than 30 data URIs: WebP compresses a sheet better than 30 separate images, and it is one
   base64 string in the HTML instead of thirty.
   Bytes here are not paid once. Every poll update rewrites all 20 .restore chunks in full,
   twice a day, so anything added to the page is re-committed some 730 times a year. That
   is the whole reason for 64px and for sprites — do not raise either casually. */
const SPRITE = 64, SPRITE_COLS = 8, SPRITE_Q = 80;
const MAX_SEATS = 40;   // no party has ever polled near this; ranks past it can win no seat

/* ── the parties ────────────────────────────────────────────────────────────────────
 *
 * grid — how to cut the list graphic, all boxes in fractions of the source image:
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
 *
 * site — where the originals live, and how that page has to be read. `parse` picks the
 * reader; both readers below are written against a specific site's markup and will need
 * a new one, not a patch, when a party rebuilds its site.
 */
const PARTIES = {
  /* 1206x1609. Columns at x=966/746/528/308/88 (pitch 219.5, width 154);
     white name plates at y=419/687/955/1224/1492 (pitch 268.25); photo area 154x169. */
  Yisrael_Beiteinu: {
    graphic: 'Yisrael_Beiteinu.png',
    grid: { cols: 5, rows: 5, count: 25, order: 'rtl',
            cell: [0.800995, 0.155376, 0.127695, 0.095712], step: [0.182007, 0.166719] },
  },

  /* 900x1600, 7 rows. This graphic's name plate is dark navy rather than white, so the
     grid was found by the orange rank badge on each plate instead — one saturated blob
     per card, which also confirms the count. Columns at x=667/527/387/247/107 (pitch
     140, width 127); card tops at y=196..1283 (pitch 181.17); photo area 127x131. */
  Together: {
    graphic: 'Together.png',
    grid: { cols: 5, rows: 7, count: 35, order: 'rtl',
            cell: [0.741111, 0.122500, 0.141111, 0.080625], step: [0.155556, 0.113229] },
    site: { page: 'https://be-yahad.org.il/team/', parse: 'filename-rank' },
  },

  /* No graphic — the party never published one. Its site carries square 400px portraits
     already cropped to the face, so they are used as they are. It numbers only the top
     20, though: the other 31 have a photo and a name and no position. */
  The_Democrats: {
    site: { page: 'https://democrats.org.il/team/', parse: 'jet-listing', leadRank: 1, leadMark: 'יו"ר' },
  },

  /* No graphic and no reader: the party's team page carries no rank anywhere — not in the
     filename, not in the DOM — so the rank/photo pairing is written onto the candidates in
     lists/Yashar.json by hand and reviewed there. It covers 18 of the top 22; the page
     predates the final list, so ranks 4, 6, 10 and 20 have no photograph. */
  Yashar: {},

  /* Names only. No list graphic and no party site with photographs was found. */
  Amcha_Yisrael: {},
};

const args = process.argv.slice(2);
const preview = args.includes('--preview');
const refetch = args.includes('--refetch');
const only = args.filter(a => !a.startsWith('--'));

const dec = s => { try { return decodeURIComponent(s); } catch { return s; } };
/* Hebrew gershayim/geresh (U+05F4/U+05F3) are normalised to ASCII quotes here. Sites mix
   them freely — "עו״ד" beside "עו\"ד" — and a title regex that misses one leaves the title
   glued to the front of the name, where it also breaks the alphabetical ordering. */
const ents = s => s.replace(/&quot;|&#8220;|&#8221;/g, '"').replace(/&#039;|&apos;|&#8217;/g, "'")
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\u05F4/g, '"').replace(/\u05F3/g, "'");
const flat = s => ents(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

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

/* ── site readers ──
 * Each returns { ranked: Map<rank, {name, title, url}>, unranked: [{name, title, url}] }. */

/* Photo filenames that start with the candidate's rank: "12-רם-בן-ברק-1536x1024.jpg".
   The size suffix is stripped to reach the original upload. */
function parseFilenameRank(html) {
  const re = /https?:\/\/[^"'\s,)\\]+?\/wp-content\/uploads\/\d{4}\/\d{2}\/[^"'\s,)\\]+?\.(?:jpg|jpeg|png)/gi;
  const ranked = new Map();
  for (const raw of html.match(re) || []) {
    const u = dec(raw);
    const m = u.match(/\/(\d+)-(.+?)(?:-\d+x\d+)?\.(jpg|jpeg|png)$/i);
    if (!m) continue;
    const rank = +m[1];
    if (rank < 1 || ranked.has(rank)) continue;
    ranked.set(rank, { name: m[2].replace(/-/g, ' ').replace(/ \d+$/, ''), title: null, url: u.replace(/-\d+x\d+(\.\w+)$/, '$1') });
  }
  return { ranked, unranked: [] };
}

/* A JetEngine/Elementor listing: one .jet-listing-grid__item per candidate, carrying a
   data-post-id, an <img>, an optional heading widget holding the rank, and text-editor
   widgets holding [title?, first name, last name]. The page renders the same candidates
   twice in two layouts, so items are folded together on data-post-id and a rank found in
   either copy wins. */
function parseJetListing(html, site) {
  const chunks = html.split(/class="[^"]*jet-listing-grid__item/).slice(1);
  const byId = new Map();
  const widget = (ch, kind) => [...ch.matchAll(new RegExp(`data-widget_type="${kind}\\.default"[^>]*>([\\s\\S]*?)(?=<div class="elementor-element|<\\/div>\\s*<\\/div>\\s*<\\/div>)`, 'g'))]
    .map(m => flat(m[1])).filter(Boolean);

  for (const ch of chunks) {
    const im = ch.match(/<img[^>]+?src="([^"]+?\/wp-content\/uploads\/[^"]+?)"/);
    if (!im) continue;
    const id = (ch.match(/data-post-id="(\d+)"/) || [])[1] || im[1];
    const rank = widget(ch, 'heading').find(h => /^\d+$/.test(h));
    /* The card ends in a share call-to-action that is a text widget like any other. */
    const fields = widget(ch, 'text-editor').filter(f => !/^(צלמו|שתפו)/.test(f));
    const prev = byId.get(id);
    if (prev) { if (rank && !prev.rank) prev.rank = +rank; continue; }
    byId.set(id, { rank: rank ? +rank : null, fields, url: dec(im[1]) });
  }

  const ranked = new Map(), unranked = [];
  for (const it of byId.values()) {
    /* The leader is presented as a role rather than a number ("יו"ר"), above the grid. */
    if (!it.rank && site.leadMark && it.fields[0] === site.leadMark) it.rank = site.leadRank;
    const lead = it.fields.length > 1 && /^(ח"כ|עו"ד|ד"ר|פרופ'|אדר'|הרב|אלוף|אל"מ|סרן|רס"ן|יו"ר)/.test(it.fields[0]);
    const title = lead ? it.fields[0] : null;
    const name = (lead ? it.fields.slice(1) : it.fields).join(' ');
    const rec = { name, title, url: it.url };
    if (it.rank) ranked.set(it.rank, rec); else unranked.push(rec);
  }
  unranked.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  return { ranked, unranked };
}

async function readSite(name, site) {
  const html = await (await fetch(site.page, { headers: UA })).text();
  const out = site.parse === 'jet-listing' ? parseJetListing(html, site) : parseFilenameRank(html);
  fs.mkdirSync(WORK, { recursive: true });
  fs.writeFileSync(`${WORK}/${name}_manifest.json`, JSON.stringify({
    page: site.page, read: new Date().toISOString().slice(0, 10),
    ranked: [...out.ranked.entries()].sort((a, b) => a[0] - b[0]).map(([rank, r]) => ({ rank, ...r })),
    unranked: out.unranked,
  }, null, 1));
  return out;
}

async function download(name, key, url) {
  const dir = `${WORK}/${name}_src`;
  fs.mkdirSync(dir, { recursive: true });
  const f = `${dir}/${key}${path.extname(new URL(url).pathname) || '.jpg'}`;
  if (fs.existsSync(f) && !refetch) return f;
  const r = await fetch(encodeURI(url), { headers: UA });
  if (!r.ok) { console.warn(`⚠ ${name} ${key}: HTTP ${r.status} for ${url}`); return null; }
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  await new Promise(s => setTimeout(s, 120));
  return f;
}

/* ── framing an original by matching the graphic's card into it ── */

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

/* A site photo with no graphic to frame it: square ones are already cropped to the face,
   anything else gets the middle. */
function wholeFrame(img) {
  const side = Math.min(img.width, img.height);
  return [(img.width - side) / 2, (img.height - side) / 2, side, side];
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

/* The label is tinted by the candidate's recorded gender and marked with their ותק, so a
   wrong value in lists/*.json is one glance at one image rather than 111 JSON rows. That
   check has to be visual: gender is derived from the Knesset roll where the person has
   served and from a given-name table otherwise, and neither can see a face. */
const GENDER_INK = { f: '#f49ac1', m: '#7ec8ff' };
const MK_MARK = { current: '\u25cf', former: '\u25cb' };   // filled = sitting, hollow = former

function contactSheet(name, cuts, meta) {
  const cols = 6, cell = 150, pad = 5;
  const rows = Math.ceil(cuts.length / cols);
  const c = createCanvas(cols * (cell + pad) + pad, rows * (cell + pad + 26) + pad);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#222'; ctx.fillRect(0, 0, c.width, c.height);
  cuts.forEach((cut, i) => {
    const x = pad + (i % cols) * (cell + pad), y = pad + Math.floor(i / cols) * (cell + pad + 26);
    ctx.drawImage(cut.canvas, x, y, cell, cell);
    const m = meta.get(cut.key);
    ctx.textAlign = 'center';
    ctx.fillStyle = cut.from === 'graphic' ? '#e8a' : cut.key[0] === 'u' ? '#8ad' : '#ddd';
    ctx.font = '11px sans-serif';
    ctx.fillText(`${cut.key}${cut.from === 'graphic' ? ' (graphic)' : ''}${m && m.mk !== 'none' ? ' ' + (MK_MARK[m.mk] || '?') : ''}`, x + cell / 2, y + cell + 11);
    if (m) {
      ctx.fillStyle = GENDER_INK[m.gender] || '#f66';
      ctx.font = '12px sans-serif';
      ctx.fillText(m.gender ? m.name : m.name + ' — NO GENDER', x + cell / 2, y + cell + 23);
    }
  });
  fs.mkdirSync(WORK, { recursive: true });
  const f = `${WORK}/${name}.png`;
  fs.writeFileSync(f, c.toBuffer('image/png'));
  return f;
}

/* ── run ── */

for (const [name, party] of Object.entries(PARTIES)) {
  if (only.length && !only.includes(name)) continue;
  const g = party.grid;

  let graphic = null;
  if (party.graphic) {
    const src = path.join(ASSETS, 'sources', party.graphic);
    if (!fs.existsSync(src)) { console.error(`✗ ${name}: no source graphic at ${src}`); continue; }
    graphic = await loadImage(src);
  }

  const site = party.site ? await readSite(name, party.site) : { ranked: new Map(), unranked: [] };

  /* A photo URL written straight onto a candidate in lists/*.json wins over anything a
     site reader found. Every party site is a different pile of markup, and some are not
     worth a reader of their own — Yashar's team page carries no rank anywhere, in the
     filename or the DOM, so the pairing is done by hand once and committed where it can
     be reviewed rather than re-derived from a layout that will change. */
  const listEarly = fs.existsSync(path.join(ASSETS, 'lists', `${name}.json`))
    ? JSON.parse(fs.readFileSync(path.join(ASSETS, 'lists', `${name}.json`), 'utf8')) : null;
  for (const c of (listEarly?.candidates || []))
    if (c.photo && c.photo.url) site.ranked.set(c.rank, { name: c.name, title: c.title ?? null, url: c.photo.url });

  const count = g ? g.count : Math.max(listEarly ? listEarly.candidates.length : 0, 0, ...site.ranked.keys());

  if (party.site) {
    const missing = [];
    for (let r = 1; r <= count; r++) if (!site.ranked.has(r)) missing.push(r);
    console.log(`${name}: ${site.ranked.size} ranked + ${site.unranked.length} unranked from ${party.site.page}` +
      (missing.length ? `; ranks ${missing.join(', ')} not on the site` : ''));
  }

  const listFile = path.join(ASSETS, 'lists', `${name}.json`);
  const list = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, 'utf8')) : null;
  const meta = new Map();
  for (const cand of (list?.candidates || [])) meta.set(String(cand.rank).padStart(2, '0'), cand);
  for (const cand of (list?.unranked || [])) meta.set(cand.photo, cand);
  if (list && count && list.candidates.length !== count)
    console.warn(`⚠ ${name}: ${count} ranked candidates here, ${list.candidates.length} in ${listFile}`);

  const cuts = [], provenance = [];

  const bake = async (key, rec, cardIndex) => {
    const file = rec ? await download(name, key, rec.url) : null;
    if (file) {
      const photo = await loadImage(file);
      let placed = null;
      if (graphic && cardIndex != null) {
        placed = frameFromCard(photo, cardCanvas(graphic, g, cardIndex));
        if (placed && placed.score < 0.55) {
          console.warn(`⚠ ${name} ${key}: weak match (${placed.score.toFixed(2)}) — using the graphic instead`);
          placed = null;
        }
      } else {
        placed = { score: null, box: wholeFrame(photo) };
      }
      if (placed) {
        cuts.push({ key, from: 'site', canvas: square(`${name} ${key}`, photo, placed.box) });
        provenance.push({ key, from: 'site', url: rec.url, ...(placed.score == null ? {} : { ncc: +placed.score.toFixed(3) }) });
        return;
      }
    }
    if (graphic && cardIndex != null) {
      cuts.push({ key, from: 'graphic', canvas: square(`${name} ${key}`, graphic, boxFor(g, cardIndex, graphic.width, graphic.height)) });
      provenance.push({ key, from: 'graphic' });
    } else {
      console.warn(`⚠ ${name} ${key}: no usable source, skipped`);
    }
  };

  for (let rank = 1; rank <= count; rank++)
    await bake(String(rank).padStart(2, '0'), site.ranked.get(rank), g ? rank - 1 : null);
  for (let i = 0; i < site.unranked.length; i++)
    await bake('u' + String(i + 1).padStart(2, '0'), site.unranked[i], null);

  if (preview) { console.log(`${name}: contact sheet → ${contactSheet(name, cuts, meta)}`); continue; }

  const dir = path.join(ASSETS, 'portraits', name);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/\.jpe?g$/i.test(f)) fs.unlinkSync(path.join(dir, f));
  for (const cut of cuts)
    fs.writeFileSync(path.join(dir, `${cut.key}.jpg`), cut.canvas.toBuffer('image/jpeg', QUALITY));

  const fromSite = provenance.filter(p => p.from === 'site').length;
  const soft = cuts.filter(c => c.canvas.width < OUT).map(c => c.key);
  fs.writeFileSync(path.join(dir, 'SOURCES.json'), JSON.stringify({
    party: name, generated: new Date().toISOString().slice(0, 10),
    site: party.site?.page ?? null, graphic: party.graphic ?? null, portraits: provenance,
  }, null, 1));
  console.log(`${name}: ${cuts.length} portraits → ${dir}/  (${fromSite} from the site, ${cuts.length - fromSite} from the graphic` +
    (soft.length ? `; ${soft.length} under ${OUT}px and soft: ${soft.join(', ')}` : '') + ')');
}


/* ── the blobs the dashboard reads ──
 * Built from what is committed under portraits/ and lists/, not from this run's output, so
 * `-- Together` still splices every party rather than blanking the other sixteen. */

async function spriteFor(name) {
  const dir = path.join(ASSETS, 'portraits', name);
  if (!fs.existsSync(dir)) return null;
  const ranks = fs.readdirSync(dir)
    .map(f => /^(\d{2})\.jpe?g$/i.exec(f))
    .filter(Boolean).map(m => +m[1]).filter(r => r <= MAX_SEATS).sort((a, b) => a - b);
  if (!ranks.length) return null;
  const imgs = {};
  for (const r of ranks) imgs[r] = await loadImage(path.join(dir, `${String(r).padStart(2, '0')}.jpg`));

  /* `have` maps a sprite cell back to the rank it holds, and the grid looks a rank up in it
     rather than assuming cell = rank - 1. Coverage is not dense: Yashar's team page has 18
     of its top 22, so ranks 4, 6, 10 and 20 have no cell at all. Assuming density would
     shift every later face onto the wrong person. */
  const n = ranks.length, cols = Math.min(SPRITE_COLS, n), rows = Math.ceil(n / cols);
  const c = createCanvas(cols * SPRITE, rows * SPRITE), ctx = c.getContext('2d');
  ranks.forEach((r, i) => {
    const img = imgs[r];
    ctx.drawImage(img, (i % cols) * SPRITE, Math.floor(i / cols) * SPRITE, SPRITE, SPRITE);
  });
  return { s: `data:image/webp;base64,${c.toBuffer('image/webp', SPRITE_Q).toString('base64')}`, n, c: cols, px: SPRITE, have: ranks };
}

/* Replace-or-append after an anchor, the same idiom build-party-logos.mjs uses: the
   replacement is passed as a function so a `$&` inside base64 can never be interpreted,
   and the append branch closes and reopens <script> so each blob keeps its own block. */
function splice(pairs) {
  for (const f of FILES) {
    let html = fs.readFileSync(f, 'utf8');
    let anchor = /(window\.PARTY_LOGOS_DATA = \{.*?\};\n)/s;
    for (const [global, blob] of pairs) {
      const line = `window.${global} = ${JSON.stringify(blob)};`;
      const existing = new RegExp(`window\\.${global} = \\{.*?\\};`, 's');
      if (existing.test(html)) html = html.replace(existing, () => line);
      else {
        if (!anchor.test(html)) throw new Error(`could not find where to splice ${global} in ${f}`);
        html = html.replace(anchor, (_, m) => `${m}</script>\n<script>\n${line}\n`);
      }
      anchor = new RegExp(`(window\\.${global} = \\{.*?\\};\\n)`, 's');
    }
    fs.writeFileSync(f, html);
  }
  regenAll();
}

if (!preview) {
  const sprites = {}, people = {};
  for (const name of Object.keys(PARTIES)) {
    const sp = await spriteFor(name);
    if (sp) sprites[name] = sp;
    const listFile = path.join(ASSETS, 'lists', `${name}.json`);
    if (!fs.existsSync(listFile)) continue;
    const list = JSON.parse(fs.readFileSync(listFile, 'utf8'));
    /* Ranked only. A seat is a position, and the `unranked` array has none — the README is
       emphatic that its alphabetical order must never be read as a list order. */
    people[name] = (list.candidates || []).filter(c => c.rank <= MAX_SEATS)
      .sort((a, b) => a.rank - b.rank)
      .map(c => ({ r: c.rank, n: c.name, g: c.gender ?? null, mk: c.mk ?? null }));
  }
  const before = fs.statSync(FILES[0]).size;
  splice([['CANDIDATE_SPRITES_DATA', sprites], ['CANDIDATES_DATA', people]]);
  const kb = n => (n / 1024).toFixed(0) + 'KB';
  const spriteBytes = Object.values(sprites).reduce((a, s) => a + s.s.length, 0);
  console.log(`\nspliced ${Object.keys(sprites).length} sprites (${kb(spriteBytes)}) and ` +
    `${Object.values(people).reduce((a, p) => a + p.length, 0)} candidates into both HTML files; ` +
    `${kb(before)} \u2192 ${kb(fs.statSync(FILES[0]).size)}`);
}
