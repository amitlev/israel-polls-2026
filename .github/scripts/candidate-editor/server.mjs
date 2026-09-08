/* A local editor for the candidate lists.
 *
 *   npm run edit:candidates      then open http://127.0.0.1:8760
 *
 * Everything this writes goes back into the committed files — lists/*.json for the fields,
 * overrides/<Party>/<key>.jpg for a hand-picked photo — so an edit shows up in `git diff`
 * and gets reviewed like anything else. That is the whole reason it is a local tool reading
 * the repo rather than a hosted thing with a database of its own: the JSON stays the source
 * of truth, and nothing here can drift away from it.
 *
 * Photos are written to overrides/ rather than portraits/, because every bake deletes a
 * party's portraits and regenerates them from the graphic or the site. An override survives
 * that, exactly as assets/leader-heads/cutouts/ does for the tug-of-war heads.
 *
 * Binds to 127.0.0.1 only. It writes to the working tree and runs a build on request, so it
 * has no business being reachable from anywhere else.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const ROOT = process.cwd();
const ASSETS = 'assets/candidate-lists';
const LISTS = `${ASSETS}/lists`;
const PORTRAITS = `${ASSETS}/portraits`;
const OVERRIDES = `${ASSETS}/overrides`;
const HERE = path.dirname(new URL(import.meta.url).pathname);
const PORT = 8760;
const OUT = 192, QUALITY = 92;   /* same as the bake, so an override needs no special case */

const UA = { 'User-Agent': 'israel-polls-2026-dashboard/1.0 (candidate editor)' };
const slug = f => f.replace(/\.json$/, '');
/* Normalise without re-encoding. encodeURI() on an already-encoded URL turns %20 into %2520,
   which is how every Wikimedia Commons link 404s — they arrive percent-encoded already. */
const href = u => new URL(String(u).trim()).href;
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };

function readAll() {
  const wikidata = fs.existsSync('.leaderheads/knesset/wikidata.json')
    ? JSON.parse(fs.readFileSync('.leaderheads/knesset/wikidata.json', 'utf8')) : {};
  return fs.readdirSync(LISTS).filter(f => f.endsWith('.json')).map(f => {
    const list = JSON.parse(fs.readFileSync(path.join(LISTS, f), 'utf8'));
    const party = slug(f);
    const rows = [...(list.candidates || []), ...(list.unranked || [])].map(c => {
      const key = c.rank != null ? String(c.rank).padStart(2, '0') : c.photo;
      const wd = wikidata[c.name];
      return { ...c, key,
        hasPhoto: fs.existsSync(path.join(PORTRAITS, party, `${key}.jpg`)),
        override: fs.existsSync(path.join(OVERRIDES, party, `${key}.jpg`)),
        suggest: wd?.img || null };
    });
    return { party, partyName: list.partyName, note: list.source?.note || '', rows };
  });
}

/* Patch one candidate in place, leaving every other field and the file's shape alone. */
function patch({ party, key, fields }) {
  const p = path.join(LISTS, `${party}.json`);
  const list = JSON.parse(fs.readFileSync(p, 'utf8'));
  const find = arr => (arr || []).find(c => (c.rank != null ? String(c.rank).padStart(2, '0') : c.photo) === key);
  const c = find(list.candidates) || find(list.unranked);
  if (!c) throw new Error(`no candidate ${party} ${key}`);
  for (const [k, v] of Object.entries(fields)) {
    if (v === '' || v === undefined) delete c[k];      /* an emptied field is absent, not "" */
    else c[k] = v;
  }
  for (const k of ['name', 'nameEn', 'nameAr', 'gender', 'mk']) if (!(k in c)) c[k] = null;
  fs.writeFileSync(p, JSON.stringify(list, null, 2) + '\n');
  return c;
}

/* Square-crop a source image into overrides/. `crop` is in source pixels. */
async function savePhoto({ party, key, data, url, crop }) {
  let buf;
  if (data) buf = Buffer.from(String(data).replace(/^data:[^,]+,/, ''), 'base64');
  else {
    const r = await fetch(href(url), { headers: UA });
    if (!r.ok) throw new Error(`fetching the image failed: HTTP ${r.status}`);
    buf = Buffer.from(await r.arrayBuffer());
  }
  const img = await loadImage(buf);
  const box = crop && crop.s > 0 ? crop : { x: (img.width - Math.min(img.width, img.height)) / 2,
    y: (img.height - Math.min(img.width, img.height)) / 2, s: Math.min(img.width, img.height) };
  const side = Math.min(OUT, Math.round(box.s));
  const c = createCanvas(side, side);
  c.getContext('2d').drawImage(img, box.x, box.y, box.s, box.s, 0, 0, side, side);
  const dir = path.join(OVERRIDES, party);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${key}.jpg`), c.toBuffer('image/jpeg', QUALITY));
  return { side };
}

function body(req) {
  return new Promise((res, rej) => {
    let b = ''; req.on('data', d => { b += d; if (b.length > 3e7) rej(new Error('too large')); });
    req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch (e) { rej(e); } });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  try {
    if (u.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(HERE, 'index.html')));
    }
    if (u.pathname === '/api/data') return json(res, 200, readAll());

    if (u.pathname === '/api/candidate' && req.method === 'POST')
      return json(res, 200, { ok: true, candidate: patch(await body(req)) });

    if (u.pathname === '/api/photo' && req.method === 'POST')
      return json(res, 200, { ok: true, ...(await savePhoto(await body(req))) });

    if (u.pathname === '/api/photo' && req.method === 'DELETE') {
      const { party, key } = Object.fromEntries(u.searchParams);
      const f = path.join(OVERRIDES, party, `${key}.jpg`);
      if (fs.existsSync(f)) fs.unlinkSync(f);
      return json(res, 200, { ok: true });
    }

    /* Fetch a remote image server-side: the browser cannot read the pixels of a cross-origin
       image onto a canvas, so the crop preview would be blank without this. */
    if (u.pathname === '/api/fetch') {
      const r = await fetch(href(u.searchParams.get('url')), { headers: UA });
      if (!r.ok) return json(res, 502, { error: `HTTP ${r.status}` });
      res.writeHead(200, { 'Content-Type': r.headers.get('content-type') || 'image/jpeg' });
      return res.end(Buffer.from(await r.arrayBuffer()));
    }

    if (u.pathname === '/api/build' && req.method === 'POST') {
      const out = await new Promise(done => {
        const ps = spawn('npm', ['run', 'build:candidates'], { cwd: ROOT });
        let log = '';
        ps.stdout.on('data', d => log += d); ps.stderr.on('data', d => log += d);
        ps.on('close', code => done({ code, log: log.slice(-4000) }));
      });
      return json(res, 200, out);
    }

    /* Portraits and overrides, straight off disk. */
    const m = u.pathname.match(/^\/(portrait|override)\/([^/]+)\/([^/]+)\.jpg$/);
    if (m) {
      const f = path.join(m[1] === 'override' ? OVERRIDES : PORTRAITS, m[2], `${m[3]}.jpg`);
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(f));
    }
    res.writeHead(404); res.end('not found');
  } catch (e) {
    json(res, 500, { error: String(e && e.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`candidate editor → http://127.0.0.1:${PORT}`);
  console.log('writes lists/*.json and overrides/<Party>/<key>.jpg — review with git diff');
});
