#!/usr/bin/env node
/*
 * Enriches existing window.BASE_POLLS_DATA records with fields extracted
 * from gov.il's Section-16H poll-disclosure PDFs (margin of error, true
 * sample size/response rate, methodology, undecided %, merger what-if
 * scenarios), and collects topical opinion questions into
 * window.GOVIL_TOPICAL_DATA. See .github/scripts/lib/govil-pdf-parser.mjs
 * for the PDF field extraction and .github/scripts/lib/govil-pollster-map.mjs
 * for the Hebrew->English pollster identity mapping.
 *
 * The gov.il listing page is Cloudflare-protected, so discovery requires a
 * real headless browser (Playwright) — the PDFs themselves are plain
 * fetch()-able once you have their URL. Runs in review-only mode (prints
 * proposed changes, writes nothing) unless WRITE=1 is set — recommended
 * until a handful of runs across different pollsters have been spot-checked
 * against their source PDFs (parsing risk is per-pollster-template, see
 * README).
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { PDFParse } from 'pdf-parse';
import { FILES, regenAll } from './lib/restore-chunks.mjs';
import { mapGovilPollster } from './lib/govil-pollster-map.mjs';
import { parseGovilPdf } from './lib/govil-pdf-parser.mjs';

const WRITE = !!process.env.WRITE;
const LISTING_URL = 'https://www.gov.il/he/Departments/DynamicCollectors/knesset_election_polls_26';
const MATCH_WINDOW_DAYS = 5;   // gov.il's fieldwork-end date vs. Wikipedia's reported date rarely disagree by more than this

/* ── listing discovery (Cloudflare-protected — needs a real browser) ── */
async function fetchListing(){
  const browser = await chromium.launch({ headless: true });
  const byUrlName = new Map();
  let total = null;

  // A fresh browser *context* per skip value, not a reused one — reusing one
  // context across sequential navigations (even with a fresh Page each time)
  // was observed to silently re-serve the first page's API response instead
  // of re-fetching, presumably some client-side (localStorage/session) cache
  // in the Angular app keyed only on the template ID, ignoring skip.
  let skip = 0;
  do {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'he-IL',
    });
    const page = await context.newPage();
    page.on('response', async (res) => {
      if (!res.url().includes('/he/api/DynamicCollector')) return;
      try {
        const json = await res.json();
        if (json?.TotalResults != null) total = json.TotalResults;
        for (const r of json?.Results || []) byUrlName.set(r.UrlName, r);
      } catch { /* non-JSON response on that URL, ignore */ }
    });
    await page.goto(`${LISTING_URL}?skip=${skip}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(4000);
    await context.close();
    if (process.env.DEBUG) console.error(`  [debug] skip=${skip} -> total=${total} entriesSoFar=${byUrlName.size}`);
    skip += 10;
  } while (total != null && skip < total);

  await browser.close();
  if (total == null) throw new Error('gov.il listing: API response never intercepted (Cloudflare block, or the page/API changed shape)');
  return [...byUrlName.values()];
}

function pdfUrl(entry){
  const file = entry.Data.file_PDF?.[0];
  return file ? `https://www.gov.il/BlobFolder/dynamiccollectorresultitem/${entry.UrlName}/he/${encodeURIComponent(file.FileName)}` : null;
}

async function fetchAndParsePdf(url){
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!resp.ok) throw new Error(`PDF HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const parser = new PDFParse({ data: buf });
  const data = await parser.getText();
  await parser.destroy();
  return parseGovilPdf(data.text, { sourceUrl: url });
}

/* ── matching a filing to an existing BASE_POLLS_DATA record ── */
function daysBetween(a, b){
  return Math.abs(new Date(a) - new Date(b)) / 86400000;
}
// Weekly-cadence pollsters often have several polls within a few days of each
// other, so a single wide window is too loose (see #4 validation run). Widen
// progressively and stop at the first window that yields exactly one match —
// an exact-date hit should always win over a same-pollster poll 4 days away.
function findMatch(existing, pollsterKey, fieldworkDate){
  if (!pollsterKey || !fieldworkDate) return { poll: null, reason: 'missing mapped pollster or fieldwork date' };
  for (const w of [0, 1, 2, 3, MATCH_WINDOW_DAYS]){
    const candidates = existing.filter(p => p.pollster === pollsterKey && daysBetween(p.date, fieldworkDate) <= w);
    if (candidates.length === 1) return { poll: candidates[0], reason: null };
    if (candidates.length > 1) return { poll: null, reason: `ambiguous — ${candidates.length} candidates for ${pollsterKey} within ${w}d of ${fieldworkDate}` };
  }
  return { poll: null, reason: `no BASE_POLLS_DATA match for ${pollsterKey} within ${MATCH_WINDOW_DAYS}d of ${fieldworkDate}` };
}

/* ── main ── */
const srcHtml = fs.readFileSync(FILES[0], 'utf8');
const pollsArrText = srcHtml.match(/window\.BASE_POLLS_DATA = (\[.*?\]);/s)?.[1];
if (!pollsArrText) throw new Error('BASE_POLLS_DATA array not found in ' + FILES[0]);
const polls = JSON.parse(pollsArrText);

const topicalArrText = srcHtml.match(/window\.GOVIL_TOPICAL_DATA = (\[.*?\]);/s)?.[1];
if (topicalArrText == null) throw new Error('GOVIL_TOPICAL_DATA array not found in ' + FILES[0] + ' — add the empty-array declaration to both HTML files first');
const existingTopical = JSON.parse(topicalArrText);
const seenTopical = new Set(existingTopical.map(t => t.sourceUrl + '|' + t.topicId));

console.log('Fetching gov.il listing (headless browser)...');
const listing = await fetchListing();
console.log(`Found ${listing.length} filing(s).`);

let enrichedCount = 0;
const freshTopical = [];
const skipped = [];

for (const entry of listing){
  const url = pdfUrl(entry);
  if (!url) { skipped.push(`${entry.UrlName}: no PDF filename in listing`); continue; }

  const pollsterKey = mapGovilPollster(entry.Data.survey_editor);
  if (!pollsterKey) { skipped.push(`${entry.UrlName}: unmapped pollster "${entry.Data.survey_editor}" — add it to govil-pollster-map.mjs`); continue; }

  let parsed;
  try {
    parsed = await fetchAndParsePdf(url);
  } catch (e) {
    skipped.push(`${entry.UrlName}: PDF fetch/parse failed — ${e.message}`);
    continue;
  }

  const fieldworkDate = parsed.metadata.fieldworkDate || entry.Data.date_the_survey?.slice(0, 10);
  const { poll, reason } = findMatch(polls, pollsterKey, fieldworkDate);
  if (!poll) { skipped.push(`${entry.UrlName}: ${reason}`); continue; }

  const enrichment = {
    respondents: parsed.metadata.respondents,
    invited: parsed.metadata.invited,
    responseRate: parsed.metadata.responseRate,
    refusedPct: parsed.metadata.refusedPct,
    marginOfError: parsed.metadata.marginOfError,
    samplingMethod: parsed.metadata.samplingMethod,
    populationSampled: parsed.metadata.populationSampled,
    mode: parsed.metadata.mode,
    statisticalMethod: parsed.metadata.statisticalMethod,
    undecidedPct: parsed.undecidedPct,
    fieldworkDate,
    govilSourceUrl: url,
    govilScenarios: parsed.govilScenarios.length ? parsed.govilScenarios : undefined,
  };
  console.log(`MATCH  ${entry.UrlName} -> ${poll.date} ${poll.pollster}  (MOE=${enrichment.marginOfError}, respondents=${enrichment.respondents}, scenarios=${parsed.govilScenarios.length}, topical=${parsed.topical.length})`);
  Object.assign(poll, enrichment);
  enrichedCount++;

  for (const t of parsed.topical){
    const key = t.sourceUrl + '|' + t.topicId;
    if (seenTopical.has(key)) continue;
    seenTopical.add(key);
    freshTopical.push({ date: poll.date, fieldworkDate, pollster: pollsterKey, outlet: poll.outlet, ...t });
  }
}

console.log(`\nEnriched ${enrichedCount} poll(s). Skipped ${skipped.length}:`);
skipped.forEach(s => console.log('  - ' + s));
console.log(`${freshTopical.length} new topical question record(s).`);

if (!WRITE){
  console.log('\nREVIEW-ONLY mode (default) — no files written. Set WRITE=1 once this run has been spot-checked.');
  process.exit(0);
}
if (!enrichedCount && !freshTopical.length){
  console.log('Nothing to write.');
  process.exit(0);
}

const newPollsJson = JSON.stringify(polls);
const freshTopicalJoined = freshTopical.map(t => JSON.stringify(t)).join(', ');

for (const f of FILES){
  let html = fs.readFileSync(f, 'utf8');
  html = html.replace(/window\.BASE_POLLS_DATA = \[.*?\];/s, `window.BASE_POLLS_DATA = ${newPollsJson};`);
  if (freshTopical.length){
    // Regex-anchored on the full "window.GOVIL_TOPICAL_DATA = [...];" statement,
    // not a plain string search on just the captured array text — a bare "[]"
    // (the common starting case) isn't unique in a 200KB+ file and a plain
    // .replace("[]", ...) can silently corrupt an unrelated empty array elsewhere.
    // Also handled explicitly here: appending onto an empty array must not
    // produce a leading comma ("[, {...}]" is invalid JSON).
    html = html.replace(/window\.GOVIL_TOPICAL_DATA = (\[.*?\]);/s, (full, arr) => {
      const newArr = arr.trim() === '[]' ? `[${freshTopicalJoined}]` : arr.slice(0, -1) + ', ' + freshTopicalJoined + ']';
      return `window.GOVIL_TOPICAL_DATA = ${newArr};`;
    });
  }
  fs.writeFileSync(f, html);
}
regenAll();

if (process.env.GITHUB_OUTPUT){
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `enriched=${enrichedCount}\ntopical=${freshTopical.length}\n`);
}
console.log('Files updated.');
