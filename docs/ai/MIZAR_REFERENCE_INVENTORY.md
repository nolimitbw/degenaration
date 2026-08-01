# Mizar reference inventory

Reviewed: 2026-08-01

These files are mandatory workflow and information-hierarchy references. Mizar names,
logos, illustrations, copy, and other proprietary assets are not implementation assets.
DegenAration retains its own black, gold, and white system, logo, icons, artwork, copy,
and code.

## Review method

- Inventoried all 49 files: 41 images, 5 silent H.264 recordings, 1 Swift frame
  extraction script, and 2 Finder metadata files.
- Opened every image at its original resolution, including every supplied contact sheet
  and all 12 current-build comparison frames.
- Read each filename as product intent, not just file metadata.
- Probed all recordings with `ffprobe` and decoded every frame with `ffmpeg -xerror`.
  All five full-frame decodes passed.
- Reviewed the supplied one-second contact sheets across the complete duration of every
  recording. The long Discord and KOL recordings have 6 and 12 sheets respectively.
- Temporary review tooling used `ffmpeg-static@5.3.0` and
  `ffprobe-static@3.1.0` under `/private/tmp/degen-ref-tools`. No project dependency or
  lockfile was changed.

## Source recordings

| ID | File | Dimensions | Duration / frames | Complete review | Product scope |
| --- | --- | --- | --- | --- | --- |
| V1 | `SETTINGS AND FUNCTIONS IDEA/DISCORD BOT AND KOL BOT AFFILIATE .mov` | 3584x2082 | 00:30.422 / 1,755 | PASS: 3 sheets + full decode | Rewards metrics, earnings tabs/chart, payout dialog and validation |
| V2 | `SETTINGS AND FUNCTIONS IDEA/DISCORD BOT PLAN FULL VIDEO OF VISION.mov` | 3584x2082 | 01:11.447 / 3,705 | PASS: 6 sheets + full decode | Discord marketplace, setup, TP/SL/retries/security, confirmation |
| V3 | `SETTINGS AND FUNCTIONS IDEA/FULL VIDEO OF IDEA OF FULL DESIGN AND FUNCTIONAL OF KOL BOT.mov` | 3584x2082 | 02:20.450 / 8,087 | PASS: 12 sheets + full decode | KOL trigger, presets, filters, DCA, TP/SL, execution, preview |
| V4 | `SETTINGS AND FUNCTIONS IDEA/How it looks like when its done, you can edit your setups .mov` | 3584x2082 | 00:18.463 / 1,052 | PASS: 2 sheets + full decode | Discord/KOL manager tables and persisted-config editing |
| V5 | `SETTINGS AND FUNCTIONS IDEA/PORTFOLIO FULL PLAN.mov` | 3584x2082 | 00:15.388 / 882 | PASS: 2 sheets + full decode | Portfolio metrics, chart tooltip, tabs, empty/deposit/bridge states |

All recordings are silent. Frame numbers are container-reported totals.

## Primary images

| ID | File | Dimensions | Purpose observed |
| --- | --- | --- | --- |
| I1 | `PNL CARDS/WINNING PNL CARD DESIGN (MAKE SURE YOU WILL MAKE YOUR OWN DESIGN USE CHAT GPT CODEX OKAY? PUT OUR DEGENARATION LOGO MUCH BETTER.jpeg` | 576x324 | Winning position share hierarchy: signed PnL, token, duration, identity, QR/link |
| I2 | `PNL CARDS/LOSING PNL CARD DESIGN (MAKE SURE YOU WILL MAKE YOUR OWN DESIGN USE CHAT GPT CODEX OKAY? PUT OUR DEGENARATION LOGO MUCH BETTER.jpeg.jpeg` | 597x335 | Losing position hierarchy with restrained loss language |
| I3 | `PNL CARDS/PORTFOLIO PNL CARD DESIGN (MAKE SURE YOU WILL MAKE YOUR OWN DESIGN USE CHAT GPT CODEX OKAY? PUT OUR DEGENARATION LOGO MUCH BETTER.jpeg` | 1082x468 | Portfolio PnL, entry/current values, partner/referral identity |
| I4 | `SETTINGS AND FUNCTIONS IDEA/explanation on KOL BOT.png` | 1652x1738 | Price-drop entry and rebound-exit strategy explanation |

The third-party mascots, wordmarks, exchange marks, scenic art, and palettes in I1-I3 are
explicitly excluded. Only their communication purpose and content hierarchy apply.

## Extracted contact sheets

Every file below is 2700x2228 and was opened at original resolution.

| Workflow | Files and covered timestamps |
| --- | --- |
| Affiliate | `affiliate/sheet-01-0000.00-0011.00.jpg`; `sheet-02-0012.00-0023.00.jpg`; `sheet-03-0024.00-0030.00.jpg` |
| Discord | `discord/sheet-01-0000.00-0011.00.jpg`; `sheet-02-0012.00-0023.00.jpg`; `sheet-03-0024.00-0035.00.jpg`; `sheet-04-0036.00-0047.00.jpg`; `sheet-05-0048.00-0059.00.jpg`; `sheet-06-0060.00-0071.00.jpg` |
| KOL | `kol/sheet-01-0000.00-0011.00.jpg`; `sheet-02-0012.00-0023.00.jpg`; `sheet-03-0024.00-0035.00.jpg`; `sheet-04-0036.00-0047.00.jpg`; `sheet-05-0048.00-0059.00.jpg`; `sheet-06-0060.00-0071.00.jpg`; `sheet-07-0072.00-0083.00.jpg`; `sheet-08-0084.00-0095.00.jpg`; `sheet-09-0096.00-0107.00.jpg`; `sheet-10-0108.00-0119.00.jpg`; `sheet-11-0120.00-0131.00.jpg`; `sheet-12-0132.00-0140.00.jpg` |
| Bot manager | `manager/sheet-01-0000.00-0011.00.jpg`; `sheet-02-0012.00-0018.00.jpg` |
| Portfolio | `portfolio/sheet-01-0000.00-0011.00.jpg`; `sheet-02-0012.00-0015.00.jpg` |

All paths above are relative to
`.references/SETTINGS AND FUNCTIONS IDEA/extracted-frames/`.

## Current-build comparison set

The following 12 1600x928 images were all opened at full resolution. They cover the
owner's signed-in production walkthrough from 00:02.6 to 00:59.0.

| File | Visible state |
| --- | --- |
| `frame-01-0002.6s.jpg` | Bots overview and focused product navigation |
| `frame-02-0007.7s.jpg` | Discord marketplace loading skeleton |
| `frame-03-0012.8s.jpg` | Approved Discord source cards and truthful empty metrics |
| `frame-04-0018.0s.jpg` | Marketplace filter focus and compact density |
| `frame-05-0023.1s.jpg` | Builder source-load failure state from the older deployment |
| `frame-06-0028.2s.jpg` | Funding/exposure, sticky capital summary, release gate |
| `frame-07-0033.3s.jpg` | Multiple TP levels and advanced security entry point |
| `frame-08-0038.5s.jpg` | Source-loaded builder state |
| `frame-09-0043.6s.jpg` | Discord/KOL-separated bot manager empty state |
| `frame-10-0048.7s.jpg` | Affiliate earnings dashboard and referral link |
| `frame-11-0053.9s.jpg` | Portfolio performance empty state and statistics |
| `frame-12-0059.0s.jpg` | Portfolio header actions and account state |

The folder also contains `extract.swift`, which was read completely. It samples 12
evenly spaced AVFoundation frames and preserves aspect orientation. Even sampling is
discovery evidence, not proof that intermediate interactions are identical.

## Non-product files

| File | Inspection result |
| --- | --- |
| `SETTINGS AND FUNCTIONS IDEA/.DS_Store` | Apple Desktop Services metadata; no product screen |
| `SETTINGS AND FUNCTIONS IDEA/extracted-frames/.DS_Store` | Apple Desktop Services metadata; no product screen |

This accounts for every file under both mandatory reference folders.
