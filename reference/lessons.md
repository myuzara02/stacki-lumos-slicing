# Lessons from the Sonder slice

Every entry below cost real time on one slice: a 13-section landing page,
sliced at 1440 and 375 from a Figma file, then debugged against reported
symptoms. Each is written as **symptom → cause → fix**, with the number that
revealed it, because a lesson without a number gets ignored.

The pattern behind almost all of them: **the source read correctly.** What
found them was measurement.

---

## Sizing, spacing and tokens

- **A fluid range anchored outside the design.** `--viewport-min: 320` while
  the design supplies 375: 375 sits **4.91% up every ramp**, so no token ever
  reaches its min inside the range the design covers and every value is
  slightly wrong at the small end — a whole page wrong, with nothing pointing
  at why. Anchor the range to the widths the file actually contains.

- **A spacing scale assumed fluid.** Tallying every `gap`/`p*` value in all 13
  desktop contexts against all 13 mobile ones produced `4, 8, 12, 16, 24, 32,
40, 48, 64` — **identical in both frames**. Only section padding and type
  scale. The invented ramp was worth **54px of false height in one section**.
  Tally first; a flat scale drawn flat stays flat.

- **A type ladder assumed to map by ratio.** The two frames are separate
  lists: `48/40/32/24/16.5` on mobile against `72/56/40/32`. Two elements that
  share a desktop size can differ on mobile — that is one element overriding
  locally, not a new token. Rebuild the ladder from an inventory of every text
  size in every context.

- **Leading trim.** `base.css` trims half a line top and bottom of every text
  block, so a block renders ~9px shorter than the Figma line box it was
  measured from, and the error accumulates down a long page. Subtract the trim
  from every vertical measurement taken off text. Setting `--text-*` trim to
  `0.5lh + 0.4em` was the single fix that removed drift from every section.

- **A height token that is not the height.** `--announcement-height: 40` while
  the strip measured **43.6** (`12 + 19.6 + 12` padding plus line box). The
  header retracts by the token, so 3.6px of the strip stayed visible under the
  bar — reported by the user as "banner masih terlihat", and invisible in every
  source review. When a token names a height, `min-height` must **be** that
  token and the padding must not add to it.

- **`--nav-height` guessed rather than read.** The frame draws a 48 row with 24
  above it; the token said 5rem. 4.5rem. Read the row, do not eyeball the bar.

---

## Layout and styling

- **`img { max-width: 100% }` + `object-fit: cover` versus a crop.** `base.css`
  sets both. A frame that draws a photo at its own size inside a smaller window
  — the crop pattern — is silently defeated: the image fills the window instead
  of being cropped by it. **Four sections** hit this (hero 7.85% → 3.45%, focus
  7.52% → 6.22%). Size the image, let the window clip, and add `max-width: none`
  where the image is deliberately wider than its block.

- **A CSS `border` for a Figma stroke.** A Figma stroke draws _inside_ the
  frame; a `border` adds its width to the box. Cost: **1px per row, 9px of
  drift** down a five-row table. `box-shadow: inset 0 0 0 <w>` draws inside and
  costs no layout.

- **`display: inline-block` on a stacked link.** Brings the line box's
  descender with it — about **3px per row, 12px per footer column**. Use
  `display: block` or a flex parent.

- **Type-scale block margins inside a flex item or table cell.** `--*-margin-*`
  still apply where no margin collapsing saves you, and add tens of px nobody
  wrote.

- **Sideways bleed clipped on `body` only.** `body { overflow-x: clip }` did
  not contain a 2032px filmstrip in a 1440 window — `documentElement.scrollWidth`
  read **2032**, i.e. the page scrolled sideways. Overflow propagates from
  `body` to the viewport only while `html`'s own is `visible`. Clip on **both**.
  Verified after: `scrollWidth === innerWidth` at 1440, 1024, 900, 834, 768,
  640, 480, 375, 320.

- **A clip in the wrong place cuts the design.** The same filmstrip clipped at
  the container's margin (1320) cut the next card mid-screen where the frame
  draws it running to the window edge. A slider **must** clip (an untranslated
  1900px track is a scrollable page); a scroll-driven row must not. So the clip
  is per breakpoint, not global: `overflow: clip` below the slider breakpoint,
  `visible` above it, with the window doing the clipping.

- **A pinned section must fit the viewport including its own padding.**
  `max-height: calc(100svh - var(--nav-height))` left the section **964px tall
  in a 900px window** — the reader holds still looking at a box whose bottom is
  off screen. Subtract the section's own padding tokens too; verified 900-in-900
  and 715-in-812.

- **A shrink-to-fit column is not a flex basis.** `flex: 0 1 19rem` let Chrome
  size a field column from its max-content instead of the basis (351 against
  the frame's 304). Name the basis.

---

## Functionality

The three worst faults of the slice were all here, and all three passed
programmatic verification before a real gesture found them. **`querySelector`
proves a thing exists. It does not prove it works.**

- **A dropped option in a "cleanup" edit.** `slidesPerView: "auto"` was lost
  while tidying the Swiper config. Swiper fell back to `1`, wrote
  `width: 343px` inline on every card and believed the row was six screens wide
  (`virtualSize 3960` against real content 1872, `maxTranslate -3300`). Dragging
  left emptied the row completely — the user's "swiper nya jika terus di slide
  ke kiri jadi hilang". Re-check config-level options after any edit that
  reformats a config; the page still initialises perfectly with the option gone.

- **A library cannot see a CSS `gap`.** With the option restored, Swiper still
  measured `6 × 292 = 1752` against a real `1872` row and stopped the drag with
  the last card **120px off screen**. Hand the gap to the library from the
  stylesheet (`spaceBetween: parseFloat(getComputedStyle(track).columnGap)`) and
  zero the CSS gap while the library owns the row — one source for the number,
  restored on teardown. After: last card lands flush at `innerWidth` at 834,
  768 and 375.

- **`resistance: false` is the opposite of what it sounds like.** Rubber-band
  past the end opened **213px of empty section** mid-gesture. `resistance:
false` removes the _damping_, not the travel — the row could then be dragged
  **1650px** past a `-1099` bound, entirely off screen. `resistanceRatio: 0` is
  the clamp. After: worst mid-gesture overshoot 0px at all three widths.

- **A transition that never ends leaves the library stuck.** Swiper animates
  momentum by writing an inline `transition-duration` and waiting for
  `transitionend`. The track had no `transition-property` naming `transform`,
  so the event never arrived, `swiper.animating` stayed `true`, and **the row
  died after the first drag** while the page kept scrolling. Give the element
  `transition-property: transform; transition-duration: 0s`.

- **`touch-action: pan-y` is not optional when you skip a library's CSS.**
  Running Swiper with the component's own class names means none of
  `swiper/css` applies — including the one rule gestures need. Without it the
  browser claims a horizontal drag as a scroll and the row feels dead.

- **Verify with input, not with state.** The harness that finally found all of
  the above: `Input.dispatchTouchEvent` through CDP, **sampled while the finger
  is down**. Two of these bugs are invisible after the gesture settles. That
  harness is now `probe.mjs drag`.

- **Programmatic `.click()` is not a user gesture.** A `<video>` stays paused
  in headless after `.click()`; that is the platform, not the component. Say so
  rather than reporting a bug, and keep `controls` as the net.

---

## Animation

- **One curve, one duration scale, one driver.** `Motion.astro` owns
  `CustomEase "osmo"` = `M0,0 C0.625,0.05 0,1 1,1`, whose CSS twin is
  `--motion-ease: cubic-bezier(0.625, 0.05, 0, 1)`, plus
  `--motion-duration-fast .2s` (hover) / `-base .4s` (open) / `-slow 1s`
  (scroll reveal). 1s is a ceiling for a scroll-length reveal, never the price
  of a hover.

- **A scrubbed animation uses `ease: "none"`.** Its clock is the scroll; an
  ease on top is a second curve fighting the first.

- **Lenis interpolates, it does not ease.** Its `easing` option restarts an
  eased animation on every wheel tick and reads as lag — the page keeps
  travelling after the wheel stops. `lerp` chases the real position every
  frame, which is why the pointer stays in charge. One Lenis, on GSAP's ticker,
  driving `ScrollTrigger.update`.

- **A ScrollTrigger created before its element's reveal measures the wrong
  place.** A `from` tween holds its target 24px low from creation until it
  plays, so every trigger built at load cached a start/end **24px out**
  (`7096/7328` against the real `7072/7304`). Refresh when the reveal settles,
  or anchor the trigger to an untransformed ancestor.

- **Scrub endpoints are a design decision, not a default.** `start: "top top"
→ end: "bottom top"` finished the row exactly as the section left the screen,
  so the end state was never seen. The design's intent — "selesai ketika item
  menyentuh top viewport" — is `start: "top bottom"`, `endTrigger: <the row>`,
  `end: "top top"`. Measured: row top `1164 → 426 → -24` against travel
  `0 → -363 → -592 (done)`.

- **A retracting bar must retract by exactly its own token.** See the 3.6px
  sliver above. `elementFromPoint(x, 1)` is the honest check: it must return the
  bar, not the strip.

- **Under `prefers-reduced-motion: reduce`, a scrubbed timeline renders its
  FINAL state**, everything visible. Rendering the `from` state hides content
  from exactly the readers who asked for less motion. This is also what makes a
  scrubbed section measurable — hence `overlay-figma.mjs --reduce`.

- **Kill ScrollTriggers on `astro:before-swap`.**

---

## The instruments

An instrument that lies sends the next agent chasing a fault that is not in
the page. Every phantom below was real here and is now handled.

- **Capture through a reader's viewport, not a frame-tall window.** `100svh`
  _means_ the viewport: a 10,000px-tall window turns a viewport-height hero
  into a 10,000px hero and shifts everything under it. One section read
  **93.40%** differing for this reason alone. `overlay-figma.mjs` tiles through
  a normal viewport and stitches.

- **The dev toolbar and a pinned nav are not the page.** Both paint into every
  tile whose crop reaches them: the toolbar as a 48px band at the bottom, the
  nav as a bar across every mid-page tile. Hidden during capture — the nav only
  for frames that are not the top strip.

- **`decode()` on an off-screen lazy image never settles.** Awaiting
  `document.images` hung the tool for a minute and then produced nothing. Await
  only the images the tile shows, and race each against a timeout.

- **A height floor pads a short frame.** Comparing a 38px announcement strip
  against a one-band minimum charges the page below it as a difference.
  Compare at the frame's own height.

- **A sticky element reports its stuck offset.** A footer that uncovers reads
  `y=1` while it sits at 9800. `--selector` pins it static for one read.

- **An `offsetTop` read before `document.fonts.ready` is tens of px wrong**, and
  a substituted font costs a **wrapped line** at narrow widths. Never invent a
  `max-width` to fake the wrap away; report the missing font.

- **Read a tool's error literally.** `.closing_band_wrap` (underscore) against
  a real `.closing-band_wrap` (hyphen) surfaced as _"capture failed — object is
  not iterable"_ and cost a debugging detour. The selector was wrong, not the
  page; the message was the tool's fault and is worth fixing when seen.

- **`page.setViewport` in a shared browser window is a no-op.** A sweep across
  nine widths reported `innerWidth: 734` nine times because the tab was a real
  split window. Metrics must come from
  `Emulation.setDeviceMetricsOverride` on a headless target — what both scripts
  here do.

---

## Process

- **Measure both frames before writing anything.** Half the sizing entries
  above are one missing step.

- **One pass, not three.** A card that stacks at 375, opens on click and
  reveals on scroll has _one_ structure that serves all three — and a different
  one if the other two are discovered later. Mobile is not a later pass;
  behaviour is not a later pass.

- **Batch the questions.** Everything the design cannot answer goes into one
  `ASK BEFORE WRITING` list, each with the option you would take by default.
  A value present in one frame and absent from the other is a question, not an
  average.

- **Report a design that disagrees with itself; do not average it.** Real
  examples: a section heading 40 at 375 where every sibling is 32; a compare
  title 20 against an offer's 24; a closing band that exists only in the mobile
  frame.

- **The user's symptom usually names the cause.** Four reported symptoms, four
  distinct real bugs, two of them in work already declared verified. Reproduce
  with an instrument first, explain second.

- **Never claim a domain is verified with the wrong kind of check.** "Swiper is
  initialised, cards are 292, pitch is 316" was true and useless. The claim
  must exercise the thing the user does.
