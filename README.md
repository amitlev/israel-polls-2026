# Israel 2026 election polls dashboard (לוח סקרי הבחירות 2026)

A live, self-contained Hebrew dashboard for tracking Israeli 2026 Knesset election polls inside Claude Desktop (Cowork).

**Features**

- Per-party seat averages and medians with party-leader photos, over 141+ polls (Jan-Jul 2026)
- TV-style coalition/opposition half-donut with a 61-seat majority marker
- Trend charts for parties and blocs, with independent date-range sliders
- Assign any party to coalition / opposition / other and watch the blocs recompute
- Auto-refreshes new polls from [Wikipedia's polling page](https://en.wikipedia.org/wiki/Opinion_polling_for_the_2026_Israeli_legislative_election) every time it opens

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

## License

MIT
