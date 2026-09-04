# stacki-lumos-slicing

An agent skill for slicing a Figma design into a [Lumos for Astro](https://github.com/timothyricks) page **in one pass** — layout, styling, sizing, spacing, animation and functionality finished together per section, each proved by an instrument rather than by a claim.

It exists because of one pattern, found the expensive way on a 13-section slice: **the source reads correctly.** A slider can be initialised, carry the right card width and the right pitch, and not move for a finger. A bar can retract by exactly the token that says `40` and leave 3.6px of itself on screen. A page can clip sideways overflow on `body` and scroll sideways anyway. None of that shows up in a review; all of it shows up in a measurement.

So the rule the skill is built around is:

> A domain is done when an instrument says so. Nothing is done because the source reads correctly.

## What is in here

| File                   | What it is                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `SKILL.md`             | the workflow: order of operations, the six domains and their proofs, non-negotiables, how to divide the work across agents, the report format |
| `reference/lessons.md` | the catalogue: every fault that produced a wrong page from correct-looking source, as symptom → cause → fix, with the number that revealed it |
| `probe.mjs`            | the behaviour instrument — real touch gestures, a sideways-overflow sweep, and arbitrary page reads at a given viewport                       |

## Install

Drop the folder into a project's skills directory:

```bash
git clone https://github.com/myuzara02/stacki-lumos-slicing \
  .claude/skills/stacki-lumos-slicing
```

In Claude Code it then loads on its own, or with `/stacki-lumos-slicing`. Any other assistant can be pointed at `SKILL.md` directly — the workflow is plain markdown and the script is plain Node.

Then add a line to the project's `AGENTS.md` / `CLAUDE.md` skills list so it is discoverable in a fresh session.

## Requirements

- **Node 22+** — `probe.mjs` uses the global `WebSocket` and `fetch`, and has **no dependencies**.
- **Chrome, Chromium or Edge** installed. The script drives a headless instance over CDP.
- A **dev server running** on `http://localhost:4321` (override with `LUMOS_BASE`).
- The bundled Lumos skills, which this one orchestrates rather than duplicates: `lumos-import-figma` (measurements → tokens, `convert.mjs`) and `lumos-import-figma` (measurements → tokens, `convert.mjs`), which ships with every Lumos for Astro scaffold. The overlay does not ship with the scaffold, so `overlay-figma.mjs` lives here and the skill works in a bare project.

## probe.mjs

```bash
# Can the page be scrolled sideways at any width, and if so, who is sticking out?
node probe.mjs overflow --widths 1440,1024,834,768,375

# Drive a real finger across a row, sampled WHILE the finger is down
node probe.mjs drag --selector "#reviews" --width 375

# Read anything out of the page at a given viewport
node probe.mjs eval --width 1440 --expr 'async () => ({ w: innerWidth })'
node probe.mjs eval --width 375 --file read-header.js
```

`drag` is the one worth explaining. It measures **the page** — where the first item starts, where the last one ends — and not the slider library's own numbers, because the two worst bugs it was written for were both the library being confident and wrong. It fails on five separate faults, each one shipped for real:

- the row does not move for a touch at all (missing `touch-action: pan-y`)
- dragging past the end opens a strip of empty section (rubber-band; `resistanceRatio: 0`, **not** `resistance: false`, which removes the damping instead of the travel)
- the last item stops short of the edge (a CSS `gap` the library cannot see)
- dragging back does not return the row (a `transitionend` that never fires, leaving `animating` stuck)
- a vertical swipe over the row does not scroll the page

Both instruments exit non-zero while the page is wrong, so both can gate a loop. `node probe.mjs --help` prints its options.

## Improving it

A lesson is a **symptom, a cause, a fix, and a number** — a lesson without a number is a feeling and the next reader will skip it. And if an instrument could have caught the fault, teach the instrument: notes catch a fault once, a tool catches it every time. Every check in `probe.mjs` is there because a real bug got past a source review first.
