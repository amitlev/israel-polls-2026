#!/usr/bin/env node
/*
 * Fetch the Wikipedia polling page, parse any polls newer than the baked
 * MAX_BAKED_DATE, splice them into window.BASE_POLLS_DATA in both HTML files,
 * and regenerate the .restore chunks. Prints what it did; writes nothing when
 * DRY_RUN is set. Mirrors the multi-table parser used in the dashboard itself.
 */
import fs from 'node:fs';
import { FILES, regenAll } from './lib/restore-chunks.mjs';

const PAGE = 'Opinion_polling_for_the_2026_Israeli_legislative_election';
const DRY = !!process.env.DRY_RUN;
const BACKFILL_DAYS = Number(process.env.BACKFILL_DAYS || 45);   // how far back to re-check Wikipedia for polls added after the fact


/* ── parser (ported from docs/index.html) ── */
const ALL_KEYS = ["Likud","Religious Zionism","Otzma Yehudit","Shas","UTJ","Yesh Atid","National Unity","Yisrael Beiteinu","The Democrats","Bennett 2026","Together","Yashar","Yesodot Yisrael","Joint List","Ra'am","Hadash-Ta'al","Balad","Reservists","Unity","Amcha Yisrael"];
const GOV_PARTIES = ["Likud","Religious Zionism","Otzma Yehudit","Shas","UTJ"];
const MONTHNAMES = {january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12};
const FIRM_OUTLET = {
  'Midgam':'Channel 12 (HaHadashot 12)','Lazar':'Maariv',
  'Yossi Taktika':'Zman Israel / Times of Israel','Yossi Tatika':'Zman Israel / Times of Israel',
  'Filber':'Channel 14 (Direct Polls)','Maagar Mochot':'Channel 13',
  'Kantar':'Israel Hayom','Direct Polls':'i24NEWS',
};
/* Wikipedia occasionally renames a polling firm ("Midgam" became "Midgam R&C" for
   Channel 12 and "Midgam Project" for Channel 13). Under the new name the same
   pollster misses every name-keyed lookup here — FIRM_OUTLET, HE_LINEAGE, the
   house-effect table, and the gov.il enrichment's `pollster ===` match — and, worse,
   no longer matches its own already-stored rows, so a re-parse would duplicate them.
   Canonicalise back to the name the dataset already uses. */
const POLLSTER_ALIAS = {
  'Midgam R&C':     { pollster: 'Midgam', outlet: 'Channel 12 (HaHadashot 12)' },
  'Midgam Project': { pollster: 'Midgam', outlet: 'Channel 13' },
  'Yossi Taktika':  { pollster: 'Yossi Tatika' },
};
function headerKey(txt){ const t=txt.toLowerCase();
  if(/joint list/.test(t)) return 'JOINT2';
  if(/hadash/.test(t)) return "Hadash-Ta'al";
  if(/\bbalad\b/.test(t)) return 'Balad';
  if(/\blikud\b/.test(t)) return 'Likud';
  if(/together/.test(t)) return 'Together';
  if(/yesh atid/.test(t)) return 'Yesh Atid';
  if(/religious zionis|\brzp\b/.test(t)) return 'Religious Zionism';
  if(/otzma/.test(t)) return 'Otzma Yehudit';
  if(/blue and white|blue & white|national unity/.test(t)) return 'National Unity';
  if(/\bshas\b/.test(t)) return 'Shas';
  if(/torah judaism|\butj\b/.test(t)) return 'UTJ';
  if(/yisrael beiteinu/.test(t)) return 'Yisrael Beiteinu';
  if(/arab list|ra'?am|raam/.test(t)) return "Ra'am";
  if(/democrats|\bdems\b/.test(t)) return 'The Democrats';
  if(/bennett/.test(t)) return 'Bennett 2026';
  if(/yashar/.test(t)) return 'Yashar';
  if(/yesodot/.test(t)) return 'Yesodot Yisrael';
  if(/reservists|zionist home/.test(t)) return 'Reservists';
  if(/amcha yisrael|winter party/.test(t)) return 'Amcha Yisrael';
  if(/\bunity\b/.test(t)) return 'Unity';
  return null; }
function wikiPlain(s){ return s.replace(/<ref[^>]*\/>/g,'').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g,'')
  .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g,'$1').replace(/\[\[([^\]]*)\]\]/g,'$1')
  .replace(/\{\{small\|([^}]*)\}\}/gi,'$1').replace(/'''/g,'').replace(/''/g,'')
  .replace(/\{\{[^}]*\}\}/g,'').replace(/<[^>]+>/g,'').trim(); }
function cellContent(line){ let s=line.replace(/^\s*\|/,''); let depth=0,sep=-1;
  for(let i=0;i<s.length-1;i++){ const two=s[i]+s[i+1];
    if(two==='{{'||two==='[['){depth++;i++;continue;}
    if(two==='}}'||two===']]'){depth--;i++;continue;}
    if(depth===0 && s[i]==='|') sep=i; }
  if(sep>=0) s=s.slice(sep+1); return s.trim(); }
function cellSpan(line){ let s=line.replace(/^\s*\|/,''); let depth=0,sep=-1;
  for(let i=0;i<s.length-1;i++){ const two=s[i]+s[i+1];
    if(two==='{{'||two==='[['){depth++;i++;continue;}
    if(two==='}}'||two===']]'){depth--;i++;continue;}
    if(depth===0 && s[i]==='|') sep=i; }
  const m=(sep>=0?s.slice(0,sep):'').match(/colspan\s*=\s*"?(\d+)"?/i); return m?parseInt(m[1],10):1; }
function convSeat(raw){ let v=raw.replace(/<ref[^>]*\/>/g,'').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g,'').replace(/\{\{efn[^}]*\}\}/gi,'').replace(/'''/g,'').trim();
  if(/\{\{\s*n\/?a\s*\}\}/i.test(v)) return null;
  if(/^[–—-]$/.test(v)) return null;
  if(/\{\{small\|\s*\(?[\d.]+%\)?\s*\}\}/i.test(v)) return 0;
  if(/^\(?[\d.]+%\)?$/.test(v)) return 0;
  const m=v.match(/^(\d{1,2})\b/); if(m) return parseInt(m[1],10); return null; }
function convSampleSize(raw){
  let v=raw.replace(/<ref[^>]*\/>/g,'').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g,'').replace(/\{\{efn[^}]*\}\}/gi,'').replace(/'''/g,'').trim();
  v=v.replace(/[\u200e\u200f\u00a0]/g,' ').replace(/\[[^\]]*\]/g,'').trim();
  if(!v || /^[–—-]$/.test(v) || /^n\/?a$/i.test(v) || /\{\{\s*n\/?a\s*\}\}/i.test(v)) return null;
  const range=v.match(/(\d[\d,]*)\s*[–—-]\s*(\d[\d,]*)/);
  if(range){ const a=parseInt(range[1].replace(/,/g,''),10), b=parseInt(range[2].replace(/,/g,''),10);
    return (a&&b)?Math.round((a+b)/2):null; }
  const m=v.replace(/,/g,'').match(/(\d{2,6})/); return m?parseInt(m[1],10):null; }
function opdrtsDate(cell){ const m=cell.match(/\{\{\s*Opdrts\s*\|([^}]*)\}\}/i); if(!m) return null;
  const p=m[1].split('|').map(x=>x.trim()); if(p.length<4) return null;
  const day=parseInt(p[1]||p[0],10); const mon=MONTHNAMES[(p[2]||'').toLowerCase()]; const year=parseInt(p[3],10);
  if(!day||!mon||!year) return null;
  return year+'-'+String(mon).padStart(2,'0')+'-'+String(day).padStart(2,'0'); }
const NON_PARTY_HEADER = /^(fieldwork\s*date|polling\s*firm|publisher|sample\s*size|others|gov\.?)$/i;
const unrecognizedParties = new Set();   // populated by parseWikiText; checked by main() below
function parseWikiText(wikitext){
  const results=[]; const seen=new Set();
  let sec=wikitext; const s26=wikitext.search(/===\s*2026\s*===/); if(s26>=0) sec=wikitext.slice(s26);
  const todayISO=new Date().toISOString().slice(0,10);
  let ti=0; let sawFirstQualifyingTable=false;
  while((ti=sec.indexOf('{|',ti))>=0){
    const te=sec.indexOf('\n|}',ti); if(te<0) break;
    const table=sec.slice(ti,te); ti=te+3;
    const chunks=table.split(/\n\|-/);
    let cols=null;
    for(const ch of chunks){ if(/\{\{\s*Opdrts/i.test(ch)) continue;
      const hcells=ch.split('\n').filter(l=>/^\s*!/.test(l)); if(hcells.length<8) continue;
      const order=[]; const unrecognizedHere=[];
      for(const hc of hcells){ let txt=hc.replace(/^\s*!/,''); const bar=txt.lastIndexOf('|');
        const content=bar>=0?txt.slice(bar+1):txt; const plain=wikiPlain(content); const key=headerKey(plain);
        if(key==='JOINT2'){ const csm=hc.match(/colspan\s*=\s*"?(\d+)"?/i); const cs=csm?parseInt(csm[1],10):1;
          // colspan tells us how many real data columns this header cell actually spans:
          // no colspan (a single "Joint List" column, e.g. a merged-list scenario reported as one number) -> 1 key;
          // colspan=2 (Hadash-Ta'al+Balad combined, Ra'am has its own column) -> 2 keys;
          // colspan>=3 (Ra'am+Hadash-Ta'al+Balad all combined under one header) -> 3 keys.
          // Pushing a fixed number of keys regardless of colspan silently shifted every later column
          // (Dems/Yashar/Reservists/etc.) whenever "Joint List" appeared as a single real column.
          if(cs>=3){ order.push("Ra'am"); order.push("Hadash-Ta'al"); order.push('Balad'); }
          else if(cs===2){ order.push("Hadash-Ta'al"); order.push('Balad'); }
          else { order.push('Joint List'); }
        } else if(key){ order.push(key); }
        else if(plain && !NON_PARTY_HEADER.test(plain)){
          // A piped wikilink's own "|" (e.g. "[[Unity (Israel)|Unity]]") can be the last "|" on the
          // line, so the crude header-cell split above sometimes leaves a stray "]]"/"}}" — cosmetic
          // only (headerKey's word-boundary regexes still match fine either way), trimmed for the warning.
          unrecognizedHere.push(plain.replace(/[\]}]+$/, '').trim());
        } }
      if(order.length>=10){
        cols=order;
        // Only the first qualifying table encountered is the currently-active one
        // (tables appear in reverse-chronological order) — older frozen sub-tables
        // may have their own historical unrecognized labels that aren't actionable.
        if(!sawFirstQualifyingTable){ sawFirstQualifyingTable=true; unrecognizedHere.forEach(l=>unrecognizedParties.add(l)); }
        break;
      } }
    if(!cols) continue;
    for(const ch of chunks){ if(!/\{\{\s*Opdrts/i.test(ch)) continue;
      const cellLines=ch.split('\n').filter(l=>/^\s*\|/.test(l) && !/^\s*\|[}+]/.test(l));
      if(cellLines.length < cols.length+4) continue;
      const iso=opdrtsDate(cellContent(cellLines[0])); if(!iso || iso>todayISO) continue;
      const rawFirm=wikiPlain(cellContent(cellLines[1])).replace(/\s*\([^)]*\)\s*$/,'').trim(); if(!rawFirm) continue;
      const alias=POLLSTER_ALIAS[rawFirm]||{}; const firm=alias.pollster||rawFirm;
      const dk=iso+'|'+firm; if(seen.has(dk)) continue;
      const publisher=wikiPlain(cellContent(cellLines[2]));
      const sampleSize=convSampleSize(cellContent(cellLines[3]));
      const seatCells=[]; cellLines.slice(4).forEach(l=>{ const sp=cellSpan(l); seatCells.push(cellContent(l)); for(let k=1;k<sp;k++) seatCells.push(''); }); // expand colspan cells (e.g. combined Joint List) so columns align with the header
      if(seatCells.length<cols.length) continue;
      const rec={ date:iso, pollster:firm, outlet:alias.outlet||FIRM_OUTLET[firm]||publisher, sampleSize }; ALL_KEYS.forEach(k=>rec[k]=null);
      cols.forEach((c,i)=>{ rec[c]=convSeat(seatCells[i]); });
      const govsum=GOV_PARTIES.reduce((a,p)=>a+(rec[p]||0),0);
      const tail=seatCells.slice(cols.length).map(convSeat);
      const gv=tail.find(t=>t!==null && Math.abs(t-govsum)<=1);
      const total=ALL_KEYS.reduce((a,p)=>a+(rec[p]||0),0);
      if(gv!==undefined && total>=95 && total<=122){ rec._govTotal=gv; seen.add(dk); results.push(rec); } }
  }
  return results;
}

/* ── main ── */
const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${PAGE}&prop=wikitext&format=json&origin=*&_=${Date.now()}`;
const resp = await fetch(url, { headers: { 'User-Agent': 'israel-polls-2026-updater/1.0 (github actions)' } });
if (!resp.ok) throw new Error('Wikipedia HTTP ' + resp.status);
const json = await resp.json();
const wikitext = json?.parse?.wikitext?.['*'];
if (!wikitext || wikitext.length < 5000) throw new Error('Empty/short wikitext');
const parsed = parseWikiText(wikitext);

// Surface (don't silently drop) any party column the current live table has that
// headerKey()/ALL_KEYS/PARTIES don't recognize yet — this is exactly the class of
// gap that let "Unity" and "Amcha Yisrael" go unnoticed until a user spotted it.
if (unrecognizedParties.size) {
  const list = [...unrecognizedParties].join(', ');
  console.warn(`\n⚠️  UNRECOGNIZED PARTY COLUMN(S) in the current live Wikipedia table: ${list}`);
  console.warn('   These are being silently dropped from every poll until headerKey()/ALL_KEYS/PARTIES (in both');
  console.warn('   update-polls.mjs and docs/index.html) are updated to recognize them. See README for the pattern.\n');
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `unrecognized_parties=${list}\n`);
  }
}

const srcHtml = fs.readFileSync(FILES[0], 'utf8');
const arrText = srcHtml.match(/window\.BASE_POLLS_DATA = (\[.*?\]);/s)?.[1];
if (!arrText) throw new Error('BASE_POLLS_DATA array not found in ' + FILES[0]);
const existing = JSON.parse(arrText);

// Rows stored under a name Wikipedia has since renamed away from get canonicalised
// in place, so they keep matching the incoming rows (and the name-keyed lookups in
// the dashboard). Idempotent — a no-op once every row is already canonical.
let renamed = 0;
for (const p of existing) {
  const a = POLLSTER_ALIAS[p.pollster];
  if (!a) continue;
  p.pollster = a.pollster || p.pollster;
  if (a.outlet) p.outlet = a.outlet;
  renamed++;
}

const maxDate = existing.map(p => p.date).sort().pop();
const seen = new Set(existing.map(p => p.date + '|' + p.pollster));
const today = new Date().toISOString().slice(0, 10);
// Wikipedia's editors add a poll a day or two after its fieldwork date, so a poll
// published today is routinely dated BEFORE the newest row already stored. The old
// `p.date > maxDate` gate dropped every such late arrival permanently — that alone
// lost 11 of August 2026's polls. Duplicates are prevented by the date|pollster key
// set, so re-check a whole window back instead of only past the high-water mark.
const cutoff = new Date(Date.now() - BACKFILL_DAYS * 86400000).toISOString().slice(0, 10);
const fresh = parsed
  .filter(p => p.date >= cutoff && p.date <= today && !seen.has(p.date + '|' + p.pollster))
  .sort((a, b) => a.date < b.date ? -1 : 1);

if (!fresh.length && !renamed) { console.log(`No new polls (baked up to ${maxDate}, looking back to ${cutoff}).`); process.exit(0); }

const summary = fresh.map(p => `${p.date} ${p.pollster}`).join(', ');
console.log(`${fresh.length} new poll(s): ${summary || '—'}${renamed ? `; ${renamed} row(s) renamed to a canonical pollster` : ''}`);
if (DRY) { console.log('DRY_RUN — no files written.'); process.exit(0); }

// Backfilled polls land mid-array, so the merged list is re-sorted and re-serialised
// wholesale (same approach as update-govil-polls.mjs) rather than appended.
const merged = [...existing, ...fresh].sort((a, b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : 0));
const mergedJson = JSON.stringify(merged);
for (const f of FILES) {
  const html = fs.readFileSync(f, 'utf8');
  if (!/window\.BASE_POLLS_DATA = \[.*?\];/s.test(html)) throw new Error('BASE_POLLS_DATA array not found in ' + f);
  // Function replacement: a literal `$&`/`$'` inside the JSON would otherwise be
  // interpreted as a replacement pattern.
  fs.writeFileSync(f, html.replace(/window\.BASE_POLLS_DATA = \[.*?\];/s, () => `window.BASE_POLLS_DATA = ${mergedJson};`));
}
regenAll();

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `added=${fresh.length}\nsummary=${summary}\n`);
}
console.log('Files updated.');
