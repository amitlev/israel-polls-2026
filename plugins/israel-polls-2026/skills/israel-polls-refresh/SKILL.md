---
name: israel-polls-refresh
description: Fetch new Israel 2026 Knesset election polls from Wikipedia and update the live dashboard artifact. Use when the user asks to "refresh polls", "update the dashboard", "get latest polls", "סקרים חדשים", or when invoked by the weekly scheduled task.
---

# Israel Polls Refresh

Fetch any polls newer than what's currently baked into the `israel-2026-election-polls` artifact, add them, and update the artifact and GitHub repository.

## Step 1 — Find the current max baked date

Call `mcp__cowork__list_artifacts` to get the artifact path (id: `israel-2026-election-polls`).

Run this in bash to extract the most recent baked poll date:

```bash
python3 -c "
import re
html = open('ARTIFACT_PATH', encoding='utf-8').read()
stop = html.find('const WIKI_URL')
chunk = html[:stop] if stop > 0 else html[:400000]
dates = re.findall(r'\"date\":\"(\d{4}-\d{2}-\d{2})\"', chunk)
print(max(dates) if dates else '2025-12-01')
"
```

Replace `ARTIFACT_PATH` with the actual path returned by `list_artifacts`.

## Step 2 — Fetch Wikipedia (with cache-busting)

`mcp__workspace__web_fetch` caches responses by URL. Append a timestamp to force a fresh fetch every time.

**First**, generate the timestamp in bash:

```bash
python3 -c "import time; print(int(time.time()))"
```

**Then** call `mcp__workspace__web_fetch` with:
- `url`: `https://en.wikipedia.org/wiki/Opinion_polling_for_the_2026_Israeli_legislative_election?_t=TIMESTAMP`

Replace `TIMESTAMP` with the integer from bash above. Each run produces a unique URL, guaranteeing an uncached response.

The tool may save the result to a file if it's too large — read it from there if so.

## Step 3 — Parse new polls

Run this Python script in bash (substitute `MAX_DATE` and `WIKI_TEXT`):

```python
import re, json, sys

MAX_DATE = 'REPLACE_WITH_STEP1_RESULT'
WIKI_TEXT = open('REPLACE_WITH_WIKI_TEXT_FILE', encoding='utf-8').read()

MONTHS = {'Jan':1,'Feb':2,'Mar':3,'Apr':4,'May':5,'Jun':6,'Jul':7,'Aug':8,'Sep':9,'Oct':10,'Nov':11,'Dec':12}
FIRM_OUTLET = {
    'Midgam':'Channel 12 (HaHadashot 12)','Lazar':'Maariv',
    'Yossi Taktika':'Zman Israel / Times of Israel','Yossi Tatika':'Zman Israel / Times of Israel',
    'Filber':'Channel 14 (Direct Polls)','Maagar Mochot':'Channel 13',
    'Direct Polls':'i24NEWS',
}
GOV = ['Likud','Religious Zionism','Otzma Yehudit','Shas','UTJ']
LAYOUTS = [
    {'sample':True,  'cols':['Likud','Together','Religious Zionism','Otzma Yehudit','National Unity','Shas','UTJ','Yisrael Beiteinu',"Ra'am","Hadash-Ta'al",'Balad','The Democrats','Yashar','Yesodot Yisrael']},
    {'sample':False, 'cols':['Likud','Yesh Atid','Religious Zionism','Otzma Yehudit','National Unity','Shas','UTJ','Yisrael Beiteinu',"Ra'am","Hadash-Ta'al",'Balad','The Democrats','Bennett 2026','Yashar','Reservists']},
]
ALL_COLS = ['Likud','Religious Zionism','Otzma Yehudit','Shas','UTJ','Yesh Atid','National Unity','Yisrael Beiteinu',
            'The Democrats','Bennett 2026','Together','Yashar','Yesodot Yisrael',"Joint List","Ra'am","Hadash-Ta'al",'Balad','Reservists']

def conv(v):
    v = v.strip()
    if re.fullmatch(r'\d+', v): return int(v)
    if re.fullmatch(r'\([\d.]+%\)', v): return 0
    return None

def parse_date(s):
    s = re.sub(r'[–—]', '-', s).strip()
    parts = s.split('-'); last = parts[-1].strip()
    m = re.match(r'(\d{1,2})\s+([A-Za-z]+)', last)
    if m: day, mon = int(m.group(1)), MONTHS.get(m.group(2)[:3])
    else:
        m2 = re.match(r'^(\d{1,2})$', last)
        m3 = re.search(r'([A-Za-z]+)', parts[0])
        if not m2 or not m3: return None
        day, mon = int(m2.group(1)), MONTHS.get(m3.group(1)[:3])
    if not mon or not day or day > 31: return None
    return f'{2025 if mon==12 else 2026}-{mon:02d}-{day:02d}'

results = []
seen = set()
for line in WIKI_TEXT.split('\n'):
    fields = [f.strip() for f in line.split(';')]
    if not (14 <= len(fields) <= 22): continue
    ci = fields[0].find(':')
    if ci < 0: continue
    date_part = fields[0][:ci].strip(); firm = fields[0][ci+1:].strip()
    if not re.match(r'^\d', date_part) or not firm or firm == 'TBA': continue
    iso = parse_date(date_part)
    if not iso or iso <= MAX_DATE: continue
    key = iso + '|' + firm
    if key in seen: continue
    pub = fields[1]
    for layout in LAYOUTS:
        start = 3 if layout['sample'] else 2
        vals = [conv(f) for f in fields[start:]]
        if len(vals) < len(layout['cols']): continue
        rec = {c: None for c in ALL_COLS}
        rec.update({'date':iso,'pollster':firm,'outlet':FIRM_OUTLET.get(firm,pub)})
        for i,c in enumerate(layout['cols']): rec[c] = vals[i]
        gov = sum(rec.get(p,0) or 0 for p in GOV)
        tail = vals[len(layout['cols']):]
        gv = next((t for t in tail if t is not None and abs(t-gov)<=1), None)
        total = sum(rec.get(c,0) or 0 for c in layout['cols'])
        if gv is not None and 95 <= total <= 122:
            rec['_govTotal'] = gv; seen.add(key); results.append(rec); break

print(json.dumps(results, ensure_ascii=False))
```

Save the output (a JSON array of new poll objects).

## Step 4 — Update the artifact

If the JSON array from step 3 is **empty**: report "אין סקרים חדשים — הנתונים עדכניים" and stop.

If there are new polls:

1. Read the artifact HTML (from the path found in step 1).
2. Locate the `BASE_POLLS = [` line. Find the closing `];` that ends the array.
3. Convert each new poll object to a JSON object literal and **append** them just before the closing `];` (BASE_POLLS is sorted oldest-first, Wikipedia gives newest-first so reverse them before inserting).
4. Write the updated HTML to a temp file in the outputs directory. **Keep the full updated HTML string in memory — needed for step 5.**
5. Call `mcp__cowork__update_artifact`:
   - `id`: `israel-2026-election-polls`
   - `html_path`: the temp file path
   - `update_summary`: `"רענון — N סקרים חדשים"` (replace N)
   - `mcp_tools`: `[]`

## Step 5 — Push to GitHub

Call `mcp__github__push_files` with:
- `owner`: `amitlev`
- `repo`: `israel-polls-2026`
- `branch`: `main`
- `message`: `"רענון אוטומטי — N סקרים חדשים (YYYY-MM-DD)"` (replace N and date)
- `files`: one entry:
  - `path`: `plugins/israel-polls-2026/skills/israel-polls-dashboard/assets/dashboard.html`
  - `content`: the full updated HTML string already in memory from step 4 — do **not** re-read the file

## Step 6 — Report

Report: `"רענון הצליח — N סקרים חדשים נוספו ✓ GitHub עודכן"`
