/**
 * Parks the book at a sweep of raw clip times and writes one screenshot each,
 * so the authored animation can be read frame by frame.
 *
 *   node scripts/sweep-clip.mjs 0 0.8 1.6 2.4 ...
 *
 * With no arguments it walks the whole clip in 14 steps.
 */
import fs from "node:fs";
import path from "node:path";

const DEBUG_PORT = 9224;
const PAGE_URL = "http://localhost:3000";
const OUT_DIR = ".scratch/sweep";
const DURATION = JSON.parse(fs.readFileSync("public/model/book.pages.json", "utf8")).duration;

const times = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
const wanted = times.length
  ? times
  : Array.from({ length: 14 }, (_, i) => Number(((i / 13) * DURATION).toFixed(3)));

const target = await (
  await fetch(`http://localhost:${DEBUG_PORT}/json/new?${PAGE_URL}`, { method: "PUT" })
).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
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
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true })).result.result.value;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: Number(process.env.SHOT_WIDTH ?? 1200),
  height: Number(process.env.SHOT_HEIGHT ?? 800),
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url: PAGE_URL });

const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  await wait(1000);
  if (await evaluate("typeof window.__bookScrub === 'function'")) break;
}
await wait(2000);

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

for (const time of wanted) {
  await evaluate(`window.__bookScrub(${time})`);
  await wait(450);
  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const file = path.join(OUT_DIR, `t-${String(time).replace(".", "_")}.png`);
  fs.writeFileSync(file, Buffer.from(shot.result.data, "base64"));
  console.log("  wrote", file);
}
ws.close();
