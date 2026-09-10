# Israel 2026 election polls dashboard (לוח סקרי הבחירות 2026)

A live dashboard tracking Israeli 2026 Knesset election polls — in Hebrew, Arabic or English.

**→ [israel-polls-2026.vercel.app](https://israel-polls-2026.vercel.app/)**

**Features**

- **A ballot slip counting down to the vote** — days to 27 Oct 2026 on a white paper slip, and a live countdown to the polls closing at 22:00. The day count is resolved in Asia/Jerusalem so a reader abroad still sees Israel's answer, and poll close is a fixed instant: Israeli daylight time ends on the last Sunday of October, the 25th, so 22:00 that day is UTC+2 rather than +3
- Per-party seat averages and medians with party-leader photos, over every poll since the lists closed (see the dataset floor below)
- TV-style coalition/opposition half-donut with a 61-seat majority marker
- **A 120-seat Knesset made of faces** — the seat average cashed out into 120 actual candidates, drawn from the parties' published lists, and re-cuttable by bloc, by ותק (sitting MK / former MK / new) or by gender. Each group is a vertical column as wide a share of the panel as its share of the 120, so the widths are themselves the answer; the coalition column sits on the right in every language, the same convention the tug-of-war and the donut already follow. Switching the cut moves every face across the screen to its new place rather than redrawing
- Trend charts for parties and blocs, with independent date-range sliders
- Assign any party to coalition / opposition / other and watch the blocs recompute
- Auto-refreshes new polls from [Wikipedia's polling page](https://en.wikipedia.org/wiki/Opinion_polling_for_the_2026_Israeli_legislative_election) every time it opens
- Enriches recent polls with real methodology data (margin of error, true respondent count, response rate, undecided %) sourced from the Central Elections Committee's official [Section 16H disclosure filings](https://www.gov.il/he/Departments/DynamicCollectors/knesset_election_polls_26), plus a per-poll "additional scenarios" panel for any merger/what-if seat tables those filings disclose
- **Candidate names in all three languages** — from Wikidata, which holds how a name is actually written rather than what a transliterator would produce. Coverage is partial (107 of 198 in English, 47 in Arabic) and the rest stay Hebrew, because a private individual's name has never been written in English or Arabic anywhere
- **Three languages** — עברית · العربية · English, switched in the header (or `?lang=he|ar|en`) and remembered. Party and leader names, the tug-of-war, every tooltip and the PNG exports all follow; English flips the page to LTR
- **Share and embed any widget** — each panel's share button previews a PNG of the widget as it looks right now and hands you **the screenshot and the link together**: one clipboard write carrying both, X / Facebook / LinkedIn / WhatsApp / Telegram, the native share sheet on mobile, and a copyable `<iframe>` snippet
- **Shared links and embeds carry your filters** — date range, outlets, trend parties, bloc assignment and both average modes travel in the URL, so an embed keeps showing exactly what you picked without the host page needing any filter controls of its own
- A second "מעבר לכותרות" (beyond the horse race) view tracking PM-preference matchups, trust ratings, and policy-opinion questions from the same gov.il filings over time — content Wikipedia's table doesn't carry at all

**הערה בעברית:** הלוח בעברית (RTL) כברירת מחדל, עם מעבר לערבית ולאנגלית במתג שבראש העמוד.

**ملاحظة بالعربية:** اللوحة متاحة بالعربية عبر مبدّل اللغة في أعلى الصفحة (أو `?lang=ar`).

## Running it

The dashboard is a static site: `docs/` is served as-is, no build step.

```bash
python3 -m http.server 8731 --directory docs
```

`docs/index.html` is the page. Its data lives in two generated files beside it —
`docs/polls-data.js` (poll records, rewritten by the update workflows) and
`docs/media-data.js` (baked leader photos, party logos and candidate sprites,
rewritten only by the `build:*` scripts). Neither is edited by hand.

## Data & methodology

- Single source of truth: Wikipedia, "Opinion polling for the 2026 Israeli legislative election"
- **The dataset starts on 1 September 2026** (`POLLS_FROM`). The lists closed on the 8th and the
  ballot changed shape getting there: RZP merged with Zehut, the Reservists with the New Economic
  Party, Unity withdrew, Hadash–Ta'al stopped appearing as its own column, and three lists that did
  not exist in the spring now poll in double figures. An August poll is not a staler reading of
  today's question, it is an answer to a different one. The floor is enforced in `update-polls.mjs`
  *and* on the page's own refresh path, so a scheduled run cannot quietly re-add what was cut.
- Parties below the 3.25% threshold count as 0 seats in that poll
- Averages/medians computed only over polls that reported a figure for that party
- Bloc totals ("others" = complement to 120) follow the user's own coalition/opposition assignments
- Leader photos from Wikipedia/Wikimedia Commons, embedded as data URIs
- Optional **"ממוצע משוקלל" (weighted average)** toggle, inspired by [Silver Bulletin's polling-average methodology](https://www.natesilver.net/p/silver-bulletin-polling-average-methodology): weights each poll by recency (14-day half-life), sample size (diminishing returns, neutral when unreported), and a house-effect correction auto-derived every render from this cycle's own polls only (iterative re-centering by ideological bloc, shrunk toward zero for pollsters with few polls) — distinct from, and independent of, the separate ⚖️ house-effect toggle that uses manually-curated 2009–2022 bias constants. Off by default; the plain mean/median and the original smoothed trend line remain the default view.
- Sample size is scraped from Wikipedia's "Sample size" column starting with polls added after this feature shipped; polls baked in before that have no sample-size figure and are treated as average-sized (neutral weight), never zero-weighted
- The weighted trend line's shaded band is a spread-based ~90% band derived from the local regression's weighted residuals — not a historically-calibrated forecast-accuracy interval (Israel doesn't have decades of polling-error history to calibrate against, unlike Silver Bulletin's US data)
- **Secondary source: gov.il.** `.github/scripts/update-govil-polls.mjs` enriches existing Wikipedia-derived polls (matched by pollster + fieldwork date) with fields parsed from their official gov.il disclosure PDF — it never invents a new poll record from gov.il alone. Coverage is partial: gov.il only publishes ~14 filings for this cycle (vs. 167+ on Wikipedia), and PDF-field extraction is validated against three pollster templates so far (Midgam/Lazar, Kantar, Maagar Mochot) — an unvalidated pollster's PDF may come back with some fields left `null` rather than a wrong value (see the parsing-risk note at the top of `.github/scripts/lib/govil-pdf-parser.mjs`)
  - Requires `playwright` + `pdf-parse` (`npm ci`) since gov.il's listing page is Cloudflare-protected — the PDFs themselves aren't
  - Runs weekly via `.github/workflows/update-govil-polls.yml` (gov.il updates far less often than Wikipedia), and defaults to **review-only** (prints proposed changes, commits nothing) until the `GOVIL_AUTO_WRITE` flag in that workflow is flipped to `'true'` — recommended only after a few runs across different pollsters have been spot-checked against their source PDFs
  - The weighted-average feature's sample-size weighting now prefers the gov.il-sourced true respondent count (`respondents`) over Wikipedia's rougher `sampleSize` wherever both exist
- **"Joint List" is not a party alongside Hadash–Ta'al and Balad — it *is* those two running together** (the June 2026 renewal, without Ra'am). A pollster asks one framing or the other: across all 193 polls, not one carries a Joint List figure and a Hadash–Ta'al/Balad figure at the same time, and `headerKey()` already decodes Wikipedia's colspan to tell the framings apart. Per-poll code needs no special care, since each poll only ever fills one of them; it is code that averages or simulates *across* polls that has to know, so the three keys are named once as `ARAB_JOINT_GROUP` and share a default bloc. The party table shows them as three rows because that is what the polls report — the footer and the table's ⓘ both say they must not be added up.
  - **From 9 Sep 2026, 00:01 Israel time the halves stop being shown at all.** `mergeArabLists()` folds `Hadash-Ta'al` and `Balad` into `Joint List` per poll, leaving only הרשימה המשותפת and רע"ם — the framing the lists are actually running under. It *sums* rather than hides: since no poll carries both framings, the fold is a no-op on the polls that asked the Joint List question and exact on the ones that asked the other, so every poll still totals 120 and the bloc split is unchanged across the cutover (verified: 52.3 / 60.4 / 7.3 either side). It happens once, where `POLLS` is built and again on the refresh path, so all eight widgets and the forecast inherit it; `ARAB_JOINT_GROUP` becomes a single-element list and the collapse code turns into a no-op from that one switch. `update-polls.mjs` is deliberately unchanged — Wikipedia may keep publishing separate columns and the scraper must keep storing them, because this is a presentation rule and the raw data has to stay re-derivable.
  - **Watch out for the older Joint List polls.** The column's meaning changed mid-cycle. In 23 polls from 29 Jan to 26 Apr 2026 it had no Ra'am column beside it, so it meant all three lists together (mean 13.17 seats); in the 19 polls from 11 Jun onward Ra'am is listed separately and it means Hadash–Ta'al + Balad (mean 6.89). Under the default assignment — Ra'am in the opposition bloc, the Joint List in "other" — that makes the bloc reading of the earlier polls jump: opposition averages 48.3 in the polls where Ra'am is inside the Joint List against 62.0 where it runs separately. It only affects the historical end of the bloc trend and of any date range dragged back before June; **splitting the pre-June column into its own key would fix it and has not been done** — and the 9 Sep merge above does not fix it either, since summing the halves is right for the later polls and changes nothing about the earlier ones.
- **Majority-probability model (Monte Carlo).** 4,000 simulations around the mean of the last 21 days of polls, with a correlated bloc swing plus per-party noise, the 3.25% threshold applied to each draw and the draw renormalised to 120 seats. Two things are worth knowing about how its central estimate is built:
  - A party a pollster did not list is read as **0 seats in that poll**, not as "no data". Every individual poll already sums to exactly 120, so a party that only appears in some polls — a mid-cycle arrival, or an alternative-scenario column like "Joint List" in the polls that tested a joint Arab run — must be averaged over *all* the polls in the window, exactly as `pollBlocs()` does for the donut, the tug-of-war and the bloc trend. Averaging only over the polls that named it credited a part-time party with a full-time score: it put the tracked means at ~129 seats instead of 120, and the renormalisation then took ~7% off every party that *had* been measured throughout. In late Aug 2026 that understated the opposition by about 4 seats and reported a 33% opposition-majority probability where the tug-of-war directly above it showed the opposition on 61.4. Fixed; if you add a party, nothing further is needed here.
  - The three `ARAB_JOINT_GROUP` framings are drawn as **one unit**, thresholded on their combined size and then split back across the framings in proportion to their means. Drawing them independently let a simulation return a Knesset containing both the Joint List and the Hadash–Ta'al it is made of, in about a tenth of draws; because those framings usually failed the threshold separately but clear it together, it also kept deleting the "other" bloc and redistributing its seats, which pushed the simulated opposition about 2 seats above what the tug-of-war showed.
  - Because a scenario mixture is collapsed into one mean, a list that runs in only some polls arrives at the simulation near the threshold (e.g. Hadash–Ta'al at ~3.9 when it runs separately in two thirds of the window) and is zeroed in roughly half the draws, with its seats redistributed by the renormalisation. That is the right *aggregate* behaviour — those seats really do go elsewhere when a list does not run or does not cross — but it is not the same as modelling "runs at 6, or does not run at all" explicitly.
  - The panel deliberately uses **its own 21-day window over every pollster**, not the page's date-range and outlet filters, and says so in its badge ("last N polls"). One consequence of the share/embed work: a shared or embedded forecast widget ignores the `from`/`to`/`o` parameters that every other widget honours.
- **The 120-seat grid (`knesset`) is the only widget that needs whole seats**, and producing them is not the same arithmetic as the party table. Three things it does differently, each of them a bug first:
  - It averages every party over **all** the polls in the window (`poll[id] || 0`), not only the polls that named it. Every poll already sums to 120, so a part-time party averaged only over its own polls is credited a full-time score — the same mistake the forecast documents, which put the tracked means at ~129 seats.
  - It **apportions by largest remainder** to exactly 120. Rounding each party independently, as the table's ממוצע column does, does not sum to 120 and cannot.
  - It collapses `ARAB_JOINT_GROUP` to a **single framing** rather than splitting the unit back across its members the way the forecast does. The forecast splits because it is summing bloc totals; here the seats are people, and splitting seated seven Joint List members beside one Hadash–Ta'al member — the same voters twice, two faces for one seat.
  - Coverage is the honest limit: only the parties with a list in `assets/candidate-lists/` fill their seats with real people. Everything else gets a neutral avatar and lands in an explicit "לא ידוע" group in the ותק and gender cuts, rather than being quietly folded into "new" or into a gender.
- **A party header that spans two columns is the failure mode to watch.** This has now bitten three
  times, and the third one silently discarded *every poll from 1 September onwards* — the dataset sat
  at 31 August while Wikipedia carried twelve newer polls, and the scraper cheerfully reported "no new
  polls" each run. Two technical blocs had appeared as `colspan="2"` headers, `RZP-Zehut` and
  `Reserv.-NEP`, and only the "Joint List" case had ever handled a colspan. One unconsumed column
  shifts every column after it, the row's seats stop summing to anything sane, and the sanity check
  then drops the row — quietly, because a dropped row looks exactly like a row that was never there.
  Three fixes, all in `update-polls.mjs` and the page:
  - **Colspan is honoured for every party header, not just the Joint List.** The extra columns are
    pushed as `'+<party>'` keys meaning *add this column to that party*, so a bloc reported as one
    merged cell and a bloc reported as two separate cells both land on the same list.
  - **`Zehut` and `NEP` map to `'+Religious Zionism'` and `'+Reservists'`.** They run on those ballot
    slips, and the column has to be consumed even when it is empty.
  - **A header cell is split on its first depth-0 pipe, not its last.** `! style=… | [[The
    Reservists|Reserv.]]-[[New Economic Party|NEP]]` was being read as `NEP]]`, because the last pipe
    on the line is inside the second wikilink. That is also what made `Gov.{{efn|…}}` come back as a
    paragraph of footnote and show up as a bogus "unrecognized column".
- **A sub-threshold percentage is a zero, not a missing answer.** `(1.3%)`, `(<1%)` and `(~2%)` all mean
  the pollster asked about the party and it did not clear the threshold. Only the first form was
  recognized; `(<1%)` was read as "not reported", and since the party table averages a party over the
  polls that reported it, that quietly *lifted* the mean of a party polling below 1% instead of
  dragging it down.
- **New-party detection.** Wikipedia's table occasionally adds a party column (e.g. Unity, Amcha Yisrael) that `headerKey()` doesn't recognize yet — until it's added to `ALL_KEYS`/`headerKey()`/`PARTIES` (in both `update-polls.mjs` and `docs/index.html`), that party's seats are silently dropped from every poll rather than shown, and worse, when Wikipedia's "Joint List" column isn't colspan-merged, an unrelated bug can shift every later column's data (this happened for real — see the Aug 2026 Yashar/Democrats corruption fixed in this repo's history). To catch this automatically going forward, `update-polls.mjs` now flags any header cell it can't recognize in the currently-active table; the twice-daily workflow surfaces that as a GitHub issue (opened once, commented on for repeat detections) instead of a log line nobody reads. The same check also runs client-side (as a `console.warn`) when the dashboard refreshes from Wikipedia in the browser.
- **Removing a party from the display is not the same as removing it from the parser.** `Unity`
  (withdrew 4 Sep 2026) and `Hadash-Ta'al` are gone from `PARTIES`, so neither is shown; both stay in
  `ALL_KEYS`/`headerKey()`, because the older tables still carry their columns and an unrecognized
  column shifts every column after it — see above. Balad needs no flag: it has no figure in any poll
  since 1 September, and a party with no data in range simply does not render.
- A party's `active` flag in `PARTIES` controls whether it's shown at all (used for parties superseded by a later merger, e.g. `Yesh Atid`/`Bennett 2026` after the `Together` merger) — when Wikipedia's table stops populating one tracked key in favor of a differently-named one for the same real-world party (as happened with `Yesodot Yisrael` → `Reservists`/"Zionist Home"), flip the flags to match which key current polls actually populate, rather than assuming the newer-added key is always the active one.

## The gov.il disclosures carry vote shares — Wikipedia does not

Under §16H of the Elections (Means of Propaganda) Law every poll published to the public must
be filed with the Central Elections Committee, which posts it verbatim. The
[26th-Knesset collector](https://www.gov.il/he/Departments/DynamicCollectors/knesset_election_polls_26)
holds 62 filings. Their main table looks like this (Kantar for Kan 11, 9 Sep 2026):

```
תחזית המנדטים                      מנדטים   אחוזים (נתונים גולמיים)
הליכוד בראשות בנימין נתניהו           21     17.0%
…
עמך ישראל בראשות עופר וינטר            4      3.3%
כחול לבן בראשות בני גנץ                       0.8%
הציבור החרדי בראשות מוטי לייטנר               0.9%
מפלגת נעם בראשות אבי מעוז                     0.4%
ישראל תחילה ועלה ירוק בראשות שרן השכל          0.5%
סה"כ (מנדטים)                        120      100%
```

That is the one thing the Wikipedia feed structurally cannot supply, and it dissolves three
approximations this project had been carrying:

- **Lists below the threshold have a measured size.** Wikipedia records כחול לבן as `0`; the
  filings measure it at **0.8%, 1.2% and 1.7%** across the three that parse. The what-if
  panel's "assume it holds N seats" default was 2.5 — roughly double — and is now **1.5**,
  citing the measurement.
- **The wasted vote is knowable, so the real bar is knowable.** The threshold is 3.25% of *all*
  valid votes; this page tests a party's share of the *seated* vote, because seats are all it
  has. The gap is the wasted share, and the filings put it at **2.1%, 2.6% and 5.1%** — so the
  true bar is **3.98 / 4.00 / 4.11** seat-equivalents where the page uses a flat 3.9.
- **The margins are finer than seats can show.** עמך ישראל and המילואימניקים both sit at 4
  seats / **3.3%** against a 3.25% threshold — five hundredths of a point. "4 seats" cannot
  express that; "3.3% vs 3.25%" can.

**What is implemented.** `govil-pdf-parser.mjs` now keeps rows that carry a percentage and no
seat count — previously dropped, and precisely the rows that matter — and returns the main
table as `mainParties` instead of discarding it. Table detection no longer keys off a literal
`שאלה:` prefix or a fixed question wording (both vendor-specific, both documented as broken for
Kantar); `findMainSeatTable()` finds the table by its shape, anchored on the `סה"כ` row.

**What is not.** Nothing consumes `mainParties` yet — the field is produced and verified, not
yet stored per poll or read by the page. Three of nine sampled vendor templates parse cleanly
(Kantar ×2, Next Data); the rest are rejected rather than guessed at. The hard case is a
vendor that publishes the main question as a multi-column *trend* table — this week beside the
previous three — which pdf-parse flattens into rows carrying four weeks' numbers with
neighbouring lists welded on. That shape passed a naive "about 120 seats" check while being
entirely wrong, so `findMainSeatTable()` also requires the percentages to be nearly complete
and to sum to ~100, and rejects any row whose list name still contains a digit.

Remaining to make this usable end to end: per-vendor handling for the trend-table templates, a
Hebrew list-name → party-id matcher (labels read `הליכוד בראשות בנימין נתניהו`, and PARTIES
already carries the Hebrew names to match against), storage of `pct`/`wastedPct` per poll, and
then the page reading them where present with the seat-based path as fallback.

## Languages (he · ar · en)

The dashboard is authored in Hebrew and stays that way — every literal in the render code, every string comparison, every `localStorage` key. Arabic and English are a presentation layer, added entirely in the `<head>` of `docs/index.html`:

- One Hebrew-keyed phrase table (`T`), each entry carrying its `ar` and `en` translation side by side so a gap is obvious, plus a translator that rewrites text nodes and human-readable attributes (`title`, `aria-label`, …) as they land in the DOM, driven by a `MutationObserver`. That covers all ~70 render sites without threading a `t()` call through any of them, and it runs at the microtask checkpoint, so there is no flash of Hebrew.
- Party, leader and outlet names are swapped in the data instead (`IL_PARTY` / `IL_OUTLET`), because the render code also interpolates them into SVG attributes and the PNG export canvas, which the DOM pass never sees.
- Matching is leftmost-**longest**, not leftmost-first: a bare regex alternation would let a short numeric template like `"%n סקרים"` win over a long sentence starting a word later. Matches are collected per rule and resolved longest-first.
- One HTML file for all three, so the twice-daily Wikipedia update has nothing extra to keep in sync.

**English and direction.** English sets `<html dir="ltr">`. The stylesheet is written with logical properties, so almost nothing had to change; the four physical exceptions carry an `html[dir="ltr"]` rule beside them. Three drawings are direction-aware in code rather than CSS: the PNG export lays itself out on a canvas (`X()`/`RX()`/`AL()` mirror it), and `drawBarChart` mirrors because it reads in text order. The tug-of-war and the bloc donut deliberately do **not** mirror — the coalition sits on the right because that is where the right-wing bloc goes, which is a political convention, not a reading direction. English also spells the month (`5 Mar 2026`), since `5.3.2026` is ambiguous to an English reader; the `%d` placeholder matches both shapes.

**Editing it.** A phrase missing from the table simply stays Hebrew — coverage degrades, nothing breaks. That is also what happens to a party, or a gov.il answer option, that Wikipedia/gov.il introduces after the table was written, so add new user-facing Hebrew to the table in the same commit that introduces it. To check coverage, load the page with `?lang=ar` or `?lang=en` and walk the DOM for characters in the Hebrew block; only the `עב` language button should match. Verbatim gov.il text (the `mode` field, the additional-scenario tables) is deliberately marked `data-no-i18n` and left in Hebrew: it is free text quoted from a disclosure PDF, and reads far worse half translated.

Two things must stay hand-wired because translation happens *after* render: the tug-of-war majority pill is sized from its label's length, so it measures `ILT(status)`; and the per-widget methodology tooltip is keyed by the on-screen panel title, so it maps back through `ILT_SRC()`.

## Share and embed

Every panel carries a `data-widget` id — `tug`, `ask`, `knesset`, `parties`, `party-trend`, `blocs`, `bloc-trend`, `forecast`, `pm`. That id is the whole contract, so it should outlive markup changes:

| URL | What it does |
| --- | --- |
| `?w=<id>` | opens the full dashboard scrolled to that widget, with a brief highlight |
| `?embed=<id>` | renders that widget alone, no header, controls or footer |
| `&lang=he\|ar\|en` | pins the language; a shared link keeps the language it was shared in |
| `&k=blocs\|tenure\|gender` | the seat grid's grouping, so a shared link or embed opens on the cut it was shared in |

### The screenshot

Opening the share popover renders the same PNG the download button produces (`window.widgetImage()`) and shows it as a preview, so you can see what you are about to share. **Copy image + link** writes one `ClipboardItem` carrying both `image/png` and `text/plain`: pasting into a composer that takes images gets the screenshot, pasting into a text field gets the link. Clicking a network button copies the image on the way out and tells you to paste it — an intent URL cannot carry an attachment, so this is as close to "screenshot and link" as the web allows. Where the clipboard refuses images the PNG is saved instead and the wording changes to say so, rather than claiming a copy that did not happen. On mobile, `navigator.share` takes the file directly.

The `ask` panel has no chart or table, so it gets link and embed actions only.

### The filters

Both link kinds carry the filters in force when they were made — `from`/`to`, `o` (outlets), `p` (trend parties), `b` (bloc overrides, only where they differ from the default), `wt` and `adj` for the two average modes. Outlets and parties travel as slugs (`Channel 12 (HaHadashot 12)` → `channel-12`) rather than raw keys or indices: shorter than the keys, and stable against the index shuffling that adding an outlet to the dataset would cause.

State is applied **in memory only**. A link someone else made must not overwrite the reader's own saved filters, so nothing touches `localStorage` on the way in. The two mode toggles are flipped by clicking their own buttons, so their labels and re-render come along for free.

Share URLs always point at the public site rather than `location.href`: inside an embed the current URL is the host page's, which means nothing to anyone else.

In embed mode the rest of the page is hidden rather than removed — the render code looks elements up by id and redraws on theme changes and refreshes, so anything torn out would break the widget still on screen. Until the target panel has been moved into `.embed-root` the body is only `visibility:hidden`, so the first render still measures real boxes. The party-trend panel's own picker is hidden too: an embed shows the embedder's selection, not a control for changing it.

The bloc-assignment buttons in the party table stay live, though. They are the widget's own interaction rather than a filter, they hide nothing, and a reload returns to whatever the embed URL asked for.

Two limits worth knowing: an embed loads the whole dashboard — ~260KB of page plus a ~680KB `media-data.js` of baked images, which the browser caches across visits; and link previews are a static `summary` card with no `og:image`, because generating a per-widget preview image would need a server-side renderer this static site does not have.

## License

MIT
