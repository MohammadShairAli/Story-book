/**
 * Drives the running dev server through Chrome's debug protocol and writes a
 * screenshot per page-turn stop, so the book can be checked visually.
 *
 *   node scripts/inspect-page.mjs [stops...]      e.g. node scripts/inspect-page.mjs 0 1 2
 *
 * Requires `next dev` on :3000 and Chrome listening on :9224.
 */
import fs from "node:fs";
import path from "node:path";

const DEBUG_PORT = 9224;
const PAGE_URL = "http://localhost:3000";
const OUT_DIR = ".scratch/shots";
const WIDTH = Number(process.env.SHOT_WIDTH ?? 1440);
const HEIGHT = Number(process.env.SHOT_HEIGHT ?? 900);
const TURN_WAIT = Number(process.env.SHOT_WAIT ?? 2200);

const stops = process.argv.slice(2).map(Number).filter(Number.isInteger);
const wanted = stops.length ? stops : [0, 1, 2, 3, 4, 5, 6, 7];

const target = await (
  await fetch(`http://localhost:${DEBUG_PORT}/json/new?${PAGE_URL}`, { method: "PUT" })
).json();

const ws = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
const consoleLines = [];

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
    return;
  }
  if (message.method === "Runtime.consoleAPICalled") {
    const text = (message.params.args ?? [])
      .map((arg) => arg.value ?? arg.description ?? arg.type)
      .join(" ");
    consoleLines.push(`[${message.params.type}] ${text}`);
  }
  if (message.method === "Runtime.exceptionThrown") {
    consoleLines.push(`[error] ${message.params.exceptionDetails.text} ${
      message.params.exceptionDetails.exception?.description ?? ""
    }`);
  }
};

await new Promise((resolve) => {
  ws.onopen = resolve;
});

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const message = { id: ++nextId, method, params };
    pending.set(message.id, resolve);
    ws.send(JSON.stringify(message));
  });

const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.result?.exceptionDetails) {
    throw new Error(result.result.exceptionDetails.text);
  }
  return result.result.result.value;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url: PAGE_URL });

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

/* Wait for the loader overlay to clear. */
const deadline = Date.now() + 90_000;
let ready = false;
while (Date.now() < deadline) {
  await wait(1000);
  ready = await evaluate(
    `(() => {
       const canvas = document.querySelector("canvas");
       if (!canvas) return false;
       const text = document.body.innerText || "";
       return !text.includes("Opening the book") || text.includes("100%");
     })()`,
  ).catch(() => false);
  if (ready) break;
}
console.log(ready ? "page ready" : "TIMED OUT waiting for load");
await wait(2500);

const shoot = async (name) => {
  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const file = path.join(OUT_DIR, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.result.data, "base64"));
  return file;
};

const clickPip = (index) =>
  evaluate(
    `(() => {
       const pips = [...document.querySelectorAll('button[data-stop]')];
       const pip = pips[${index}];
       if (!pip) return "no pip " + ${index} + " of " + pips.length;
       pip.click();
       return "clicked " + pip.getAttribute("aria-label");
     })()`,
  );

let current = 0;
for (const wantedStop of wanted) {
  if (wantedStop !== current) {
    console.log(" ", await clickPip(wantedStop));
    await wait(TURN_WAIT);
    current = wantedStop;
  }
  console.log("  wrote", await shoot(`stop-${wantedStop}`));
}

const summary = await evaluate(
  `(() => {
     const canvas = document.querySelector("canvas");
     const rect = canvas?.getBoundingClientRect();
     return {
       title: document.title,
       canvas: rect && { w: Math.round(rect.width), h: Math.round(rect.height) },
       drawing: canvas && { w: canvas.width, h: canvas.height },
       text: (document.body.innerText || "").replace(/\\n+/g, " | ").slice(0, 240),
     };
   })()`,
);

console.log("\nsummary", JSON.stringify(summary, null, 2));
if (consoleLines.length) {
  console.log("\nconsole:");
  for (const line of consoleLines.slice(-40)) console.log("  " + line);
}
ws.close();
