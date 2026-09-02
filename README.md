# Israel 2026 election polls dashboard (לוח סקרי הבחירות 2026)

A live, self-contained dashboard for tracking Israeli 2026 Knesset election polls inside Claude Desktop (Cowork) — in Hebrew, Arabic or English.

**Features**

- Per-party seat averages and medians with party-leader photos, over 141+ polls (Jan-Jul 2026)
- TV-style coalition/opposition half-donut with a 61-seat majority marker
- Trend charts for parties and blocs, with independent date-range sliders
- Assign any party to coalition / opposition / other and watch the blocs recompute
- Auto-refreshes new polls from [Wikipedia's polling page](https://en.wikipedia.org/wiki/Opinion_polling_for_the_2026_Israeli_legislative_election) every time it opens
- Enriches recent polls with real methodology data (margin of error, true respondent count, response rate, undecided %) sourced from the Central Elections Committee's official [Section 16H disclosure filings](https://www.gov.il/he/Departments/DynamicCollectors/knesset_election_polls_26), plus a per-poll "additional scenarios" panel for any merger/what-if seat tables those filings disclose
- **Three languages** — עברית · العربية · English, switched in the header (or `?lang=he|ar|en`) and remembered. Party and leader names, the tug-of-war, every tooltip and the PNG exports all follow; English flips the page to LTR
- **Share and embed any widget** — each panel's share button previews a PNG of the widget as it looks right now and hands you **the screenshot and the link together**: one clipboard write carrying both, X / Facebook / LinkedIn / WhatsApp / Telegram, the native share sheet on mobile, and a copyable `<iframe>` snippet
- **Shared links and embeds carry your filters** — date range, outlets, trend parties, bloc assignment and both average modes travel in the URL, so an embed keeps showing exactly what you picked without the host page needing any filter controls of its own
- A second "מעבר לכותרות" (beyond the horse race) view tracking PM-preference matchups, trust ratings, and policy-opinion questions from the same gov.il filings over time — content Wikipedia's table doesn't carry at all

**הערה בעברית:** הלוח בעברית (RTL) כברירת מחדל, עם מעבר לערבית ולאנגלית במתג שבראש העמוד. ההתקנה דורשת Claude Desktop במצב Cowork.

**ملاحظة بالعربية:** اللوحة متاحة بالعربية عبر مبدّل اللغة في أعلى الصفحة (أو `?lang=ar`).

## Install

In Claude Desktop (Cowork) or Claude Code, add this repo as a plugin marketplace and install:

```
/plugin marketplace add amitlev/israel-polls-2026
/plugin install israel-polls-2026@israel-polls-2026
```

Then ask Claude: **"Install the Israel polls dashboard"** (or in Hebrew: "התקן את לוח הסקרים").

Alternatively, point your Claude at this repo and ask it to install the dashboard from `plugins/israel-polls-2026`, or download the `.plugin` file from the repo and open it in Cowork.

## Data & methodology

- Single source of truth: Wikipedia, "Opinion polling for the 2026 Israeli legislative election"
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
  - **Watch out for the older Joint List polls.** The column's meaning changed mid-cycle. In 23 polls from 29 Jan to 26 Apr 2026 it had no Ra'am column beside it, so it meant all three lists together (mean 13.17 seats); in the 19 polls from 11 Jun onward Ra'am is listed separately and it means Hadash–Ta'al + Balad (mean 6.89). Under the default assignment — Ra'am in the opposition bloc, the Joint List in "other" — that makes the bloc reading of the earlier polls jump: opposition averages 48.3 in the polls where Ra'am is inside the Joint List against 62.0 where it runs separately. It only affects the historical end of the bloc trend and of any date range dragged back before June; **splitting the pre-June column into its own key would fix it and has not been done.**
- **Majority-probability model (Monte Carlo).** 4,000 simulations around the mean of the last 21 days of polls, with a correlated bloc swing plus per-party noise, the 3.25% threshold applied to each draw and the draw renormalised to 120 seats. Two things are worth knowing about how its central estimate is built:
  - A party a pollster did not list is read as **0 seats in that poll**, not as "no data". Every individual poll already sums to exactly 120, so a party that only appears in some polls — a mid-cycle arrival, or an alternative-scenario column like "Joint List" in the polls that tested a joint Arab run — must be averaged over *all* the polls in the window, exactly as `pollBlocs()` does for the donut, the tug-of-war and the bloc trend. Averaging only over the polls that named it credited a part-time party with a full-time score: it put the tracked means at ~129 seats instead of 120, and the renormalisation then took ~7% off every party that *had* been measured throughout. In late Aug 2026 that understated the opposition by about 4 seats and reported a 33% opposition-majority probability where the tug-of-war directly above it showed the opposition on 61.4. Fixed; if you add a party, nothing further is needed here.
  - The three `ARAB_JOINT_GROUP` framings are drawn as **one unit**, thresholded on their combined size and then split back across the framings in proportion to their means. Drawing them independently let a simulation return a Knesset containing both the Joint List and the Hadash–Ta'al it is made of, in about a tenth of draws; because those framings usually failed the threshold separately but clear it together, it also kept deleting the "other" bloc and redistributing its seats, which pushed the simulated opposition about 2 seats above what the tug-of-war showed.
  - Because a scenario mixture is collapsed into one mean, a list that runs in only some polls arrives at the simulation near the threshold (e.g. Hadash–Ta'al at ~3.9 when it runs separately in two thirds of the window) and is zeroed in roughly half the draws, with its seats redistributed by the renormalisation. That is the right *aggregate* behaviour — those seats really do go elsewhere when a list does not run or does not cross — but it is not the same as modelling "runs at 6, or does not run at all" explicitly.
  - The panel deliberately uses **its own 21-day window over every pollster**, not the page's date-range and outlet filters, and says so in its badge ("last N polls"). One consequence of the share/embed work: a shared or embedded forecast widget ignores the `from`/`to`/`o` parameters that every other widget honours.
- **New-party detection.** Wikipedia's table occasionally adds a party column (e.g. Unity, Amcha Yisrael) that `headerKey()` doesn't recognize yet — until it's added to `ALL_KEYS`/`headerKey()`/`PARTIES` (in both `update-polls.mjs` and `docs/index.html`), that party's seats are silently dropped from every poll rather than shown, and worse, when Wikipedia's "Joint List" column isn't colspan-merged, an unrelated bug can shift every later column's data (this happened for real — see the Aug 2026 Yashar/Democrats corruption fixed in this repo's history). To catch this automatically going forward, `update-polls.mjs` now flags any header cell it can't recognize in the currently-active table; the twice-daily workflow surfaces that as a GitHub issue (opened once, commented on for repeat detections) instead of a log line nobody reads. The same check also runs client-side (as a `console.warn`) when the dashboard refreshes from Wikipedia in the browser.
- A party's `active` flag in `PARTIES` controls whether it's shown at all (used for parties superseded by a later merger, e.g. `Yesh Atid`/`Bennett 2026` after the `Together` merger) — when Wikipedia's table stops populating one tracked key in favor of a differently-named one for the same real-world party (as happened with `Yesodot Yisrael` → `Reservists`/"Zionist Home"), flip the flags to match which key current polls actually populate, rather than assuming the newer-added key is always the active one.

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

Every panel carries a `data-widget` id — `tug`, `ask`, `parties`, `party-trend`, `blocs`, `bloc-trend`, `forecast`, `pm`. That id is the whole contract, so it should outlive markup changes:

| URL | What it does |
| --- | --- |
| `?w=<id>` | opens the full dashboard scrolled to that widget, with a brief highlight |
| `?embed=<id>` | renders that widget alone, no header, controls or footer |
| `&lang=he\|ar\|en` | pins the language; a shared link keeps the language it was shared in |

### The screenshot

Opening the share popover renders the same PNG the download button produces (`window.widgetImage()`) and shows it as a preview, so you can see what you are about to share. **Copy image + link** writes one `ClipboardItem` carrying both `image/png` and `text/plain`: pasting into a composer that takes images gets the screenshot, pasting into a text field gets the link. Clicking a network button copies the image on the way out and tells you to paste it — an intent URL cannot carry an attachment, so this is as close to "screenshot and link" as the web allows. Where the clipboard refuses images the PNG is saved instead and the wording changes to say so, rather than claiming a copy that did not happen. On mobile, `navigator.share` takes the file directly.

The `ask` panel has no chart or table, so it gets link and embed actions only.

### The filters

Both link kinds carry the filters in force when they were made — `from`/`to`, `o` (outlets), `p` (trend parties), `b` (bloc overrides, only where they differ from the default), `wt` and `adj` for the two average modes. Outlets and parties travel as slugs (`Channel 12 (HaHadashot 12)` → `channel-12`) rather than raw keys or indices: shorter than the keys, and stable against the index shuffling that adding an outlet to the dataset would cause.

State is applied **in memory only**. A link someone else made must not overwrite the reader's own saved filters, so nothing touches `localStorage` on the way in. The two mode toggles are flipped by clicking their own buttons, so their labels and re-render come along for free.

Share URLs always point at the public site rather than `location.href`, because this page also runs from `file://` inside Cowork and from the plugin's bundled copy, where the current URL means nothing to anyone else.

In embed mode the rest of the page is hidden rather than removed — the render code looks elements up by id and redraws on theme changes and refreshes, so anything torn out would break the widget still on screen. Until the target panel has been moved into `.embed-root` the body is only `visibility:hidden`, so the first render still measures real boxes. The party-trend panel's own picker is hidden too: an embed shows the embedder's selection, not a control for changing it.

The bloc-assignment buttons in the party table stay live, though. They are the widget's own interaction rather than a filter, they hide nothing, and a reload returns to whatever the embed URL asked for.

Two limits worth knowing: an embed loads the whole ~690KB single-file dashboard, since that is what a self-contained page can offer; and link previews are a static `summary` card with no `og:image`, because generating a per-widget preview image would need a server-side renderer this static site does not have.

## License

MIT
