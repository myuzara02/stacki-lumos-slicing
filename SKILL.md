---
name: stacki-lumos-slicing
description: Slice a Figma design into a Lumos for Astro page in ONE pass — layout, styling, sizing, spacing, animation and functionality together — with each of the six proved by an instrument rather than by reading the source. Use when a Figma node has to become a working page, when a slice is "close but off", when a page looks right but a drag, a sticky bar, a scrub or a form misbehaves, or when planning how to divide a slice across agents.
---

# Slicing a design in one shot

Three skills already exist under this one and are not repeated here:

| Skill                  | Owns                                               |
| ---------------------- | -------------------------------------------------- |
| `figma-design-to-code` | how to talk to the Figma MCP                       |
| `lumos-import-figma`   | measurements → tokens, and `convert.mjs`           |
| `lumos-slice-figma`    | the overlay loop, and what 1:1 can and cannot mean |

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

Six domains, six proofs. Nothing here is optional, and none of it is "a later
pass":

| Domain                           | Proof                                                                                            | Command                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Layout, styling, sizing, spacing | overlay against the frame, at **every** exported width                                           | `overlay-figma.mjs --ref … --selector … --width …`                                |
| Animation                        | scrubbed things at their **start and end** states, plus the layout still landing under reduction | `overlay-figma.mjs … --reduce`, then `probe.mjs eval` at sampled scroll positions |
| Functionality — pointer/touch    | a **real gesture**, sampled while the finger is down                                             | `probe.mjs drag --selector …`                                                     |
| Functionality — state            | the state read out of the page at each state, both widths                                        | `probe.mjs eval --expr …`                                                         |
| Page integrity                   | no sideways scroll at any width                                                                  | `probe.mjs overflow`                                                              |
| Types and build                  | the project's own gates                                                                          | `npx astro check`, `npx astro build`                                              |

```bash
# looks right
node .claude/skills/lumos-slice-figma/overlay-figma.mjs \
  --ref design/06-reviews.png --route / --width 1440 --selector "#reviews" --reduce

# behaves right
node .claude/skills/stacki-lumos-slicing/probe.mjs drag --selector "#reviews" --width 375
node .claude/skills/stacki-lumos-slicing/probe.mjs overflow
node .claude/skills/stacki-lumos-slicing/probe.mjs eval --width 1440 --file /tmp/read-header.js
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
