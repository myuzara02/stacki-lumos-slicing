#!/usr/bin/env node
/**
 * Proves a sliced page BEHAVES, the way `overlay-figma.mjs` proves it LOOKS.
 *
 * The overlay reads a still. Everything a design does between stills — a row
 * that can be dragged, a bar that retracts, a page that must never scroll
 * sideways — is invisible to it, and every one of those was shipped broken
 * here while its own source read correctly and its own `querySelector` checks
 * passed. What caught them was real input through the browser, so that is
 * what this script sends.
 *
 * Four commands, because four questions kept coming back:
 *
 *   overflow  Can the page be scrolled sideways at any width, and if so, who
 *             is sticking out? `body { overflow-x: clip }` alone does NOT
 *             answer this: overflow propagates from `body` to the viewport
 *             only while `html`'s own is visible.
 *
 *   drag      Drive a real finger across a row: `Input.dispatchTouchEvent`,
 *             sampled WHILE the finger is down. A slider can pass every
 *             programmatic check — initialised, right card width, right pitch
 *             — and still not move for a touch, or rubber-band 200px of empty
 *             section into view, or die after the first drag. None of that is
 *             visible from the outside.
 *
 *   eval      Run one async function in the page at a given width and print
 *             what it returns. The general case: header states at two scroll
 *             positions, a drawer opening, a form's validity, a video's
 *             readyState. Measure, do not assume.
 *
 *   proportions
 *             The width the design never drew. Every fault below was reported
 *             by a reader on a phone after a slice had passed the overlay at
 *             1440: a photo half a screen tall, a scroll row inset at one end
 *             and glued to the glass at the other, a rule sitting at the far
 *             side of a gutter, a wordmark at 55vw, a scrim that vanished
 *             under a hover transform. None of them are visible in a still at
 *             the one width the file supplies, and all of them are numbers.
 *
 * Headless Chrome over CDP, no dependencies.
 *
 * Usage
 *   node probe.mjs overflow --widths 1440,1024,834,768,375
 *   node probe.mjs drag --selector "#reviews" --width 375
 *   node probe.mjs eval  --width 1440 --file /tmp/read.js
 *   node probe.mjs eval  --width 375  --expr "() => ({ w: innerWidth })"
 *
 * Options
 *   --route <path>     Route to open. Default "/".
 *   --base <url>       Dev server. Default http://localhost:4321 (LUMOS_BASE).
 *   --width <px>       Viewport width. Default 375.
 *   --height <px>      Viewport height. Default 812.
 *   --widths <list>    overflow: comma separated widths. Default 1440,1024,834,768,375,320.
 *   --selector <css>   drag: the section holding the row.
 *   --items <css>      drag: the things that move. Default: the moving box's children.
 *   --distance <px>    drag: how far one drag travels. Default 2.5x the width.
 *   --repeat <n>       drag: drags per direction. Default 3.
 *   --widths <list>    proportions: widths to audit. Default 1024,834,768,640,480,375,320.
 *   --tall <ratio>     proportions: media taller than this share of the window fails. Default 0.6.
 *   --measure <ch>     proportions: text wider than this many characters fails. Default 100 — the frame's own widest measure is 95ch.
 *   --tap <px>         proportions: interactive box smaller than this fails. Default 40.
 *   --reduce           Emulate `prefers-reduced-motion: reduce`.
 *   --expr <js>        eval: an async function expression, e.g. "async () => ({})".
 *   --file <path>      eval: the same, read from a file.
 *
 * Exits non-zero when a check fails, so it can gate a loop the way the
 * overlay does.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => existsSync(p));

function args(argv) {
  const boolean = new Set(["reduce", "help"]);
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    if (boolean.has(key)) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

const die = (message) => {
  console.error(message);
  process.exit(1);
};

/* One browser, many viewports: relaunching Chrome per width costs seconds and
   loses the warm dev server response. A page reloaded after a metrics override
   is the same thing as a page opened at that width. */
async function browser() {
  if (!CHROME) die("No Chrome/Chromium/Edge found.");
  const port = 9333 + (process.pid % 400);
  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${mkdtempSync(join(tmpdir(), "lumos-probe-"))}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const endpoint = await (async () => {
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/version`);
        return (await r.json()).webSocketDebuggerUrl;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    die("Chrome never opened its debugging port");
  })();

  const ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let next = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const m = JSON.parse(event.data);
    if (!m.id || !pending.has(m.id)) return;
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const { targetId } = await send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const call = (method, params) => send(method, params, sessionId);
  await call("Page.enable");
  await call("Runtime.enable");

  return { call, close: () => proc.kill() };
}

const BASE = process.env.LUMOS_BASE ?? "http://localhost:4321";

/** Opens the route at one viewport and waits for the page to stop moving. */
async function open(call, { route, width, height, touch, reduce }) {
  await call("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: Boolean(touch),
  });
  if (touch) {
    await call("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    await call("Emulation.setEmitTouchEventsForMouse", {
      enabled: true,
      configuration: "mobile",
    });
  }
  if (reduce) {
    await call("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
  }
  await call("Page.navigate", { url: `${BASE}${route}` });
  /* A navigate resolves when the request is committed, not when there is a
     document to touch — the first read after it hits `document.head === null`
     and reads as a page bug. Wait for the document itself. */
  for (let i = 0; i < 200; i++) {
    const ready = await evaluate(call, `() => document.readyState`).catch(
      () => null,
    );
    if (ready === "complete") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  /* Fonts move every line, lazy images decide every height, and a hydrating
     island decides whether there is a slider at all. A read before all three
     have landed is a number about a page that no longer exists. */
  await evaluate(
    call,
    `async () => {
      const hide = document.createElement("style");
      hide.textContent = "astro-dev-toolbar, #dev-toolbar-root, [data-astro-dev-toolbar] { display: none !important; }";
      document.head.append(hide);
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 600));
      window.scrollTo(0, 0);
      await document.fonts.ready;
      await new Promise(r => setTimeout(r, 900));
      return 1;
    }`,
  );
}

async function evaluate(call, fn) {
  const { result, exceptionDetails } = await call("Runtime.evaluate", {
    expression: `(${fn})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) {
    throw new Error(
      exceptionDetails.exception?.description ?? exceptionDetails.text,
    );
  }
  return result.value;
}

/* ── overflow ─────────────────────────────────────────────────────────────── */

const OVERFLOW_READ = `() => {
  const docW = document.documentElement.scrollWidth;
  const bodyW = document.body.scrollWidth;
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const b = el.getBoundingClientRect();
    if (!b.width || b.right <= innerWidth + 1) continue;
    /* Only the element that ACTUALLY escapes is worth naming: a child sticking
       out of a clipping parent is the design's bleed, not a bug. Walk up and
       stop at the first ancestor that clips. */
    let clipped = false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === "clip" || o === "hidden" || o === "auto" || o === "scroll") { clipped = true; break; }
    }
    if (clipped) continue;
    out.push({ el: String(el.className || el.tagName).slice(0, 40), right: Math.round(b.right) });
  }
  return {
    inner: innerWidth,
    docW,
    bodyW,
    scrollsX: docW > innerWidth,
    htmlClip: getComputedStyle(document.documentElement).overflowX,
    bodyClip: getComputedStyle(document.body).overflowX,
    unclipped: out.sort((a, b) => b.right - a.right).slice(0, 6),
  };
}`;

async function overflow(opts) {
  const widths = String(opts.widths ?? "1440,1024,834,768,375,320")
    .split(",")
    .map((n) => Number(n.trim()))
    .filter(Boolean);
  const { call, close } = await browser();
  const rows = [];
  let failed = 0;
  for (const w of widths) {
    await open(call, {
      route: opts.route ?? "/",
      width: w,
      height: Number(opts.height ?? 900),
      touch: w < 1024,
      reduce: opts.reduce,
    });
    const r = await evaluate(call, OVERFLOW_READ);
    if (r.scrollsX) failed++;
    rows.push([
      String(w).padStart(5),
      `doc ${String(r.docW).padStart(5)}`,
      r.scrollsX ? "SCROLLS SIDEWAYS" : "contained",
      r.unclipped.length
        ? `unclipped: ${r.unclipped.map((u) => `${u.el}@${u.right}`).join(", ")}`
        : "",
    ]);
  }
  close();
  console.log(rows.map((r) => r.join("  ")).join("\n"));
  console.log(
    failed
      ? `\n${failed} width(s) scroll sideways. Clip on BOTH \`html\` and \`body\`, or fix the element named above.`
      : `\nNo horizontal page scroll at any of ${widths.length} width(s). \`body.scrollWidth\` may exceed the window — that is bleed, and it is clipped.`,
  );
  process.exit(failed ? 1 : 0);
}

/* ── drag ─────────────────────────────────────────────────────────────────── */

/* Library-agnostic on purpose: reading `swiper.translate` proves what the
   library thinks, and the two bugs found here were both the library thinking
   one thing while the page did another. So measure the page — where the first
   item starts and the last item ends — and let any library be wrong out loud. */
const geometry = (selector, items) => `() => {
  const sec = document.querySelector(${JSON.stringify(selector)});
  if (!sec) throw new Error("no element matches " + ${JSON.stringify(selector)});
  const kids = (el) => [...el.children].filter((c) => c.getBoundingClientRect().width > 0);
  /* A scroller whose whole content is one track has a single child, and one
     item tells you nothing about where the row starts and ends. Walk down
     through every single-child wrapper until a real line of items appears —
     a marquee is viewport > track > panel > items, and under reduced motion
     its duplicate panel is display:none, so the depth is not fixed. */
  const line = (el) => {
    let own = kids(el);
    for (let i = 0; i < 4 && own.length === 1 && kids(own[0]).length; i++) {
      own = kids(own[0]);
    }
    return own;
  };
  /* The row is the widest thing that either overflows its own box, carries a
     transform, or is scrolled — and that has a line of visible children to
     measure. Anything else in the section (a wrapper, a hidden node, an SVG)
     can score on one of those and measure to nonsense, so all three have to
     hold at once. */
  let mover = null, best = 0;
  for (const el of [sec, ...sec.querySelectorAll("*")]) {
    const items = line(el);
    if (items.length < 2) continue;
    /* A transform is not the only way a row moves: a CSS marquee animates the
       independent translate property, whose matrix never appears in the
       transform, and the row then reads as motionless. Count both. */
    const cs = getComputedStyle(el);
    const tx =
      Math.abs(new DOMMatrixReadOnly(cs.transform).m41) ||
      Math.abs(parseFloat(cs.translate) || 0);
    const overflowing = el.scrollWidth - el.clientWidth > 8 || tx > 0 || el.scrollLeft > 0;
    if (!overflowing) continue;
    const extent = items.at(-1).getBoundingClientRect().right - items[0].getBoundingClientRect().left;
    if (extent > best) { best = extent; mover = el; }
  }
  if (!mover) throw new Error("nothing in " + ${JSON.stringify(selector)} + " moves sideways — is this the right section?");
  const list = ${items ? `[...document.querySelectorAll(${JSON.stringify(items)})].filter((c) => c.getBoundingClientRect().width > 0)` : "line(mover)"};
  const first = list[0].getBoundingClientRect();
  const last = list[list.length - 1].getBoundingClientRect();
  return {
    mover: String(mover.className || mover.tagName).slice(0, 32),
    items: list.length,
    firstLeft: Math.round(first.left),
    lastRight: Math.round(last.right),
    /* Positive = a strip of empty section is showing on that side. */
    emptyRight: Math.round(innerWidth - last.right),
    scrollY: Math.round(window.scrollY),
    scrollLeft: Math.round(mover.scrollLeft),
    tx: Math.round(new DOMMatrixReadOnly(getComputedStyle(mover).transform).m41),
    /* A row that drives ITSELF — a marquee looping on a CSS animation — is a
       different contract: it is meant to be longer than the window forever,
       so "does the last item land flush" and "does it come back" are not
       questions about it. Reported so the verdicts can say so instead of
       inventing a fault. */
    animated: [mover, ...mover.querySelectorAll("*")].some(
      (el) => getComputedStyle(el).animationName !== "none",
    ),
    /* A bleeding row carries the site margin as its own padding, so its last
       item is supposed to stop that far short of the row's edge. Without this
       the fix for a lopsided row reads as a new fault. */
    padEnd: Math.round(parseFloat(getComputedStyle(mover).paddingInlineEnd) || 0),
    /* Where the finger has to land. A fixed fraction of the viewport misses:
       a 305-tall row positioned at 20% of an 812 window ends at 467, and
       0.6 × 812 = 487 is 20px BELOW it, so the drag lands on the section and
       the row is reported dead while a real finger moves it fine. */
    moverTop: Math.round(mover.getBoundingClientRect().top),
    moverHeight: Math.round(mover.getBoundingClientRect().height),
    /* How far the row's own right edge sits from the window's. A bleeding row
       reads 0 and must end flush with the window; a row that stays inside the
       container reads the site margin, and its last item is supposed to stop
       there. Without this the flush check calls every contained scroller
       broken and every one of them a rubber-band. */
    insetRight: Math.round(innerWidth - mover.getBoundingClientRect().right),
  };
}`;

async function drag(opts) {
  const selector = opts.selector ?? die("drag needs --selector");
  const width = Number(opts.width ?? 375);
  const height = Number(opts.height ?? 812);
  const distance = Number(opts.distance ?? Math.round(width * 2.5));
  const repeat = Number(opts.repeat ?? 3);
  const steps = Number(opts.steps ?? 12);
  const read = geometry(selector, opts.items);

  const { call, close } = await browser();
  await open(call, {
    route: opts.route ?? "/",
    width,
    height,
    touch: true,
    reduce: opts.reduce,
  });

  /* Put the ROW in the middle of the window — not the section's top. A finger
     landing on a sticky bar drags the bar, and a finger landing on the section
     above the row touches nothing that moves: with `--selector` on a tall
     section the row can sit 876..1182 in an 812 window, entirely off screen,
     and the run reports a working row as dead. So: scroll the section into
     view, find the mover, then correct by the mover's own offset. */
  await evaluate(
    call,
    `async () => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const top = el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, Math.round(top - innerHeight * 0.2)));
      await new Promise(r => setTimeout(r, 700));
      return 1;
    }`,
  );

  const at = async () => evaluate(call, read);

  let aim = await at();
  const centre = aim.moverTop + Math.round(aim.moverHeight / 2);
  if (centre < 8 || centre > height - 8) {
    await evaluate(
      call,
      `async () => {
        window.scrollBy(0, ${centre - Math.round(height / 2)});
        await new Promise(r => setTimeout(r, 500));
        return 1;
      }`,
    );
    aim = await at();
  }

  /* Aim at the row's own centre, clamped inside the window. */
  const y = Math.min(
    height - 8,
    Math.max(8, aim.moverTop + Math.round(aim.moverHeight / 2)),
  );
  const touch = (type, x) =>
    call("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });

  /** One drag, sampled while the finger is still down.

      Two constraints on where the finger may be. It has to stay INSIDE the
      window: `--distance` defaults to 2.5x the width, so an unclamped stroke
      walks the touch point to x = -618 in a 375 window — a library reading its
      own deltas still follows it, but the browser's own scroller gets nothing
      and a perfectly good native row is reported dead. And it has to stay off
      the EDGES: a touch starting within ~15% of the left edge and travelling
      right is claimed by Chrome as a back-navigation gesture, so a row that
      scrolls back perfectly from mid-screen (400 → 228) reads as frozen
      (400 → 400) when the same stroke starts at x=56. `EDGE` keeps both ends
      of every stroke in the page's own territory; `--repeat` covers distance. */
  const EDGE = Math.min(64, Math.round(width * 0.2));
  const stroke = async (from, dx) => {
    let worst = null;
    const edge = (x) => Math.min(width - EDGE, Math.max(EDGE, x));
    await touch("touchStart", edge(from));
    for (let i = 1; i <= steps; i++) {
      await touch("touchMove", edge(from + Math.round((dx * i) / steps)));
      await new Promise((r) => setTimeout(r, 40));
      const s = await at();
      if (!worst || s.emptyRight > worst.emptyRight) worst = s;
    }
    await touch("touchEnd");
    await new Promise((r) => setTimeout(r, 900));
    return { worst, settled: await at() };
  };

  const rest = await at();
  const rows = [["rest", rest]];
  let overshoot = 0;
  let moved = false;

  /* Outward strokes also run until the row stops moving: with the finger
     clamped inside the window one stroke covers at most ~255px at 375, so a
     fixed three strokes stop 268px short of a 905px range and the flush check
     then measures a row that simply has not arrived yet. */
  let outward = rest;
  for (let i = 0; i < repeat * 3; i++) {
    const { worst, settled } = await stroke(
      Math.round(width * 0.85),
      -distance,
    );
    overshoot = Math.max(overshoot, worst.emptyRight);
    if (settled.lastRight !== rest.lastRight) moved = true;
    rows.push([`left ${i + 1} mid`, worst], [`left ${i + 1}`, settled]);
    const stalled = Math.abs(settled.lastRight - outward.lastRight) <= 1;
    outward = settled;
    if (stalled) break;
  }
  const end = rows.at(-1)[1];
  /* Return strokes start at mid-screen, not at 15% of the width: Chrome's
     left-edge back-navigation zone is wider than the 64px `EDGE` clamp, and a
     stroke born inside it never reaches the page (measured: identical stroke
     from x=56 leaves scrollLeft at 400, from x=169 it scrolls 400 → 228).
     That also makes a return stroke shorter than an outward one — 142px
     against 255px at 375 — so the way back is walked until the row stops
     moving rather than for a fixed count, and only a stall short of the start
     counts as a fault. */
  let backMoved = false;
  let before = end;
  for (let i = 0; i < repeat * 3; i++) {
    const { worst, settled } = await stroke(Math.round(width * 0.45), distance);
    rows.push([`right ${i + 1} mid`, worst], [`right ${i + 1}`, settled]);
    /* A mandatory-snap row whose item is wider than half the window snaps back
       to the same item after a short drag: the row DID follow the finger, it
       just landed where it started. That is the platform, not a stuck flag. */
    if (Math.abs(worst.firstLeft - before.firstLeft) > 4) backMoved = true;
    const stalled = Math.abs(settled.firstLeft - before.firstLeft) <= 1;
    before = settled;
    if (stalled) break;
  }
  const back = rows.at(-1)[1];

  /* A row that eats vertical gestures is worse than a row that does not move:
     the page stops scrolling wherever the reader's thumb happens to land.

     The swipe has to fit the window. A 40-tall strip sits near the top, so a
     fixed 320px upward travel walks the finger to y = -10, the points are
     dropped, and a page that scrolls perfectly reads as a row eating the
     gesture (measured pageY 1307 → 1307 with the finger off screen). Swipe
     whichever way has room, and expect the page to move that way. */
  const roomUp = y - 8;
  const roomDown = height - 8 - y;
  const up = roomUp >= roomDown;
  const travel = Math.max(80, Math.min(320, up ? roomUp : roomDown));
  await touch("touchStart", Math.round(width * 0.5));
  for (let i = 1; i <= steps; i++) {
    const shift = Math.round((travel * i) / steps);
    await call("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: Math.round(width * 0.5), y: up ? y - shift : y + shift },
      ],
    });
    await new Promise((r) => setTimeout(r, 30));
  }
  await touch("touchEnd");
  await new Promise((r) => setTimeout(r, 900));
  const afterVertical = await at();
  close();

  const w = 14;
  console.log(
    `row: ${rest.mover}  viewport ${width}×${height}  finger y=${y} (row ${aim.moverTop}..${aim.moverTop + aim.moverHeight})`,
  );
  for (const [label, s] of rows) {
    console.log(
      `${label.padEnd(w)} first ${String(s.firstLeft).padStart(6)}  last ${String(s.lastRight).padStart(6)}  empty right ${String(s.emptyRight).padStart(5)}  scrollLeft ${String(s.scrollLeft).padStart(5)}  tx ${String(s.tx).padStart(5)}`,
    );
  }

  const problems = [];
  /* Both of these are measured against the row's own right edge, not the
     window's: a contained scroller is supposed to stop at the site margin. */
  const inset = rest.insetRight;
  const band = overshoot - Math.max(0, end.emptyRight);
  const short = end.emptyRight - inset - rest.padEnd;
  /* A marquee answers none of the drag questions: it is meant to run past the
     window forever and it owns its own position. All that matters is that it
     travels and that a thumb over it still scrolls the page. */
  const marquee = rest.animated;
  if (marquee) {
    problems.push(
      ...(rest.firstLeft === end.firstLeft
        ? ["the row carries an animation but its items never move"]
        : []),
    );
  } else {
    if (!moved) problems.push("a real touch drag does not move the row at all");
    if (band > 1)
      problems.push(
        `dragging past the end opens ${band}px of empty section (rubber-band). Swiper: \`resistanceRatio: 0\` — NOT \`resistance: false\`, which removes the damping instead of the travel`,
      );
    if (Math.abs(short) > 4)
      problems.push(
        `the last item stops ${short}px from where the row ends (empty right ${end.emptyRight}, row inset ${inset}) — the row's own model of its width is wrong (a CSS \`gap\` a library cannot see is the usual cause)`,
      );
    if (!backMoved)
      problems.push(
        `dragging back does not move the row at all (${rest.firstLeft} → ${back.firstLeft}) — a stuck animating flag is the usual cause`,
      );
  }
  const scrolled = up
    ? afterVertical.scrollY > rest.scrollY
    : afterVertical.scrollY < rest.scrollY;
  if (!scrolled)
    problems.push(
      `a vertical swipe over the row does not scroll the page (${rest.scrollY} → ${afterVertical.scrollY}, swiped ${up ? "up" : "down"} ${travel}) — the row is claiming the gesture (\`touch-action: pan-y\`)`,
    );

  console.log(
    problems.length
      ? `\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`
      : `\nDrag is sound: it moves, it stops flush at both ends with no empty strip mid-gesture, it returns, and the page still scrolls through it.`,
  );
  process.exit(problems.length ? 1 : 0);
}

/* ── proportions ──────────────────────────────────────────────────────────── */

/* Reads the page at one narrow width and returns every disproportion it can
   measure. Written as one in-page function because each check needs the same
   walk, and because the interesting ones need to move the page (scroll a row
   to both ends) or the pointer (hover a card) before they can be read. */
const PROPORTIONS_READ = ({ tall, measure, tap }) => `async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const name = (el) => String(el.className || el.tagName).trim().slice(0, 44) || el.tagName;
  const box = (el) => el.getBoundingClientRect();
  const out = { crop: [], tallMedia: [], rows: [], stacking: [], taps: [], measure: [] };

  /* 1. A window that stopped cropping. \`aspect-ratio\` on the window plus a
        percentage height on the image is indefinite: the photo's own ratio
        wins and the box grows. Costs 238px on a portrait export. */
  for (const img of document.images) {
    const p = img.parentElement;
    if (!p) continue;
    const ar = getComputedStyle(p).aspectRatio;
    const m = ar && ar.match(/([\\d.]+)\\s*\\/\\s*([\\d.]+)/);
    if (!m) continue;
    const r = box(p);
    const want = r.width * (Number(m[2]) / Number(m[1]));
    if (Math.abs(r.height - want) > 1.5) {
      out.crop.push({ el: name(p), ratio: ar, width: Math.round(r.width), height: Math.round(r.height), expected: Math.round(want) });
    }
  }

  /* 2. A photo that eats the window. The frame's portrait crop at container
        width is half a screen on a phone; the window has to crop wider. */
  for (const img of document.images) {
    const r = box(img.parentElement ?? img);
    if (r.width < innerWidth * 0.6) continue;
    const share = r.height / innerHeight;
    if (share > ${tall}) {
      out.tallMedia.push({ el: name(img.parentElement ?? img), height: Math.round(r.height), share: +share.toFixed(2) });
    }
  }

  /* 3. A scroll row's two ends. Measured at both extremes, because the fault
        is asymmetry: inset at the start, flush against the glass at the end. */
  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    if (!/auto|scroll/.test(cs.overflowX)) continue;
    if (el.scrollWidth - el.clientWidth < 8) continue;
    const items = [...el.children].filter((c) => box(c).width > 0);
    if (items.length < 2) continue;
    const keep = el.scrollLeft;
    el.scrollLeft = 0;
    await wait(120);
    const start = box(items[0]).left - box(el).left;
    el.scrollLeft = el.scrollWidth;
    await wait(220);
    const end = box(el).right - box(items.at(-1)).right;
    el.scrollLeft = keep;
    out.rows.push({ el: name(el), startInset: Math.round(start), endInset: Math.round(end), snap: cs.scrollSnapType, scrollPadding: cs.scrollPaddingInlineStart + " / " + cs.scrollPaddingInlineEnd });
  }

  /* 4. A hover transform that paints over its own scrim. A scaled sibling
        joins the transformed paint layer, which sits above every un-layered
        sibling — the overlay disappears exactly while the reader looks at it.
        Read out of the stylesheets, because a hover state cannot be measured
        without one. */
  const hoverTargets = new Set();
  for (const sheet of document.styleSheets) {
    let rules = [];
    try { rules = [...sheet.cssRules]; } catch { continue; }
    const walk = (list) => {
      for (const rule of list) {
        if (rule.cssRules) { walk([...rule.cssRules]); continue; }
        if (!rule.selectorText || !rule.selectorText.includes(":hover")) continue;
        const style = rule.style;
        if (!(style.scale || style.transform || style.translate)) continue;
        for (const part of rule.selectorText.split(",")) {
          const plain = part.replace(/:hover/g, "").trim();
          if (!plain) continue;
          try { document.querySelectorAll(plain).forEach((el) => hoverTargets.add(el)); } catch {}
        }
      }
    };
    walk(rules);
  }
  for (const el of hoverTargets) {
    if (getComputedStyle(el).zIndex !== "auto") continue;
    for (const sib of [...(el.parentElement?.children ?? [])]) {
      if (sib === el) continue;
      const scs = getComputedStyle(sib);
      if (!/gradient/.test(scs.backgroundImage)) continue;
      if (scs.zIndex !== "auto") continue;
      out.stacking.push({ transformed: name(el), scrim: name(sib) });
    }
  }

  /* 5. A control smaller than a fingertip. A visually hidden control — the
        1x1 sr-only submit every accessible form carries — is not a tap
        target, so it is skipped rather than reported forever. */
  for (const el of document.querySelectorAll("a, button, input, select, textarea, [role=button]")) {
    const r = box(el);
    if (!r.width || !r.height) continue;
    if (el.closest("[aria-hidden=true]")) continue;
    const cs = getComputedStyle(el);
    const hidden = (r.width <= 2 && r.height <= 2) || cs.clipPath !== "none" || cs.clip !== "auto";
    if (hidden) continue;
    if (r.height >= ${tap} || r.width >= ${tap}) continue;
    out.taps.push({ el: name(el), width: Math.round(r.width), height: Math.round(r.height) });
  }

  /* 6. A line of text too long to read. Measured off the text itself, not its
        box: a one-word label in a 686-wide block is not an 114-character
        line, and reporting it as one buries the real finding. Only a block
        whose text actually fills its box counts. */
  const range = document.createRange();
  for (const el of document.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6")) {
    if (!el.textContent.trim()) continue;
    const r = box(el);
    if (r.width < 40) continue;
    range.selectNodeContents(el);
    const text = range.getBoundingClientRect().width;
    if (text < r.width * 0.9) continue;
    const cs = getComputedStyle(el);
    const ch = r.width / (parseFloat(cs.fontSize) * 0.5);
    if (ch > ${measure}) out.measure.push({ el: name(el), width: Math.round(r.width), ch: Math.round(ch) });
  }

  return out;
}`;

async function proportions(opts) {
  const widths = String(opts.widths ?? "1024,834,768,640,480,375,320")
    .split(",")
    .map((n) => Number(n.trim()))
    .filter(Boolean);
  const read = PROPORTIONS_READ({
    tall: Number(opts.tall ?? 0.6),
    measure: Number(opts.measure ?? 100),
    tap: Number(opts.tap ?? 40),
  });
  const { call, close } = await browser();
  let failed = 0;
  for (const w of widths) {
    await open(call, {
      route: opts.route ?? "/",
      width: w,
      height: Number(opts.height ?? 812),
      touch: w < 1024,
      reduce: opts.reduce,
    });
    const r = await evaluate(call, read);
    const lines = [];
    for (const c of r.crop)
      lines.push(`crop defeated   ${c.el} is ${c.width}x${c.height}, its own ${c.ratio} wants ${c.expected} — the image is sizing the window`);
    for (const t of r.tallMedia)
      lines.push(`media too tall  ${t.el} is ${t.height} = ${Math.round(t.share * 100)}% of the window — crop wider at this width`);
    for (const row of r.rows) {
      if (Math.abs(row.startInset - row.endInset) > 4)
        lines.push(`row lopsided    ${row.el} starts ${row.startInset} from its edge and ends ${row.endInset} — one end is glued to the glass (padding-inline + scroll-padding-inline on the scroller)`);
    }
    for (const s of r.stacking)
      lines.push(`scrim outranked ${s.transformed} scales on hover with z-index auto, so it paints over ${s.scrim} — order them explicitly`);
    for (const t of r.taps)
      lines.push(`tap target      ${t.el} is ${t.width}x${t.height}`);
    for (const m of r.measure)
      lines.push(`line too long   ${m.el} runs ${m.ch}ch (${m.width}px)`);
    failed += lines.length;
    console.log(
      `\n${String(w).padStart(5)}  ${lines.length ? `${lines.length} finding(s)` : "proportional"}` +
        (r.rows.length
          ? `\n       rows: ${r.rows.map((row) => `${row.el} ${row.startInset}/${row.endInset}`).join(", ")}`
          : ""),
    );
    for (const line of lines) console.log(`       ${line}`);
  }
  close();
  console.log(
    failed
      ? `\n${failed} finding(s) across ${widths.length} width(s). The design never drew these widths — every number above is still a decision someone has to make on purpose.`
      : `\nProportional at every audited width: every crop window holds its ratio, no photo takes more than its share of the screen, both ends of every scroll row match, no hover transform outranks a scrim, every control is thumb-sized and no line runs long.`,
  );
  process.exit(failed ? 1 : 0);
}

/* ── eval ─────────────────────────────────────────────────────────────────── */

async function evalCmd(opts) {
  const fn = opts.file
    ? readFileSync(opts.file, "utf8")
    : (opts.expr ?? die("eval needs --expr or --file"));
  const width = Number(opts.width ?? 375);
  const { call, close } = await browser();
  await open(call, {
    route: opts.route ?? "/",
    width,
    height: Number(opts.height ?? 812),
    touch: width < 1024,
    reduce: opts.reduce,
  });
  try {
    console.log(JSON.stringify(await evaluate(call, fn.trim()), null, 1));
  } finally {
    close();
  }
}

const [cmd] = process.argv.slice(2);
const opts = args(process.argv.slice(3));
if (opts.help || !cmd || cmd === "--help" || cmd === "-h") {
  console.log(
    readFileSync(new URL(import.meta.url))
      .toString()
      .slice(0, 3400),
  );
  process.exit(0);
}
if (cmd === "overflow") await overflow(opts);
else if (cmd === "drag") await drag(opts);
else if (cmd === "proportions") await proportions(opts);
else if (cmd === "eval") await evalCmd(opts);
else
  die(`unknown command: ${cmd}. Try overflow, drag, proportions or eval.`);
