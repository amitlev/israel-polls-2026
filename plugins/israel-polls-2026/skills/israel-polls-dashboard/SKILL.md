---
name: israel-polls-dashboard
description: Install or update the Israel 2026 Knesset election polls dashboard as a live Cowork artifact. Use when the user asks for the Israel polls dashboard, Israeli election polls, לוח סקרים, סקרי בחירות, mandate polls, Knesset seat projections, or wants to install/open/refresh this dashboard.
---

# Israel 2026 election polls dashboard

Install a self-contained Hebrew (RTL) dashboard tracking Israeli 2026 Knesset election polls as a persistent Cowork artifact.

The dashboard HTML is bundled at `assets/dashboard.html` relative to this skill directory. It is fully self-contained: 141+ baked-in polls (January-July 2026, sourced from Wikipedia's "Opinion polling for the 2026 Israeli legislative election"), embedded party-leader photos, and JavaScript that auto-refreshes newer polls from Wikipedia on every open.

## Installation steps

1. Read the bundled file `assets/dashboard.html` (in this skill's directory).
2. Copy it to a file in your workspace scratch directory.
3. Create a Cowork artifact from it:
   - Call `mcp__cowork__create_artifact` with:
     - `id`: `israel-2026-election-polls`
     - `html_path`: the copied file path
     - `description`: "לוח סקרי הבחירות לכנסת 2026 — ממוצעי מנדטים לפי מפלגה, חלוקה לגושים, וגרפי מגמות. מתרענן אוטומטית מוויקיפדיה."
     - `mcp_tools`: `["mcp__workspace__web_fetch"]` — the dashboard calls this tool at load time to pull new polls from Wikipedia.
   - If an artifact with that id already exists, use `mcp__cowork__update_artifact` instead with the same parameters plus a short `update_summary`.
4. Tell the user the dashboard is installed in their artifacts sidebar and will auto-refresh with new polls each time it opens.

## Fallback (no artifact support)

If artifact tools are unavailable (e.g., Claude Code rather than Cowork), copy `assets/dashboard.html` to the user's working directory as `israel_2026_polls_dashboard.html` and tell them to open it in a browser. Note that the auto-refresh feature only works inside Cowork artifacts; in a plain browser the dashboard shows its baked-in data.

## Dashboard features (for answering user questions)

- Right half "לפי מפלגה": seat-average/median table with leader photos and per-party coalition/opposition/other assignment buttons, plus a party trend chart with a multi-select party picker.
- Left half "לפי גוש": TV-style half-donut (coalition red, opposition blue, 61-seat majority marker) plus a bloc trend chart. Bloc composition follows the user's assignment buttons and persists in localStorage.
- Each half has its own dual-handle date-range slider; a media-outlet multi-select dropdown at the top applies to both halves.
- Data: Wikipedia is the single source of truth. Parties below the 3.25% electoral threshold count as 0 seats. Merged parties (Bennett 2026, Yesh Atid, Reservists) are hidden from the table but included in historical bloc math.
