---
name: degenaration-mizar-parity
description: Rules for making a DegenAration screen immediately familiar to a former Mizar user without copying Mizar. Use when changing any user-facing page, form, dialog, table, or marketplace card.
---

# Mizar parity

The goal is recognition, not resemblance. A user who ran Mizar should know where to click here
on their first visit — while the product remains unmistakably DegenAration.

## Read before changing a screen

`docs/ai/MIZAR_PARITY_MATRIX.md` holds every reference workflow with its route, its status and
its exact remainder. `docs/ai/CLICK_FLOW_MAP.md` holds control order per screen. Both were
built from the owner's recordings. **Do not re-decode video** — decode a single frame only for
a specific detail the inventories do not answer, with `ffprobe`/`ffmpeg`, and never commit
media.

## What must match

Navigation, control placement, setup order, grouping, density, forms, tabs, dialogs,
dropdowns, tables, marketplace layout, bot manager, editing, performance display, progressive
disclosure, confirmations, and mobile behavior.

The Discord setup order is fixed and verified against the reference: identity → wallet →
server → channel → buy amount → max trades → max capital → entry → slippage → priority fee →
retry → TP levels → sell percentages → trailing TP → stop loss → dynamic stop → security
filters → cooldown → capital summary → fee summary → confirmation → save → edit.

## What must never be taken

Mizar's name, trademark, logo, proprietary copy, source, illustrations, branded artwork or
protected assets. Familiar *workflow* is the objective; borrowed *material* is not.

## What stays DegenAration

The name, the logo, black / gold / white, the original icon set and product glyphs, and the
original implementation.

## Evidence

A parity row moves to PASS only with working UI, validation, persistence, authorization,
observable failure behavior, correct calculation, and browser evidence at 390, 768, 1024 and
1440 under `docs/ai/evidence/`. Source inspection is never PASS.

## Prohibited

Emoji icons. Random gradients. Meaningless polygons. Fake Discord cover art. Decorative `D/A`
initials. Giant empty cards. Excessive uppercase. Walls of technical copy. Fake glassmorphism.
Mixed icon sets. Any control that does not persist, or that is disabled without a truthful
reason on screen.
