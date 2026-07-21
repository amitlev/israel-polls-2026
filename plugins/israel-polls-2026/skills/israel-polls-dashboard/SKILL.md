---
name: israel-polls-dashboard
description: Install or update the Israel 2026 Knesset election polls dashboard as a live Cowork artifact. Use when the user asks for the Israel polls dashboard, Israeli election polls, לוח סקרים, סקרי בחירות, mandate polls, Knesset seat projections, or wants to install/open/refresh this dashboard.
---

# Israel 2026 election polls dashboard

Install a self-contained Hebrew (RTL) dashboard tracking Israeli 2026 Knesset election polls as a persistent Cowork artifact, and set up a weekly scheduled task that automatically fetches new polls from Wikipedia.

The dashboard HTML is bundled at `assets/dashboard.html` relative to this skill directory. It contains 141+ baked-in polls (January–July 2026) sourced from Wikipedia. A separate `israel-polls-refresh` skill (also in this plugin) handles fetching newer polls and is invoked automatically by the scheduled task.

## Installation steps

### 1. Create or update the artifact

Read the bundled file `assets/dashboard.html` (in this skill's directory).
Copy it to a file in your workspace scratch directory.

Call `mcp__cowork__list_artifacts` to check if `israel-2026-election-polls` already exists.

- If it **does not exist**: call `mcp__cowork__create_artifact` with:
  - `id`: `israel-2026-election-polls`
  - `html_path`: the copied file path
  - `description`: "לוח סקרי הבחירות לכנסת 2026 — ממוצעי מנדטים לפי מפלגה, חלוקה לגושים, וגרפי מגמות."
  - `mcp_tools`: `[]`

- If it **already exists**: call `mcp__cowork__update_artifact` with the same parameters plus `update_summary`: "עדכון לגרסה העדכנית"

### 2. Set up the weekly scheduled refresh

Call `mcp__scheduled-tasks__list_scheduled_tasks` and check if a task named **"Israel Polls Weekly Refresh"** already exists.

If it does **not** exist, call `mcp__scheduled-tasks__create_scheduled_task` with:
- `name`: `"Israel Polls Weekly Refresh"`
- `cronExpression`: `"0 8 * * 1"` (every Monday at 08:00)
- `prompt`: `"Run the israel-polls-refresh skill to fetch any new Israel 2026 Knesset election polls from Wikipedia and update the israel-2026-election-polls artifact."`

If it already exists, skip this step.

### 3. Confirm to the user

Tell the user:
- The dashboard is now in their artifacts sidebar.
- It auto-refreshes with new polls every Monday morning at 08:00.
- They can also say "refresh Israel polls" any time to trigger an immediate update.

## Fallback (no artifact support)

If artifact tools are unavailable (e.g., Claude Code rather than Cowork), copy `assets/dashboard.html` to the user's working directory as `israel_2026_polls_dashboard.html` and tell them to open it in a browser. The scheduled refresh won't work outside Cowork; they can run the `israel-polls-refresh` skill manually to get a fresh copy.

## Dashboard features (for answering user questions)

- Right panel "לפי מפלגה": seat-average/median table with leader photos and per-party coalition/opposition/other assignment buttons, plus a party trend chart.
- Left panel "לפי גוש": TV-style half-donut (coalition red, opposition blue, 61-seat majority marker) plus a bloc trend chart.
- Controls: dual-handle date-range slider and a media-outlet multi-select dropdown at the top.
- Data: Wikipedia is the single source of truth. Parties below the 3.25% electoral threshold count as 0 seats.
- The header badge shows the date of the most recently baked poll and updates to "רענון הצליח — N סקרים חדשים" after a successful scheduled refresh.
