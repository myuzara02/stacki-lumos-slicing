/**
 * Proves a sliced page matches the Figma frame it came from.
 *
 * `lumos-import-figma/convert.mjs` checks the numbers; this checks the picture.
 * A page can use every right token and still be wrong: a section 40px too
 * tall, a heading wrapping one word early, a grid whose gap ate the last
 * column. None of that shows up in a token table, all of it shows up in an
 * overlay.
 *
 * Captures with headless Chrome and compares with sharp — both already
 * present in an Astro project on a Mac, so the check adds no dependencies.
 *
 * Usage
 *   node overlay-figma.mjs --ref design/hero-1440.png --route / --width 1440
 *   node overlay-figma.mjs --ref design/hero-390.png  --route / --width 390 --threshold 3
 *
 * Options
 *   --ref <png>        Figma export of the frame. Any scale; it is resized to --width.
 *   --route <path>     Route to capture. Default "/".
 *   --width <px>       CSS width to capture at. Default: the frame's own width.
 *   --base <url>       Dev server. Default http://localhost:4321 (LUMOS_BASE overrides).
 *   --threshold <pct>  Share of pixels allowed to differ. Default 2.
 *   --tolerance <n>    Per-channel wobble treated as noise. Default 12.
 *   --out <dir>        Where images go. Default .lumos-slice.
 *   --name <label>     Filename stem. Default derived from route and width.
 *   --keep-scroll      Leave scrollbars in the capture (default hides them).
 *
 * Writes three images and exits non-zero while the page still differs:
 *   <name>--build.png    what the browser drew
 *   <name>--blend.png    design and build at 50% — the classic slicing overlay
 *   <name>--diff.png     every differing pixel in red on a dimmed build
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => existsSync(p));

/* A band tall enough to hold a line of text, so a report line points at a
   thing on the page rather than at a stripe of one. */
const BAND = 64;
/* How far to hunt for a whole-page nudge. Beyond this it is not a nudge. */
const SHIFT = 120;

function args(argv) {
  const flags = { boolean: new Set(["keep-scroll", "reduce", "help"]) };
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) die(`unexpected argument: ${a}`);
    const key = a.slice(2);
    if (flags.boolean.has(key)) out[key] = true;
    else {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) die(`--${key} needs a value`);
      out[key] = v;
    }
  }
  return out;
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

const opts = args(process.argv.slice(2));

if (opts.help || !opts.ref) {
  console.log(
    [
      "usage: node overlay-figma.mjs --ref <figma.png> [--route /] [--width 1440]",
      "               [--base http://localhost:4321] [--threshold 2] [--tolerance 12]",
      "               [--out .lumos-slice] [--name label] [--keep-scroll]",
    ].join("\n"),
  );
  process.exit(opts.ref ? 0 : 1);
}
if (!existsSync(opts.ref)) die(`no such reference image: ${opts.ref}`);
if (!CHROME)
  die("No Chrome/Chromium/Edge found. Install one, or overlay by hand.");

/* `sharp` belongs to the project being measured, not to this skill: the skill
   is installed once at user level and has no `node_modules` of its own. A bare
   `import "sharp"` resolves against THIS file and fails with
   ERR_MODULE_NOT_FOUND in every project, so resolve it from the working
   directory — which is the project — and say what to do if it is absent. */
const sharp = await (async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(join(process.cwd(), "package.json"));
  for (const from of [() => require.resolve("sharp"), () => "sharp"]) {
    try {
      const mod = await import(
        from() === "sharp" ? "sharp" : `file://${from()}`
      );
      return mod.default ?? mod;
    } catch {}
  }
  return die(
    "sharp is not installed in this project — `npm i -D sharp`, then run this again.",
  );
})();

const route = opts.route ?? "/";
const base = opts.base ?? process.env.LUMOS_BASE ?? "http://localhost:4321";
const outDir = opts.out ?? ".lumos-slice";
const threshold = Number(opts.threshold ?? 2) / 100;
const tolerance = Number(opts.tolerance ?? 12);
if (!Number.isFinite(threshold) || threshold < 0)
  die("--threshold must be a percentage");
if (!Number.isFinite(tolerance) || tolerance < 0)
  die("--tolerance must be a number");

/* The frame is the design's own pixel size only when it was exported at 1x.
   Whatever it was exported at, --width is what the page is asked to be, and
   the design is scaled to meet it. */
const refMeta = await sharp(opts.ref).metadata();
const width = Math.round(Number(opts.width ?? refMeta.width));
if (!Number.isFinite(width) || width < 64)
  die(`--width looks wrong: ${opts.width}`);
/* A floor of one band would pad a short frame — a 38px announcement strip —
   with rows the design does not have, and charge the page below it as a
   difference. Compare exactly the frame's own height. */
const height = Math.max(
  8,
  Math.round((refMeta.height * width) / refMeta.width),
);
const scale = width / refMeta.width;

const name =
  opts.name ??
  `${route === "/" ? "index" : route.replace(/^\//, "").replace(/[/?#]+/g, "-")}--${width}`;

mkdirSync(outDir, { recursive: true });
const buildPng = join(outDir, `${name}--build.png`);
const blendPng = join(outDir, `${name}--blend.png`);
const diffPng = join(outDir, `${name}--diff.png`);

console.log(
  `design ${refMeta.width}×${refMeta.height}` +
    (scale === 1 ? "" : ` exported at ${(1 / scale).toFixed(2)}x`) +
    ` -> comparing at ${width}×${height}`,
);

/* Capture through a viewport the size of the frame, scrolled so the frame's
   own content starts at the top. Two rules make this the only honest way:
   `100svh` means the viewport, so a window as tall as a whole 10,000px page
   turns a viewport-height hero into a 10,000px hero; and a full-page shot
   taken "beyond the viewport" hits the same problem plus sticky elements.
   One frame at a time, at the frame's own height, keeps both truthful.

   `--scroll` is where the frame sits in the page, in CSS px. */
const viewportHeight = Math.max(
  320,
  Math.round(Number(opts["viewport-height"] ?? Math.min(height, 900))),
);
let scrollTo = Math.max(0, Math.round(Number(opts.scroll ?? 0)));
/* The pinned bar belongs to the top frame and to nothing below it. With
   `--selector` the scroll target is not known until the page is open, so a
   selector naming anything but the strip at the very top counts as below. */
const hideNav =
  scrollTo > 0 || (Boolean(opts.selector) && opts.selector !== ".announcement");
async function capture() {
  const port = 9222 + (process.pid % 500);
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      ...(opts["keep-scroll"] ? [] : ["--hide-scrollbars"]),
      "--force-device-scale-factor=1",
      `--remote-debugging-port=${port}`,
      "--user-data-dir=" + mkdtempSync(join(tmpdir(), "overlay-figma-")),
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
    throw new Error("Chrome never opened its debugging port");
  })();

  const ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let next = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error
        ? reject(new Error(message.error.message))
        : resolve(message.result);
    } else if (message.method) {
      events.push(message.method);
    }
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
  await call("Emulation.setDeviceMetricsOverride", {
    width,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: false,
  });

  /* `--reduce` measures LAYOUT rather than the moment: a scroll-scrubbed
     section has no single resting state to compare a frame against, and under
     reduced motion the site renders those sections statically. Use it to prove
     a scrubbed section still lands on its frame, and say so in the report. */
  if (opts.reduce) {
    await call("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
  }

  await call("Page.navigate", { url: `${base}${route}` });

  /* Wait for the load event, then give lazy images and webfonts a moment —
     a font that swaps after the shot moves every line in the diff. */
  for (let i = 0; i < 150 && !events.includes("Page.loadEventFired"); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  /* Wait for the load event, then settle: scroll the whole page once so lazy
     images decode, come back, and let the webfonts land. A font that swaps
     after the shot moves every line in the diff. */
  await call("Runtime.evaluate", {
    expression: `(async () => {
      /* The dev server's own toolbar is a fixed pill at the bottom of the
         viewport. It is not the page, and it lands in every shot whose crop
         reaches the viewport's bottom edge, so it reads as a differing band
         nobody can fix in a component.

         A pinned nav is the same problem with a different cause: it belongs
         to the frame at the top of the page and to nothing below it, so it
         paints itself across every mid-page tile. Hidden only when the frame
         being measured is NOT the top of the page, so the hero still gets
         measured with its own bar. */
      const hide = document.createElement("style");
      hide.textContent = [
        "astro-dev-toolbar, #dev-toolbar-root, [data-astro-dev-toolbar] { display: none !important; }",
        ${hideNav ? '".header_wrap, .nav_wrap.overlap, .nav_wrap[class*=fixed] { display: none !important; }"' : '""'},
        /* A page that fades itself in and reveals that slide their blocks up
           are both MID-ANIMATION while a tile is captured — and a block that
           has not been scrolled past yet is still fully transparent.
           Measured: the ticker read 86.70% and the footer landed 66px out
           purely from this. The frame draws the resting state, so the capture
           pins the resting state: the reveal's own end values, forced, for
           the length of the read — the same reason --reduce exists. */
        "body { opacity: 1 !important; }",
        "[data-scroll-animation] { opacity: 1 !important; transform: none !important; translate: none !important; rotate: none !important; scale: none !important; }",
      ].join("");
      document.head.append(hide);
      /* A STICKY header is as much of a phantom as a fixed one: it stays in
         flow, so it passes the class-name filter above, and then paints its
         whole band across every mid-page tile — measured, it cost the footer
         33px of false offset and every mid-page section about 3%. Hidden by
         computed position rather than by name, for the frames that are not
         the top of the page. */
      ${
        hideNav
          ? `const measured = document.querySelector(${JSON.stringify(opts.selector || "#__no_selector__")});
      for (const el of document.querySelectorAll("body > *, body > * > *")) {
        if (measured && (el === measured || el.contains(measured) || measured.contains(el))) continue;
        const cs = getComputedStyle(el);
        if ((cs.position === "sticky" || cs.position === "fixed") && el.getBoundingClientRect().top < 8) {
          el.style.setProperty("visibility", "hidden", "important");
        }
      }`
          : ""
      }
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 500));
      window.scrollTo(0, 0);
      await document.fonts.ready;
      await new Promise(r => setTimeout(r, 300));
      let target = ${scrollTo};
      const selector = ${JSON.stringify(opts.selector ?? "")};
      if (selector) {
        const el = document.querySelector(selector);
        if (!el) throw new Error("no element matches " + selector);
        /* A sticky element reports its STUCK offset, not its flow position —
           the footer that uncovers reads y=1 while it sits at 9800. Pin it
           static for the length of one read, then put it back. */
        const wasPosition = el.style.position;
        const stuck = getComputedStyle(el).position;
        if (stuck === "sticky" || stuck === "fixed") el.style.position = "static";
        target = Math.round(el.getBoundingClientRect().top + window.scrollY);
        el.style.position = wasPosition;
      }
      return [document.body.scrollHeight, target];
    })()`,
    awaitPromise: true,
    returnByValue: true,
  }).then(({ result }) => {
    const [pageHeight, target] = result.value ?? [];
    scrollTo = target ?? scrollTo;
    console.log(
      `page    ${width}×${pageHeight} rendered, viewport ${width}×${viewportHeight}, frame at y=${scrollTo}`,
    );
  });

  /* Shoot the frame as tiles through a viewport a reader would actually have,
     then stitch. Capturing a tall frame through an equally tall window would
     be simpler, but `100svh` means the viewport: a hero sized against it
     grows, everything below it shifts, and the diff reports a whole-page
     nudge that does not exist on a real screen. */
  const tiles = [];
  for (let top = 0; top < height; top += viewportHeight) {
    const { result } = await call("Runtime.evaluate", {
      expression: `(async () => {
        window.scrollTo(0, ${scrollTo + top});
        await new Promise(r => setTimeout(r, 250));
        /* Astro's images are lazy with sizes="auto", so the candidate is only
           chosen once the image is in view — shoot too early and a photograph
           comes back as a blank box, which reads as a huge differing band
           nobody can fix in a component. Only wait for the images this tile
           actually shows, and race each one: decode() on a lazy image that
           has never entered the viewport never settles at all. */
        const visible = [...document.images].filter((img) => {
          const r = img.getBoundingClientRect();
          return r.bottom > 0 && r.top < innerHeight && r.width > 0;
        });
        await Promise.all(
          visible.map((img) =>
            img.complete
              ? 0
              : Promise.race([
                  img.decode().catch(() => 0),
                  new Promise((r) => setTimeout(r, 1500)),
                ]),
          ),
        );
        await new Promise(r => setTimeout(r, 150));
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return Math.round(window.scrollY);
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const shot = await call("Page.captureScreenshot", {
      format: "png",
      optimizeForSpeed: false,
    });
    tiles.push({ at: result.value, data: Buffer.from(shot.data, "base64") });
  }

  if (tiles.length === 1) {
    writeFileSync(buildPng, tiles[0].data);
  } else {
    console.log(
      `        stitched from ${tiles.length} tiles at y=${tiles.map((t) => t.at).join(", ")}`,
    );
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: "#ffffff",
      },
    })
      .composite(
        tiles.map((tile) => ({
          input: tile.data,
          left: 0,
          top: Math.max(0, tile.at - scrollTo),
        })),
      )
      .png()
      .toFile(buildPng);
  }

  ws.close();
  chrome.kill();
}

await capture().catch((e) =>
  die(`capture of ${base}${route} failed — ${e.message}`),
);
console.log(`build   ${relative(process.cwd(), buildPng)}`);

/* Force both to the same size and to RGB. A screenshot saved as RGB and a
   Figma export saved as RGBA decode to different strides, and indexing one
   buffer with the other's stride misreads every pixel — which reads as a
   total mismatch rather than the nudge it actually was. Figma exports
   transparency where the frame has no fill; flatten it to white, which is
   what the browser paints there. */
const geometry = { width, height, fit: "cover", position: "left top" };
const [design, build] = await Promise.all([
  sharp(opts.ref)
    .flatten({ background: "#ffffff" })
    .resize(geometry)
    .removeAlpha()
    .raw()
    .toBuffer(),
  sharp(buildPng)
    .flatten({ background: "#ffffff" })
    .resize(geometry)
    .removeAlpha()
    .raw()
    .toBuffer(),
]);

const total = width * height;
const diff = Buffer.alloc(total * 3);
const bands = Array.from({ length: Math.ceil(height / BAND) }, () => 0);
let changed = 0;
let top = height;
let bottom = -1;
let left = width;
let right = -1;

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 3;
    const delta = Math.max(
      Math.abs(design[p] - build[p]),
      Math.abs(design[p + 1] - build[p + 1]),
      Math.abs(design[p + 2] - build[p + 2]),
    );
    if (delta > tolerance) {
      changed++;
      bands[(y / BAND) | 0]++;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
      diff[p] = 255;
      diff[p + 1] = 0;
      diff[p + 2] = 0;
    } else {
      /* Dimmed build underneath, so the red marks sit on recognisable page
         rather than on a blank field. */
      const grey = Math.round(build[p] * 0.25 + 200 * 0.75);
      diff[p] = diff[p + 1] = diff[p + 2] = grey;
    }
  }
}

/* A whole-page offset is the most common slicing miss and the least visible
   in a percentage: one wrong padding at the top moves every section below it,
   and the diff lights up the entire page. Correlating the row and column
   profiles says "everything is 12px low" instead, which is one fix. */
function profile(buf, along) {
  const outer = along === "row" ? height : width;
  const inner = along === "row" ? width : height;
  const sig = new Float64Array(outer);
  for (let o = 0; o < outer; o++) {
    let sum = 0;
    for (let i = 0; i < inner; i++) {
      const p = (along === "row" ? o * width + i : i * width + o) * 3;
      sum += buf[p] * 0.299 + buf[p + 1] * 0.587 + buf[p + 2] * 0.114;
    }
    sig[o] = sum / inner;
  }
  return sig;
}

function bestShift(a, b) {
  const n = a.length;
  const reach = Math.min(SHIFT, (n / 4) | 0);
  let best = 0;
  let bestCost = Infinity;
  for (let s = -reach; s <= reach; s++) {
    let cost = 0;
    let count = 0;
    for (let i = Math.max(0, -s); i < Math.min(n, n - s); i++) {
      cost += Math.abs(a[i] - b[i + s]);
      count++;
    }
    if (!count) continue;
    cost /= count;
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = s;
    }
  }
  return { shift: best, cost: bestCost };
}

const share = changed / total;
const vertical = bestShift(profile(design, "row"), profile(build, "row"));
const horizontal = bestShift(profile(design, "col"), profile(build, "col"));

await Promise.all([
  sharp(diff, { raw: { width, height, channels: 3 } })
    .png()
    .toFile(diffPng),
  sharp(design, { raw: { width, height, channels: 3 } })
    .composite([
      {
        input: await sharp(build, { raw: { width, height, channels: 3 } })
          .ensureAlpha(0.5)
          .png()
          .toBuffer(),
      },
    ])
    .png()
    .toFile(blendPng),
]);
console.log(`blend   ${relative(process.cwd(), blendPng)}`);
console.log(`diff    ${relative(process.cwd(), diffPng)}\n`);

console.log(
  `differing pixels  ${(share * 100).toFixed(2)}%  (tolerance ±${tolerance}/channel)`,
);
if (changed) {
  console.log(`differing region  x ${left}–${right}, y ${top}–${bottom}`);
}
const nudge = (label, { shift }, axis) =>
  shift === 0
    ? `${label} aligned`
    : `${label} off by ${Math.abs(shift)}px — the build sits ${
        axis === "y"
          ? shift > 0
            ? "low"
            : "high"
          : shift > 0
            ? "right"
            : "left"
      } of the design`;
console.log(nudge("vertically  ", vertical, "y"));
console.log(nudge("horizontally", horizontal, "x"));
if (vertical.shift !== 0 || horizontal.shift !== 0) {
  console.log(
    "A whole-page offset is one wrong value near the top. Fix that before reading the bands.",
  );
}

const worst = bands
  .map((count, i) => ({
    from: i * BAND,
    to: Math.min(height, (i + 1) * BAND),
    count,
  }))
  .filter((b) => b.count > 0)
  .map((b) => ({ ...b, share: b.count / (width * (b.to - b.from)) }))
  .sort((a, b) => b.share - a.share)
  .slice(0, 8);

if (worst.length) {
  console.log(
    "\nworst bands (y range in CSS px, share of that band differing)",
  );
  for (const b of worst) {
    const bar = "#".repeat(Math.max(1, Math.round(b.share * 40)));
    console.log(
      `  ${String(b.from).padStart(5)}–${String(b.to).padEnd(5)} ${(b.share * 100).toFixed(1).padStart(5)}%  ${bar}`,
    );
  }
}

const pass =
  share <= threshold && vertical.shift === 0 && horizontal.shift === 0;
console.log(
  pass
    ? `\nMatches within ${(threshold * 100).toFixed(1)}% and no offset. Still look at the blend before calling it done.`
    : `\nNot 1:1 yet. Open the blend and the diff, fix the largest band, run this again.`,
);
process.exit(pass ? 0 : 1);
