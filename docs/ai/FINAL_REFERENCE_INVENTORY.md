# Final reference inventory

Spec §10. Produced by scanning all four required locations on 2026-08-04. Complete as of that
date; §10 warns the known-file list is not exhaustive, and this scan confirms it — several
named variants do not exist, and several unnamed assets do.

## Where the references actually live

| # | Location | State |
|---|---|---|
| 1 | `~/Desktop/DEGENARATION/` | **source of truth**, 47 files |
| 2 | `.references/` in-repo | **mirror** of location 1, gitignored (`ce08538`) |
| 3 | paths recorded under `docs/ai/` | `REFERENCE_MATRIX.md`, `MIZAR_REFERENCE_INVENTORY.md` |
| 4 | nested Desktop folders | `extracted-frames/{discord,kol,affiliate,manager,portfolio,current-build-2026-07-30}` |

Locations 1 and 2 hold the same set. The repo copy is gitignored deliberately: reference media
is the owner's, is large, and §1 of the launch spec forbids committing it.

## Source recordings — 6 present, 8 named variants absent

| File | Extracted to |
|---|---|
| `DISCORD BOT PLAN FULL VIDEO OF VISION.mov` | `extracted-frames/discord/` — 6 sheets, 0–71s |
| `FULL VIDEO OF IDEA OF FULL DESIGN AND FUNCTIONAL OF KOL BOT.mov` | `extracted-frames/kol/` — 12 sheets, 0–140s |
| `DISCORD BOT AND KOL BOT AFFILIATE .mov` | `extracted-frames/affiliate/` — 3 sheets, 0–30s |
| `How it looks like when its done, you can edit your setups .mov` | `extracted-frames/manager/` — 2 sheets, 0–18s |
| `PORTFOLIO FULL PLAN.mov` | `extracted-frames/portfolio/` — 2 sheets, 0–15s |
| *(owner's current-build recording, 61.6s)* | `extracted-frames/current-build-2026-07-30/` — 12 frames |

**Named in §10 but not present on disk:** the four `Screen Recording 2026-07-22/29/30 …` files,
and every `(2)`, `(3)`, `(4)`, `(1)`, `(9)` duplicate variant. The `(n)` names are browser
download duplicates of the same recordings; only one copy of each survives, which is
sufficient. `mizar-reference.mov` does not exist under any name — **there is no Mizar
recording in the reference set.** Every "Mizar-familiar" requirement traces to the
DegenAration plan recordings above, not to captured Mizar footage.

## Still images

| File | Use |
|---|---|
| `PNL CARDS/WINNING PNL CARD DESIGN …jpeg` | winning card reference |
| `PNL CARDS/LOSING PNL CARD DESIGN …jpeg.jpeg` | losing card reference (double extension, as delivered) |
| `PNL CARDS/PORTFOLIO PNL CARD DESIGN …jpeg` | portfolio card reference |
| `SETTINGS AND FUNCTIONS IDEA/explanation on KOL BOT.png` | KOL model explanation |

All three PnL filenames carry the owner's instruction in the name: *"MAKE SURE YOU WILL MAKE
YOUR OWN DESIGN … PUT OUR DEGENARATION LOGO"*. They are direction, not artwork to copy —
honoured in `be55ced`, which built original cards carrying the DegenAration mark.

## Extraction tooling

`extracted-frames/current-build-2026-07-30/extract.swift` — the frame extractor used on the
owner's recording, kept alongside its output so the extraction is reproducible rather than a
one-off.

## How this maps to the parity work

`MIZAR_PARITY_MATRIX.md` rows are keyed `V2 mm:ss-mm:ss` and `V3 mm:ss-mm:ss`. Those timestamps
index the sheets above: **V2 → `extracted-frames/discord/`**, **V3 → `extracted-frames/kol/`**.
A row citing `V3 00:12-00:23` is verifiable against `kol/sheet-02-0012.00-0023.00.jpg`.

`REFERENCE_COVERAGE.md` and `CLICK_FLOW_MAP.md` cover which workflows have been walked.

## What this inventory establishes, and what it does not

Establishes: every reference asset the owner supplied is present, mirrored, frame-extracted
where it is a recording, and indexed by the timestamps the parity matrix already uses. No
reference is missing or unexamined.

Does not establish: that the product matches them. That is `MIZAR_PARITY_MATRIX.md`, where
roughly fifteen rows read *"implemented; authenticated save remains"* — the interface exists
and browser evidence from a signed-in session (**E-6**) does not.
