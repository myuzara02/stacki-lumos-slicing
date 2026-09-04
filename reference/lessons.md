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

- **The leading-trim pseudos are not free once the trim is zero.** On a frame
  whose gaps are all measured between full line boxes, the trim has nothing to
  remove, so `--primary-trim-*: 0.5lh` cancels it — and the rule's own
  `::before`/`::after` then do two kinds of damage on their own. A
  `display: table` `::before` **is** the element's first baseline, so
  `align-items: baseline` in a section head aligned the button to a phantom
  baseline at y=0 and pushed the 48px title **16px down**, taking the whole
  1127-tall section with it (overlay 24.64% → 11.69% once removed). And inside
  a flex or grid parent both pseudos become items: a 296-wide footer social row
  measured **347.61**. If the trim is a no-op, delete the rule, do not just
  neutralise its tokens — and never put a `text-style-*` class on a flex or
  grid container.

---

## Layout and styling

- **`img { max-width: 100% }` + `object-fit: cover` versus a crop.** `base.css`
  sets both. A frame that draws a photo at its own size inside a smaller window
  — the crop pattern — is silently defeated: the image fills the window instead
  of being cropped by it. **Four sections** hit this (hero 7.85% → 3.45%, focus
  7.52% → 6.22%). Size the image, let the window clip, and add `max-width: none`
  where the image is deliberately wider than its block.

- **A percentage height inside an `aspect-ratio` window is indefinite.** The
  crop pattern written as `.media { aspect-ratio: 306 / 220 }` +
  `img { width: 100%; height: 100% }` holds only while the photo is *wider*
  than the window. One of four exported cards was portrait (1600×2397): its
  `height: 100%` resolved against an auto height, the image's own ratio won,
  and `min-height: auto` let the content overrule the ratio — the media box
  rendered **458.4 instead of 220** and the card grew 238 too tall (music
  overlay 15.34% → 7.63%). Make the height definite: `position: relative` on
  the window, `position: absolute; inset: 0` on the image. Check the intrinsic
  orientation of **every** export, not the first one.

- **`text-wrap: balance` / `pretty` versus a Figma line break.** Figma wraps
  greedily. Lumos ships `balance` on every heading and `pretty` on body text,
  and both move a word between lines: rail titles broke a word early, a
  four-line 36px feature title put "back to" on the wrong line, and three
  196-wide date columns each wrapped differently from the frame. A wrong line
  break is a real difference, not antialiasing — set every `--*-text-wrap` to
  `normal` when the frame is the reference, and say so in the report.

- **A CSS `border` for a Figma stroke.** A Figma stroke draws _inside_ the
  frame; a `border` adds its width to the box. Cost: **1px per row, 9px of
  drift** down a five-row table. `box-shadow: inset 0 0 0 <w>` draws inside and
  costs no layout.

- **`display: inline-block` on a stacked link.** Brings the line box's
  descender with it — about **3px per row, 12px per footer column**. Use
  `display: block` or a flex parent.

- **A scroll row bled at one end only.** The frame draws the music row running
  off the right edge, so the slice gave it `margin-inline-end: -site-margin`
  and nothing else. At every width the row then started 20 in from the glass
  and ended flush against it: `startInset 0 / endInset 0` against a container
  inset of 20–72. A reader on a phone reads that as a broken slider. The fix is
  three lines on the scroller — bleed both edges, `padding-inline` of the site
  margin, and `scroll-padding-inline` to match so every snap lands on that
  line — and at 1440 the padded scrollport is exactly the frame's 1368 track,
  so the desktop geometry does not move. Measured after: 23/22 at 375, 41/41
  at 768, 53/52 at 1024, on all three rows of the page.

- **A hover `scale` paints over its own scrim.** `scale: 1.03` on a photo puts
  it in the transformed paint layer, which sits above every un-layered sibling
  in the same stacking context — so the gradient under the headline vanished
  for exactly as long as the pointer was on the card, and only there. Nothing
  in the source reads wrong: the scrim is still a grid item in "stack", still
  painted, just underneath. Give the photo `z-index: 0`, the scrim `1`, the
  body `2`. `probe.mjs proportions` now reads the `:hover` rules out of the
  stylesheets and names any transformed element whose un-layered sibling
  carries a gradient.

- **A separator drawn with `border-inline-start` + a `gap`.** In a 2-column
  facts strip the vertical rule then sits at the far side of the gutter rather
  than on the midpoint, and the row-2 rule stops at each cell's edge, leaving a
  gap in the middle of a line that should be continuous. Zero the gap and put
  the padding on the cells: the rule lands on the grid line, and the
  horizontal one runs unbroken because the cells abut.

- **A wordmark sized in `vw` alone.** `min(17.5rem, 55vw)` is 206 wide on a
  375 screen — a poster, not a masthead, once a toggle and a search row sit
  under it. `min(10.5rem, 40vw)` = 150 at 375 and 128 at 320. Cap in both
  units and look at 320, where only the `vw` term is doing anything.

- **Type sizes came from the frame; tap targets did not.** Footer and nav links
  measured **21–35px tall** at every width below the stack point, because the
  frame's 33 pitch is a desktop column and the 45 nav row was padding on the
  row rather than on the link. Move the row's padding onto the link and give
  stacked links `min-height: var(--control-height-small)`: the frame's geometry
  is unchanged and the box a thumb hits is 40–45 instead of 21.

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

- **A duplicate-label button clips at the LABEL, not at the button.** The
  pattern is a `text-shadow` copy one travel below the real glyphs, revealed
  by translating the text inside a clipping box. Clip on the control and the
  copy is visible at rest: a `large` button is 56 tall around a 12 line, so 22
  of empty padding sits under the label and a 24 travel showed 10 of ghost
  text in it — reported by the reader, invisible in the source. Wrap the label
  in its own `height: 1lh; overflow: clip` window and travel exactly `1lh`:
  the reveal is then the same at 40, 44 and 56 tall, and the variant that has
  no duplicate (a text link) has to opt out of the window or it loses its
  descenders.

- **A `0fr → 1fr` panel needs three things to be true, and `visibility:
hidden` hides the fact that they are not.** The reader's report was "the
  links are still there when the hamburger closes". Measured, closed, at 375:
  the row was **1** tall and the list was **426**, hanging out of a
  `z-index: 100` header — invisible only because the panel carried
  `visibility: hidden`. Fixing it took three passes, each of which the
  instrument had to catch separately:
  1. **The clip has to be on the box that shrinks.** It was on the inner,
     which clips the inner's children and says nothing about the inner.
  2. **A grid item's automatic minimum is its content**, so with the row at 0
     the item still stood at 426. `min-height: 0`.
  3. **`align-items` from a wrapper pattern kills the stretch.** The panel sat
     in Lumos's `container` (`align-items: start`), so it was never stretched
     to its row and took its content height — and later, in flex, its width
     collapsed to the widest label and the rules between the links stopped a
     third of the way across. `align-self: stretch; width: 100%`.

  Even with all three, the header's box resolved **a frame behind** the track
  it contained: box **345.3** around a row of **278.4**, which the reader saw
  as an empty strip with two links left in it. The version that holds is the
  boring one: **transition a height the script measures** (`--_panel` written
  from the list's own `offsetHeight`, re-read on resize and on
  `document.fonts.ready`), with the clip on the panel and the no-JS path
  opening it outright. After: closed row 1 / panel 0, open 427 / 426,
  mid-close box and content agree to within the 1px border, and the nine links
  stay out of the tab order at every step.

  The generalisation worth keeping: **`visibility: hidden`, `opacity: 0` and
  `overflow` are concealment, not collapse.** When a panel is meant to be
  closed, measure the box — `menuH`, the panel's own height, and the first
  link's rect — and only then believe it. Three separate reads in one frame,
  because during a transition each read advances the clock.

- **A sticky header that collapses in place reflows the whole page.** The
  condensed-header pattern written as a class on the sticky element — smaller
  padding, hidden rows, smaller wordmark — shrinks a box that is still IN
  FLOW, so every section below it jumps up by the difference the moment the
  class lands: measured 239.9 → 116, i.e. **124px** of upward jump mid-scroll,
  which the overlay caught as **120px** of offset on a section eight screens
  down and 8–17% of extra difference on five others. The version that moves
  nothing is a negative sticky offset: `top: calc(var(--_masthead) * -1)` with
  the masthead's height measured into that property by a `ResizeObserver`. The
  header then keeps its full height at the top of the page and simply hangs
  higher once pinned. Verified: the hero's document offset stayed 240 at every
  scroll position, the pinned band read `menuTop 0` on the way up, and
  `elementFromPoint(x, 4)` returned a nav link.

- **A marquee answers none of the drag questions.** `drag` asked a
  self-running row whether its last item lands flush and whether it comes
  back, and reported `-949px` against a row that is *meant* to be longer than
  the window forever. It also could not find the row at all: the mover
  heuristic read only `transform`, while a CSS marquee animates the
  independent `translate` property, and the track sits under two single-child
  wrappers (viewport > track > panel) whose depth changes under reduced motion
  because the duplicate panel is `display: none`. Now: `translate` counts as
  movement, the item line is found by walking down through single-child
  wrappers, and a row with a running animation is judged only on *does it
  travel* and *does a thumb over it still scroll the page*.

- **A retracting header's reduced-motion escape has to match the retract's own
   selector.** The retract needs a guard so it never fires while a mobile
  panel is open — `body:not(:has(.nav_toggle[aria-expanded="true"]))
.nav_wrap.is-hidden` — and the `prefers-reduced-motion` override written as
  the plain `.nav_wrap.is-hidden` then loses on specificity: measured `navTop
-252` under `--reduce`, i.e. the bar still left. Write the escape on the same
  shape, and skip creating the trigger in the script as well. After: `navTop 0`
  at every scroll position under `--reduce`, `-252 → 0` without it.

- **Smooth scrolling is proved by interpolation, not by a class name.** Lenis
  writes `lenis` on `html` as soon as it is constructed, so a `classList` check
  says nothing about whether the page actually eases. Dispatch a real
  `Input.dispatchMouseEvent` wheel and sample `scrollY` across frames:
  `0 → 150 → 216 → 249 → 277 → 294 → 304 → 310 → 314` toward a 320 target is
  interpolation; a single jump to 320 is not. The same wheel proves the
  direction watcher, because `ScrollTrigger` is reading Lenis rather than the
  native scroll: `navTop 0 → -252` down, `→ 0` up, at 1440 with Lenis and at
  375 without it.

---

## The instruments

An instrument that lies sends the next agent chasing a fault that is not in
the page. Every phantom below was real here and is now handled.

- **Capture through a reader's viewport, not a frame-tall window.** `100svh`
  _means_ the viewport: a 10,000px-tall window turns a viewport-height hero
  into a 10,000px hero and shifts everything under it. One section read
  **93.40%** differing for this reason alone. `overlay-figma.mjs` tiles through
  a normal viewport and stitches.

- **`drag` aimed at the viewport, not at the row — and walked the finger off
  screen.** Two faults in one command, both of which report a working native
  scroll row as dead. The finger landed at a fixed `0.6 × height`: with
  `--selector` on a tall section at 375 the row measured **876..1182 in an 812
  window**, so the touch hit the section above it and nothing moved. And
  `--distance` defaults to `2.5 × width`, so an unclamped stroke walked the
  point to **x = -618** in a 375 window; a library reading its own deltas still
  follows that, but the browser's own scroller gets nothing. Both are fixed:
  the run scrolls the discovered mover to the middle of the window, aims at its
  centre, clamps every touch point inside the viewport, and prints
  `finger y=… (row top..bottom)` plus `scrollLeft` so a miss is visible in the
  first line. After the fix the same row read `scrollLeft 0 → 316 → 633 → 897`
  with the last card flush (`empty right 0`) and a vertical swipe still
  scrolling the page — the page had been correct all along.

- **A native scroller cannot be proved with synthetic JS touch events.** A
  `page.dispatchEvent(new TouchEvent(...))` never reaches the compositor, so it
  can only exercise a JS handler. Either drive `Input.dispatchTouchEvent`
  through CDP with touch emulation on (what `drag` does) or say the domain is
  unproved — a `querySelector` on `overflow-x: auto` is not a gesture.

- **A capture taken while the page reveals itself measures nothing.** A slice
  with a body fade-in and `slide-up` reveals read **ticker 86.70%** and put the
  footer **66px** out, and every mid-page section about 1% worse, purely
  because the tiles were captured mid-tween — and because a block that has not
  been scrolled past yet is still fully transparent, so it never settles at
  all. Waiting does not fix the second half. The capture now forces the
  resting state the frame actually draws: `body { opacity: 1 !important }` and
  `[data-scroll-animation] { opacity: 1; transform/translate/scale: none }`,
  all `!important`, for the length of the read.

- **A sticky header is as much of a phantom as a fixed one.** The old filter
  named `.nav_wrap.overlap` and `[class*=fixed]`, so a `position: sticky`
  header passed it, stayed in flow — and painted its whole 252 band across
  every mid-page tile: footer **33px** of false offset, three sections ~3%
  worse. Hidden by computed position now (`sticky` or `fixed` with a top edge
  above 8), never the element being measured, and only for frames that are not
  the top of the page.

- **Every synthetic gesture has to fit the window, in both axes.** Three
  separate false faults came from a finger leaving the viewport: a horizontal
  stroke walking to `x = -618`, a return stroke born inside Chrome's left-edge
  back-navigation zone, and the vertical "does the page still scroll through
  this row" check travelling a fixed 320px up from a 40-tall strip that sits
  near the top — `y = -10`, points dropped, `pageY 1307 → 1307`, and a
  perfectly good ticker reported as eating the gesture. `drag` now clamps
  every point, starts return strokes at mid-screen, and swipes whichever
  vertical direction has room, judging the page's movement in that direction.

- **A bleeding row's own padding is not a fault.** The flush check compared the
  last item against the window and called a fixed row broken: a scroller that
  bleeds the container carries the site margin as `padding-inline`, so its last
  item is supposed to stop 20–72 short. `emptyRight` is now judged against the
  row's own right edge plus its `padding-inline-end` — otherwise the fix for a
  lopsided row reads as a new bug the moment it lands.

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

- **A green sweep at the only width the file supplies proves nothing about the
  others.** On the Reader slice every instrument passed — twelve overlays at
  1440 within 0–3px, overflow clean at eleven widths, three drag probes sound,
  every form and the nav toggle read out of the live page — and the reader
  still found five faults on a phone: a 500-tall photo, a row inset at one end,
  a rule off the midpoint, a 206-wide wordmark, a scrim that vanished on hover.
  All five sat in the gap between the instruments: the overlay had no mobile
  frame to compare against, `overflow` only asks whether the page scrolls
  sideways, and `drag` only asks whether a row moves. The narrow widths were
  reviewed by eye, from section screenshots, which is exactly the "source reads
  correctly" mistake in visual form. **Where the design supplies no frame, the
  proof has to be a rule with a number, not a look** — that is what
  `probe.mjs proportions` and the SKILL's "The width the design never drew"
  ruleset are for. Run it in the same loop as the overlay, not after a report.
