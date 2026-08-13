# Israel 2026 election polls dashboard (לוח סקרי הבחירות 2026)

A live, self-contained Hebrew dashboard for tracking Israeli 2026 Knesset election polls inside Claude Desktop (Cowork).

**Features**

- Per-party seat averages and medians with party-leader photos, over 141+ polls (Jan-Jul 2026)
- TV-style coalition/opposition half-donut with a 61-seat majority marker
- Trend charts for parties and blocs, with independent date-range sliders
- Assign any party to coalition / opposition / other and watch the blocs recompute
- Auto-refreshes new polls from [Wikipedia's polling page](https://en.wikipedia.org/wiki/Opinion_polling_for_the_2026_Israeli_legislative_election) every time it opens
- Enriches recent polls with real methodology data (margin of error, true respondent count, response rate, undecided %) sourced from the Central Elections Committee's official [Section 16H disclosure filings](https://www.gov.il/he/Departments/DynamicCollectors/knesset_election_polls_26), plus a per-poll "additional scenarios" panel for any merger/what-if seat tables those filings disclose
- A second "מעבר לכותרות" (beyond the horse race) view tracking PM-preference matchups, trust ratings, and policy-opinion questions from the same gov.il filings over time — content Wikipedia's table doesn't carry at all

**הערה בעברית:** הלוח עצמו כולו בעברית (RTL). ההתקנה דורשת Claude Desktop במצב Cowork.

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

## License

MIT
