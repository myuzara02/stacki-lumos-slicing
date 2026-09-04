---
name: stacki-lumos-slicing
description: Slice a Figma design into a Lumos for Astro page in ONE pass — layout, styling, sizing, spacing, animation and functionality together — with each of the six proved by an instrument rather than by reading the source. Use when a Figma node has to become a working page, when a slice is "close but off", when a page looks right but a drag, a sticky bar, a scrub or a form misbehaves, or when planning how to divide a slice across agents.
---

# Slicing a design in one shot

Two skills sit under this one and are not repeated here:

| Skill                  | Owns                                     |
| ---------------------- | ---------------------------------------- |
| `figma-design-to-code` | how to talk to the Figma MCP             |
| `lumos-import-figma`   | measurements → tokens, and `convert.mjs` |

`lumos-import-figma` ships with every Lumos for Astro scaffold. The overlay
does **not** — so this skill carries its own `overlay-figma.mjs` and works in a
bare project. Where a project also has a `lumos-slice-figma` folder, that copy
is the older one: run the scripts next to this file, and read that `SKILL.md`
only for its long-form argument about what 1:1 can and cannot mean.

This one owns what none of them do: **finishing a section in all six domains at
once, and proving each one with a tool instead of a claim.** Read
[reference/lessons.md](reference/lessons.md) before the first edit — it is the
catalogue of faults that produced a wrong page from correct-looking source on
the slice this skill was written from, with the numbers each cost.

## The rule that outranks the rest

**A domain is done when an instrument says so. Nothing is done because the
source reads correctly.**

Every serious fault on that slice passed a source review and a programmatic
check before real input found it: a slider that was `swiper-initialized` with
the right card width and pitch, and did not move for a finger. An announcement
bar whose token said 40 and whose box was 43.6. A page whose `body` clipped
sideways overflow and whose `html` scrolled it anyway.

Seven domains, seven proofs. Nothing here is optional, and none of it is "a
later pass":

| Domain                           | Proof                                                                                            | Command                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Layout, styling, sizing, spacing | overlay against the frame, at **every** exported width                                           | `overlay-figma.mjs --ref … --selector … --width …`                                |
| Animation                        | scrubbed things at their **start and end** states, plus the layout still landing under reduction | `overlay-figma.mjs … --reduce`, then `probe.mjs eval` at sampled scroll positions |
| Functionality — pointer/touch    | a **real gesture**, sampled while the finger is down                                             | `probe.mjs drag --selector …`                                                     |
| Functionality — state            | the state read out of the page at each state, both widths                                        | `probe.mjs eval --expr …`                                                         |
| Page integrity                   | no sideways scroll at any width                                                                  | `probe.mjs overflow`                                                              |
| Types and build                  | the project's own gates                                                                          | `npx astro check`, `npx astro build`                                              |
| Proportion at the widths the file never drew | every crop window holds its ratio, both ends of a scroll row match, no photo owns the screen, every control is thumb-sized | `probe.mjs proportions` |

**Both scripts live next to this file**, so resolve them against this skill's
own directory, never against the project — the skill is normally installed once
at user level and shared by every project:

```bash
SKILL=~/.claude/skills/stacki-lumos-slicing   # or .claude/skills/… if vendored

# looks right
node $SKILL/overlay-figma.mjs \
  --ref design/06-reviews.png --route / --width 1440 --selector "#reviews" --reduce

# behaves right
node $SKILL/probe.mjs drag --selector "#reviews" --width 375
node $SKILL/probe.mjs overflow
node $SKILL/probe.mjs eval --width 1440 --file /tmp/read-header.js
node $SKILL/probe.mjs proportions --widths 1024,834,768,640,480,375,320
```

Both instruments exit non-zero while the page is wrong, so both can gate a
loop. `probe.mjs --help` prints its own options.

## Order of operations

Phases 0–2 are shared prerequisites: do them **before** any fan-out, because
every section depends on their output. Phase 3 is per section and is where the
six domains land together. Phase 4 judges. Nothing in 3 is revisited in a
"responsiveness pass" or a "behaviour pass" — those passes are how a slice
costs three times what it should and still ships broken.

0. **Read the frame.** One `get_design_context` per node plus
   `get_variable_defs`. Export every frame the file supplies as PNG — both
   widths, every section — into `design/` and `design/mobile/`. Those files are
   the reference for everything after.

1. **Measure both frames before writing anything.** The step whose absence is
   most expensive, because what it catches is invisible until a whole page
   stands on it. Anchor `--viewport-min`/`--viewport-max` to the widths the
   design actually supplies; tally spacing in both frames before assuming it
   scales; map the type ladder frame-to-frame, not by ratio; subtract leading
   trim from every vertical measurement taken off text. Details and the numbers
   are in `lumos-slice-figma` step 2 and in the lessons file.

2. **Token pass, then the behaviour spec.** `convert.mjs`, one batched
   `ASK BEFORE WRITING`, tokens placed by hand in `base.css` — one owner for
   that file for the length of the slice. Then write down what the design
   _does_: variant names are the state machine, prototype links say what opens
   what, and a chevron or a greyed button is a behaviour nobody wrote down. Map
   each onto a real library component (labels over a panel is `Tabs`; an
   overlay is `Modal`; fields with a submit are `Form`), and list what the
   frame never drew — focus, disabled, empty, loading, error, after-submit.

3. **Build each section whole.** Compose from `Section` → `ContentWrapper` →
   typography and `Grid`/`Card`; new component only where nothing composes.
   In the same edit: both widths, the states from the spec, the assets (real
   exports, never hand-drawn), and the motion the design implies under the
   project's motion contract. Check the section against the lessons file as you
   write it, not after an instrument disagrees.

4. **Prove, fix the largest fault, repeat.** Offsets before percentages, bands
   before pixels; then the behaviour probes. A behaviour change that costs
   layout is exactly what re-running the overlay after it is for.

5. **Report what could not be settled.** A band that will not close is usually
   the design disagreeing with itself — a heading 40 in one frame and 32 in the
   other. Say so with both numbers and ask. Never nudge a token to close a
   picture: that trades one visible mismatch for an invisible one everywhere
   else the token is used.

## The width the design never drew

Most files supply one frame. Everything below it is then **our** design, and
the overlay cannot judge it — there is nothing to overlay against. That is not
permission to improvise: five faults shipped past a green overlay sweep on the
Reader slice, every one of them at a width nobody drew, and every one of them a
number. So the narrow widths get their own rules and their own instrument
(`probe.mjs proportions`), run at 1024, 834, 768, 640, 480, 375 and 320.

- **A photo takes at most 60% of the window.** The frame's crop is a ratio at
  ONE width. At container width on a phone the same ratio is half a screen: a
  421×560 pick stood 500 tall at 375 and 498 at 834. Change the ratio per band
  (3:2 below 48rem, 16:9 below 64rem, the frame's own above), never the height.
- **A crop window needs a definite height.** `aspect-ratio` on the window plus
  `height: 100%` on the image is indefinite, the photo's ratio wins, and the
  window stops cropping — 458 instead of 220 on a portrait export, 220 instead
  of 185 on a 3:2 one. `position: relative` + `inset: 0` on the image, always,
  and re-check at every width because the window's ratio changes per band.
- **Both ends of a scroll row match.** A row that bleeds needs
  `padding-inline` of the site margin AND `scroll-padding-inline` to match, or
  it reads inset at the start and glued to the glass at the end. A row that
  stays inside the container must not bleed at one end only. Measure both
  insets at both scroll extremes; they are equal or the row is lopsided.
- **A rule belongs on the grid line, not in the gutter.** A separator drawn as
  `border-inline-start` + a `gap` sits at the far side of the gutter and its
  horizontal partner stops at each cell's edge. Zero the gap and pad the cells:
  the rule then lands on the midpoint and runs unbroken.
- **Type from the frame is a desktop size, tap targets are not.** A 21-tall
  link is fine with a mouse and a miss with a thumb. Below the stack point give
  every link its own `min-height: var(--control-height-small)`; on a nav row,
  move the row's own padding onto the link so the 45 the frame draws IS the
  tap box.
- **A brand mark is not a poster.** A wordmark at `55vw` is 206 wide on a 375
  screen. Cap it in `rem` and in `vw` — `min(10.5rem, 40vw)` — and check it at
  320, where the ceiling stops mattering.
- **A hover transform outranks an un-layered sibling.** `scale` on a photo
  moves it into the transformed paint layer, above its own scrim: the overlay
  vanishes exactly while the reader is looking at it. Give the photo, the scrim
  and the body explicit `z-index`es.
- **Prose keeps a measure.** The frame's widest column is a measure too (856
  at 18px ≈ 95ch). A block that fills the container at 1024 runs past it —
  cap it in `ch` at the stack point.

## Non-negotiables

- **No absolute positioning to hit the frame.** Matching 1440 by pinning
  pixels breaks every other width and cannot be changed later.
- **No token invented to close a diff**, and no token moved without saying
  which frames disagree.
- **Assets are exports.** Never author an `<svg>`, never substitute a
  project icon whose glyph does not match, never leave a placeholder. Import
  the path only once the file is on disk — a missing asset import is a 500 on
  the shared dev server, which breaks every other agent's proof at once.
- **One dev server, one motion layer, one owner per file.**
- **No new animation library.** The project already has one curve, one
  duration scale and one scroll driver; a second is a disagreement, not a
  feature.
- **A hidden or clipped element is not a fix.** `overflow: hidden` over a
  layout fault hides the fault, keeps the cost.
- **The user's report is ground truth.** On this slice every reported symptom
  ("banner masih terlihat", "swiper hilang", "ada overflow") turned out to name
  a real, distinct, measurable bug — and two of them had already been declared
  verified. Reproduce what they describe with an instrument before explaining
  anything.

## Dividing the work

Six agents on one page is faster than one only if measurement stays meaningful:

- **Own files, not regions of files.** Two agents in one component collide.
  Coordinate over `hub` before touching a shared file; `base.css` has a single
  owner for the whole slice.
- **Never pass an absolute scroll offset between agents.** Every sibling's
  edit moves it. Let `--selector` find the section at capture time.
- **Siblings skip project-wide validation.** Formatters, `astro check` and the
  full overlay sweep run once, at the end, by the integrator — a sibling
  validating mid-flight is blocked on everyone else's half-finished edits.
- **State the cross-agent contract up front** — token names, component props,
  which section owns which node — rather than letting agents negotiate it.

The existing agent set (`figma-slicer`, `figma-behavior`, `figma-tokens`,
`figma-motion`, `figma-assets`, `figma-overlay`) already encodes this split and
the `/slice` command runs it.

## The report

Close with the `lumos-import-figma` lists — new variables, new components,
guesses, snapped, contrast, still open — plus:

- **Per section, per width:** differing percentage and offset, from the
  overlay's own output.
- **Functionality:** every state from the spec, with the value read out of the
  page at both widths — not "works".
- **Motion:** what animates, with which token pair, and what was declined.
- **Behaviour probes:** the drag verdict and the overflow sweep.
- **Unsettled:** every band left above tolerance with what is in it and why it
  stayed, and every place the design disagrees with itself.

## Improving this skill

It is meant to grow, and only in one shape: **a lesson is a symptom, a cause,
a fix, and a number.** When something is found the hard way:

1. Add it to [reference/lessons.md](reference/lessons.md) under its domain,
   with the measurement that revealed it. A lesson without a number is a
   feeling and will be ignored by the next reader.
2. If an instrument could have caught it, **teach the instrument** — a check in
   `probe.mjs`, a phantom handled in `overlay-figma.mjs`. Notes catch a fault
   once; a tool catches it every time. Every check in `probe.mjs` exists
   because a real bug shipped past a source review first.
3. If it was the instrument that lied, say so in the lessons file under
   _The instruments_. An instrument that lies sends the next agent chasing a
   fault that is not in the page.
