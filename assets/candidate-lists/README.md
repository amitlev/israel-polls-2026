# Candidate lists — hand-editing workspace

The dashboard tracks parties; this folder tracks the people on each party's list for the
26th Knesset, so a seat count can be read as "who actually gets in".

```
lists/<Party_id>.json              the list                          (committed)
overrides/<Party_id>/<key>.jpg     a hand-picked photo, beats the    (committed)
                                   graphic and the site
sources/<Party_id>.<ext>           the party-published list graphic, (committed)
                                   where the party published one
portraits/<Party_id>/NN.jpg        one portrait per rank             (committed)
portraits/<Party_id>/uNN.jpg       one per candidate with no rank    (committed)
portraits/<Party_id>/SOURCES.json  where each portrait came from     (generated)
```

## File names

`<Party_id>` is the `id` from `PARTIES` in `docs/index.html` with every non-alphanumeric
character replaced by `_` — the same `slug()` the leader-head and party-logo bakes use.
It is the join key, so it has to match exactly. In full, for this cycle:

| File name | Party |
|---|---|
| `Likud` | הליכוד |
| `Religious_Zionism` | הציונות הדתית |
| `Otzma_Yehudit` | עוצמה יהודית |
| `Shas` | ש"ס |
| `UTJ` | יהדות התורה |
| `National_Unity` | כחול לבן |
| `Yisrael_Beiteinu` | ישראל ביתנו |
| `The_Democrats` | הדמוקרטים |
| `Together` | יחד (בנט–לפיד) |
| `Yashar` | ישר! |
| `Joint_List` | הרשימה המשותפת |
| `Ra_am` | רע"ם — note the apostrophe becomes `_` |
| `Hadash_Ta_al` | חד"ש–תע"ל |
| `Balad` | בל"ד |
| `Reservists` | המילואימניקים |
| `Unity` | האחדות |
| `Amcha_Yisrael` | עמך ישראל |

Three ids in `PARTIES` are `active: false` — `Yesh_Atid`, `Bennett_2026`,
`Yesodot_Yisrael` — parties superseded by a later merger. They do not run a list of their
own, so they get no file here; the merged party (`Together`, `Reservists`) gets it.

**A party id not on this list is a party the dashboard does not know about yet.** Adding
its list here is not enough on its own — `PARTIES`, `ALL_KEYS` and `headerKey()` have to
learn the id first, in both `update-polls.mjs` and `docs/index.html`, or the party is
silently dropped from every poll. See the "New-party detection" note in the root README.

## The list file

```jsonc
{
  "party":     "Yisrael Beiteinu",   // PARTIES id — the join key
  "partyName": "ישראל ביתנו",
  "knesset":   26,
  "source":    { /* where the list came from, and under what licence */ },
  "candidates": [
    { "rank": 1, "name": "אביגדור ליברמן", "title": null, "mk": "current" }
  ]
}
```

- **`name` carries no honorific and no rank.** Everything a party prints in front of the
  name goes in one of the other two fields, so the name stays searchable and the UI gets
  to decide what to show.
- **`nameOnGraphic`** / **`nameInPress`** carry the spelling from the source that did *not*
  win, named after that source, so nothing is thrown away when two sources disagree. The
  website beat the graphic for Together; the graphic beat the press for Otzma Yehudit,
  which spelled דורפמן as דרופמן and גולדברג as גולדברגר. `nameOnGraphic` appears only where
  the party's graphic and the party's website disagree about someone's name — "מיכל נגרי" against "מיכל הירש נגרי", "יעל לין שטרן"
  against "יעל שטרן". The site wins, because it is the copy the party maintains; the
  graphic's spelling is kept beside it rather than thrown away, since neither source is
  reliably the fuller one.
- **`mk`** is the parliamentary status — `"current"`, `"former"` or `"none"` — and it comes
  from the Knesset's own roll, not from the party. `npm run enrich:candidates` fills it (see
  below). `null` means *not yet determined*, which is not the same as `"none"`: a null must
  never be grouped in with genuinely new candidates.
- **`gender`** is `"f"` or `"m"`, from the same script. `null` again means undetermined.
- **`nameEn`** / **`nameAr`** are the person's name as it is actually written in those
  languages, from Wikidata — not a transliteration. `null` where Wikidata has no entry,
  which is most private individuals; those stay Hebrew on screen. See below.
- **`title`** is the professional or military title and *only* that — `ד"ר`, `עו"ד`,
  `אל"מ במיל'`, `סרן במיל'`. Never ח"כ or חכ"ל; those are `mk`, and carrying them in both
  places would let the two disagree.
- **`photoKey`** is optional, and set only for someone who already has a baked leader head
  in `assets/leader-heads/cutouts/`, so the two never diverge.
- **`verify`** marks a field that could not be read confidently off the source, or that
  looks wrong in the source itself — The Democrats' site prints "יאיא פינק" where its own
  photo filename says יאיר. It is a note to a human, not something the dashboard reads;
  clear it once checked.
- **`unranked`** is a second array, beside `candidates`, for people who are demonstrably on
  a list without the party having published where. The Democrats' site numbers only its top
  20; the other 31 have a photo and a name and no position, so they are kept here rather
  than given an invented one. It is sorted alphabetically — **that ordering is not the list
  order and must never be shown as one** — and each entry's `photo` names its portrait
  (`u07` → `portraits/The_Democrats/u07.jpg`), which is what keeps the file numbering stable
  when a name is added and the alphabetical positions shift.

## `mk` and `gender`

`npm run enrich:candidates` fills both from the Knesset's OData service
(`KNS_Person` + `KNS_PersonToPosition`, ~1,200 people and ~8,000 terms, cached under
`.leaderheads/knesset/`). Report-only by default; `-- --write` applies it.

Four things it knows that are easy to get wrong:

- **`KNS_Position` is gendered.** 43 is "חבר הכנסת" and 61 is "חברת הכנסת". Filtering on 43
  alone silently drops every woman in the Knesset's history — it read Naama Lazimi, Efrat
  Rayten and Shelly Tal Meron as having never served.
- **`IsCurrent`, not "has a term in the 25th".** A term row records that someone served, not
  that they still do. Dan Illouz's 25th-Knesset term ended on 2026-08-13, so the naive rule
  called him a sitting MK where Yisrael Beiteinu's own graphic correctly says former.
- **An exact name match is not proof of identity.** The roll holds one דוד אזולאי — the Shas
  MK, who died in 2018 — and Yisrael Beiteinu's 13th candidate matched him perfectly. No
  string matching catches that, so every current/former call is printed on each run and the
  `RESOLVED` table records the ones a human has ruled on.
- **A given name is not evidence of gender.** The roll answers for anyone who has served;
  for everyone else there is a `NAME_GENDER` table of names that are unambiguous in Hebrew,
  and a per-person `GENDER` table for the ones that are not. This list already carries a
  שרון who is a man and a שרון who is a woman, and an אוליביה of each — the second being
  Olivier rather than Olivia. Check them against the faces: `npm run build:candidates --
  --preview` tints every label by its recorded gender and marks ותק with ● / ○.

Where the roll disagrees with what the party's graphic printed, both are reported and
neither wins automatically. That is how Yair Golan's entry got fixed: Meretz missed the
threshold in 2022, so he is a *former* MK and the hand-entered "current" was wrong.

## `nameEn` and `nameAr`

`npm run enrich:names` fills both from Wikidata, which carries he/en/ar labels for public
figures maintained by people who know how the name is really written. That is not the same
thing as a transliteration, which is why no transliterator is used here: half the value is
that "Fleur Hassan-Nahoum" is not what any scheme would produce from פלר חסן-נחום. The
Knesset's own OData service is Hebrew-only and cannot help.

Matching is narrow on purpose: an item is accepted only if its **Hebrew** label matches the
name we hold and it is an instance of human (Q5). A near-match is refused, because "אלי כהן"
would otherwise resolve to whichever Eli Cohen has the better-optimised item, and a wrong
name on a face is worse than a Hebrew one.

Two things it cannot do on its own:

- **Hebrew spells names several ways.** The comparison flattens what is orthographic rather
  than personal — geresh, hyphens, ווליד against ואליד — but that only helps when the search
  returned the item at all. When Wikidata's Hebrew index does not reach a person there is no
  label left to compare, and only an id helps. That is what the `WIKIDATA` table is for; all
  three entries in it are Ra'am's Arab MKs, who are on Wikidata with full he/en/ar labels
  under Hebrew spellings the Israeli press does not use.
- **This matters most exactly where coverage is worst.** For an Arab candidate the Arabic
  name is the real one, and leaving it out shows an Arabic reader a Hebrew transliteration
  of their own name.

Coverage is far from complete and the report prints the gap rather than hiding it: of 198
candidates, 107 have an English name and 47 Arabic. The rest are private individuals whose
name has never been written in either language anywhere, and they stay Hebrew — which is
honest, and is what the source actually holds.

The same pass records Wikidata's portrait (P18) for anyone who has one — 93 of them, listed
in `.leaderheads/knesset/wikidata-portraits.txt`. Nothing consumes those yet.

## The editor

`npm run edit:candidates`, then <http://127.0.0.1:8760>. Every field on every candidate —
the three names, gender, ותק, the photo — with a party filter, a search box, and a "רק
חסרים" toggle for the gaps. It binds to localhost only: it writes to the working tree and
can start a build, so it has no business being reachable from anywhere else.

It edits **these files**, not a database of its own: fields go back into `lists/*.json` and
a photo into `overrides/`, so every change shows up in `git diff` and is reviewed like any
other commit. Field order and everything the editor does not touch are preserved, so a diff
shows the one line that changed.

A photo can come from a file, a pasted URL, or — where the candidate is a public figure —
Wikidata's own portrait, offered as a button. Drag the square to frame it. It is written to
`overrides/<Party_id>/<key>.jpg`, which **beats the graphic and the site and survives a
rebuild**; that is the same contract `assets/leader-heads/cutouts/` has, and without it the
next bake would simply overwrite the choice.

**The bake never deletes a portrait it did not make.** It used to clean the party's folder
and regenerate, which is fine until a live third-party page changes: The Democrats stopped
server-rendering the grid holding 31 of their candidates, and one run silently destroyed 31
committed portraits. Anything with no source in a given run is now reported and left alone,
and removing one is a deliberate `git rm`.

## Site readers

`PARTIES[…].site.parse` picks how a party's page is read, and each reader is written against
one site's markup:

- **`filename-rank`** — the photo's filename starts with the rank (`12-רם-בן-ברק-1536x1024.jpg`).
  The size suffix is stripped to reach the original upload.
- **`jet-listing`** — a JetEngine/Elementor listing, one `.jet-listing-grid__item` per
  candidate with a `data-post-id`, an `<img>`, a heading widget holding the rank and text
  widgets holding title and name. The page renders every candidate twice in two layouts, so
  items are folded on `data-post-id` and a rank found in either copy wins.

When a party rebuilds its site these need a new reader, not a patch. Note also that sites mix
Hebrew gershayim (`עו״ד`) with ASCII quotes (`עו"ד`) freely; both are normalised on the way
in, because a title regex that misses one leaves the title glued to the front of the name,
where it silently breaks the alphabetical ordering too.

## The portraits

`npm run build:candidates` writes 192px squares named by rank. `-- --preview` writes a
contact sheet to `.leaderheads/candidates/` instead of files, which is the loop for tuning.

**Two sources, and they are good at different things.** The list graphic has *everyone* on
it, already framed the way the party wants them framed — but at whatever size the designer
exported, often around 130px a head. The party's website has the original photograph, often
at full camera resolution — but not always the whole list, and not always cropped to a face.

So a party in `PARTIES` has a graphic, a site, or both, and the bake takes what it can:

| Has | What happens |
| --- | --- |
| graphic only | each card is cut out of the grid — Yisrael Beiteinu |
| site only | the site's photo is used; a square one is already framed, anything else is centre-cropped — The Democrats |
| both | **the framing from the graphic, the pixels from the site** — Together |

That third case is the good one. Each card in the graphic is located inside the
corresponding original by normalised cross-correlation, and the winning crop — the one the
party's own designer chose — is lifted onto the full-resolution file. A match below 0.55, or
a rank the site doesn't have, falls back to the graphic crop; the run prints which ranks
those were and `SOURCES.json` records it per portrait. For Together that is rank 32, who is
on the graphic and has no card on the site at all.

Each run also writes `.leaderheads/candidates/<Party_id>_manifest.json` — what the site said
before any hand-curation. That is what a `lists/` file is built from, and what to diff a site
against when it changes.

**Measure the grid, don't eyeball it.** A card's name plate is a solid band the full width of
the card, so it hands you the whole layout: its x-spans are the columns, its top gives the
row pitch, and the photo area is the gap up to the card above. Eyeballed numbers drift a few
pixels per row, and by the bottom row the plate is inside the crop. Where the plate is not
white (Together's is navy) find the grid by whatever *is* uniform — there, the orange rank
badge, one saturated blob per card, which also confirms the count.

They are **JPEG, not PNG** — photographs with no transparency, where a PNG runs about four
times the bytes. Note that `@napi-rs/canvas` takes JPEG quality as a **percentage, 0-100**,
not the 0-1 the browser `toDataURL` API uses. Passing `0.85` is quality *one*, and it does
not throw; it just quietly returns a 1KB smear.

**A source is a resolution ceiling.** Cards in Yisrael Beiteinu's graphic are 154px across
and no site was used, so that is what those portraits are — `OUT` is a cap, never an upscale,
and the bake prints which ranks came out under it. Sharper portraits need a better source,
not a bigger `OUT`.

Originals downloaded from a party site are cached under `.leaderheads/candidates/` and are
gitignored — they run to hundreds of megabytes and nothing needs them after the bake.
`-- --refetch` ignores the cache.

## Licensing

A party's list graphic is campaign material, not a free file. Every `source` block records
its own `licence`, the way `build-party-logos.mjs` does for logos — several are non-free
marks used to identify the party they belong to, and that is a publishing decision worth
recording rather than flattening into "from the party".
