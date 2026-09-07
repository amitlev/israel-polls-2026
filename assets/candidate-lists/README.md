# Candidate lists — hand-editing workspace

The dashboard tracks parties; this folder tracks the people on each party's list for the
26th Knesset, so a seat count can be read as "who actually gets in".

```
lists/<Party_id>.json           the transcribed list                 (committed)
sources/<Party_id>.<ext>        the party-published list graphic     (committed)
portraits/<Party_id>/NN.jpg     one portrait per rank, NN = rank     (committed)
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
- **`nameOnGraphic`** appears only where the party's graphic and the party's website
  disagree about someone's name — "מיכל נגרי" against "מיכל הירש נגרי", "יעל לין שטרן"
  against "יעל שטרן". The site wins, because it is the copy the party maintains; the
  graphic's spelling is kept beside it rather than thrown away, since neither source is
  reliably the fuller one.
- **`mk`** is the parliamentary status: `"current"` where the graphic printed **ח"כ**,
  `"former"` where it printed **חכ"ל** (ח"כ לשעבר), `null` otherwise. It records what the
  party's own graphic claimed — it is not checked against the Knesset roster. The one
  deliberate exception is the party leader, whom the graphic leaves unmarked because the
  header already names them.
- **`title`** is the professional or military title and *only* that — `ד"ר`, `עו"ד`,
  `אל"מ במיל'`, `סרן במיל'`. Never ח"כ or חכ"ל; those are `mk`, and carrying them in both
  places would let the two disagree.
- **`photoKey`** is optional, and set only for someone who already has a baked leader head
  in `assets/leader-heads/cutouts/`, so the two never diverge.
- **`verify`** marks a field that could not be read confidently off the source graphic.
  It is a note to a human, not something the dashboard reads — clear it once checked.

## The portraits

`npm run build:candidates` writes 192px squares named by rank. `-- --preview` writes a
contact sheet to `.leaderheads/candidates/` instead of files, which is the loop for tuning.

**Two sources, and they are good at different things.** The list graphic has *everyone* on
it, already framed the way the party wants them framed — but at whatever size the designer
exported, often around 130px a head. The party's website has the original studio
photograph at full camera resolution — but in a loose landscape frame that has to be
cropped, and it does not always carry the whole list.

So the bake takes both: **the framing from the graphic, the pixels from the website.** For a
party listed in `SITES`, each card in the graphic is located inside the corresponding
original by normalised cross-correlation, and the winning crop — the one the party's own
designer chose — is lifted onto the full-resolution file. A match below 0.55, or a rank the
site doesn't have, falls back to the graphic crop; the run prints which ranks those were and
`SOURCES.json` records it per portrait. For Together that is rank 32, who is on the graphic
and has no card on the site at all.

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
