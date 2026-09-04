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
 * Three commands, because three questions kept coming back:
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
  /* The row is the widest thing that either overflows its own box, carries a
     transform, or is scrolled — and that has a line of visible children to
     measure. Anything else in the section (a wrapper, a hidden node, an SVG)
     can score on one of those and measure to nonsense, so all three have to
     hold at once. */
  let mover = null, best = 0;
  for (const el of [sec, ...sec.querySelectorAll("*")]) {
    const items = kids(el);
    if (items.length < 2) continue;
    const tx = Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
    const overflowing = el.scrollWidth - el.clientWidth > 8 || tx > 0 || el.scrollLeft > 0;
    if (!overflowing) continue;
    const extent = items.at(-1).getBoundingClientRect().right - items[0].getBoundingClientRect().left;
    if (extent > best) { best = extent; mover = el; }
  }
  if (!mover) throw new Error("nothing in " + ${JSON.stringify(selector)} + " moves sideways — is this the right section?");
  const list = ${items ? `[...document.querySelectorAll(${JSON.stringify(items)})].filter((c) => c.getBoundingClientRect().width > 0)` : "kids(mover)"};
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

  /* Put the row in the middle of the window rather than at the top: a finger
     landing on a sticky bar drags the bar, and the report blames the row. */
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
  const y = Math.round(height * 0.6);
  const touch = (type, x) =>
    call("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });

  /** One drag, sampled while the finger is still down. */
  const stroke = async (from, dx) => {
    let worst = null;
    await touch("touchStart", from);
    for (let i = 1; i <= steps; i++) {
      await touch("touchMove", from + Math.round((dx * i) / steps));
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

  for (let i = 0; i < repeat; i++) {
    const { worst, settled } = await stroke(
      Math.round(width * 0.85),
      -distance,
    );
    overshoot = Math.max(overshoot, worst.emptyRight);
    if (settled.lastRight !== rest.lastRight) moved = true;
    rows.push([`left ${i + 1} mid`, worst], [`left ${i + 1}`, settled]);
  }
  const end = rows.at(-1)[1];
  for (let i = 0; i < repeat; i++) {
    const { worst, settled } = await stroke(Math.round(width * 0.15), distance);
    rows.push([`right ${i + 1} mid`, worst], [`right ${i + 1}`, settled]);
  }
  const back = rows.at(-1)[1];

  /* A row that eats vertical gestures is worse than a row that does not move:
     the page stops scrolling wherever the reader's thumb happens to land. */
  await touch("touchStart", Math.round(width * 0.5));
  for (let i = 1; i <= steps; i++) {
    await call("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: Math.round(width * 0.5), y: y - Math.round((320 * i) / steps) },
      ],
    });
    await new Promise((r) => setTimeout(r, 30));
  }
  await touch("touchEnd");
  await new Promise((r) => setTimeout(r, 900));
  const afterVertical = await at();
  close();

  const w = 14;
  console.log(`row: ${rest.mover}  viewport ${width}×${height}`);
  for (const [label, s] of rows) {
    console.log(
      `${label.padEnd(w)} first ${String(s.firstLeft).padStart(6)}  last ${String(s.lastRight).padStart(6)}  empty right ${String(s.emptyRight).padStart(5)}`,
    );
  }

  const problems = [];
  if (!moved) problems.push("a real touch drag does not move the row at all");
  if (overshoot > 1)
    problems.push(
      `dragging past the end opens ${overshoot}px of empty section (rubber-band). Swiper: \`resistanceRatio: 0\` — NOT \`resistance: false\`, which removes the damping instead of the travel`,
    );
  if (Math.abs(end.emptyRight) > 1)
    problems.push(
      `the last item stops ${end.emptyRight}px from the edge — the row's own model of its width is wrong (a CSS \`gap\` a library cannot see is the usual cause)`,
    );
  if (Math.abs(back.firstLeft - rest.firstLeft) > 1)
    problems.push(
      `dragging back does not return the row to its start (${rest.firstLeft} → ${back.firstLeft}) — a stuck animating flag is the usual cause`,
    );
  if (afterVertical.scrollY <= rest.scrollY)
    problems.push(
      "a vertical swipe over the row does not scroll the page — the row is claiming the gesture (`touch-action: pan-y`)",
    );

  console.log(
    problems.length
      ? `\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`
      : `\nDrag is sound: it moves, it stops flush at both ends with no empty strip mid-gesture, it returns, and the page still scrolls through it.`,
  );
  process.exit(problems.length ? 1 : 0);
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
if (opts.help || !cmd) {
  console.log(
    readFileSync(new URL(import.meta.url))
      .toString()
      .slice(0, 2600),
  );
  process.exit(0);
}
if (cmd === "overflow") await overflow(opts);
else if (cmd === "drag") await drag(opts);
else if (cmd === "eval") await evalCmd(opts);
else die(`unknown command: ${cmd}. Try overflow, drag or eval.`);
