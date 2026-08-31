# Leader heads — hand-editing workspace

The tug-of-war figures on the dashboard wear a cut-out head. This folder is where those
cut-outs are made by hand.

```
originals/      full Wikipedia portraits, as downloaded          (generated, gitignored)
source-crops/   generous crops around each head — cut these      (generated, gitignored)
auto-cutouts/   what the automatic bake produces today           (generated, gitignored)
cutouts/        ← put your finished heads here                   (committed)
SOURCES.md      which Commons file each crop came from           (generated)
```

Regenerate the three generated folders any time:

```bash
npm run build:heads -- --export
```

## What to produce

One file per leader in `cutouts/`, named exactly as in `source-crops/`
(e.g. `Benjamin_Netanyahu.png` — the name is the `photoKey`, not the party).

- **PNG with a real alpha channel.** Background fully transparent. If the file has no
  transparent border at all the bake warns you — that means the background is still there.
- **Head plus a short neck stub**, and nothing else — no shoulders, no collar, no tie.
  The neck is what visually connects the head to the drawn suit, and the drawn jacket
  collar is what covers the bottom of it.
- **The neck ends at the bottom edge of the image.** Size and position are normalised on
  bake — the opaque content is scaled so its *height* fills a 192×192 square and is
  centred horizontally — so what matters is the head-to-neck proportion, not the canvas
  size. Look at `auto-cutouts/` for the proportion the layout is tuned against.
- **Face left.** Every baked head faces the same way; the dashboard mirrors one whole
  team so both sides look at the rope. (In practice most Wikipedia portraits are frontal,
  so this only matters if you source or edit a genuinely angled face.)
- Resolution: anything from ~200px tall up. It is resampled to 192px, so more is fine,
  less gets soft.

Soft, feathered alpha at the edge is good — a hard 1px cut reads as a sticker at
display size.

## Then

```bash
npm run build:heads
```

Any leader with a file in `cutouts/` uses it; everyone else falls back to the automatic
crop-and-mask. The command re-embeds all 17 heads into both HTML files and regenerates
the `.restore` chunks. Check the result with `npm run build:heads -- --preview`, which
writes a light/dark contact sheet to `.leaderheads/preview.png` without touching the HTML.

## Licensing

The originals are Wikipedia lead images from Wikimedia Commons, under their own licences;
`SOURCES.md` lists the file behind each one. Crops and cut-outs made here are derivative
works of those files, which is what the README's "Leader photos from Wikipedia/Wikimedia
Commons" credit covers.
