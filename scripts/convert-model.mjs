/**
 * Converts model-source/book.glb (the Blender export, kept out of public/ so
 * the 58 MB original is never deployed) into a web-friendly, separated glTF:
 *
 *   public/model/book.gltf            scene graph + animation (readable JSON)
 *   public/model/book.bin             geometry + animation buffers
 *   public/model/textures/*.webp      one file per texture, swappable by hand
 *   public/model/book.pages.json      page-turn timeline derived from the rig
 *
 * Run with:  npm run model:convert
 */
import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { compressTexture, dedup, prune } from "@gltf-transform/functions";
import sharp from "sharp";

const SRC = "model-source/book.glb";
const OUT_DIR = "public/model";
const OUT = path.join(OUT_DIR, "book.gltf");
const MANIFEST = path.join(OUT_DIR, "book.pages.json");

/** Page artwork is a 2:1 double-page spread; this is its width budget. */
const SPREAD_MAX = 2560;
/** Everything else (button decals, logo, cover photo) stays small. */
const PROP_MAX = 1024;
const QUALITY = 92;

const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(SRC);
const root = document.getRoot();

console.log(`\nsource ${SRC}  ${mb(fs.statSync(SRC).size)}`);

/* ------------------------------------------------------------------ *
 * 1. Keep only the scene the file actually points at. This .glb
 *    carries a leftover "Cosmetic Product Visualization" scene that
 *    nothing references.
 * ------------------------------------------------------------------ */
const keptScene = root.getDefaultScene() ?? root.listScenes()[0];
for (const scene of root.listScenes()) {
  if (scene !== keptScene) {
    console.log(`  drop scene   "${scene.getName()}"`);
    scene.dispose();
  }
}

/* ------------------------------------------------------------------ *
 * 2. The export contains the same armature action twice. Keep one.
 * ------------------------------------------------------------------ */
for (const animation of root.listAnimations().slice(1)) {
  console.log(`  drop anim    "${animation.getName()}"`);
  animation.dispose();
}
const clip = root.listAnimations()[0];
clip.setName("PageTurns");

/* ------------------------------------------------------------------ *
 * 3. Derive the page-turn timeline from the rig.
 *
 *    The artist authored one continuous 11.7s take in which each spine
 *    bone rotates in turn. Finding each bone's motion window lets the
 *    front-end scrub exactly one turn per click instead of playing the
 *    whole take.
 * ------------------------------------------------------------------ */
const quatAngle = (w) => 2 * Math.acos(Math.min(1, Math.abs(w))) * (180 / Math.PI);

const segments = [];
for (const channel of clip.listChannels()) {
  if (channel.getTargetPath() !== "rotation") continue;
  const sampler = channel.getSampler();
  const times = sampler.getInput().getArray();
  const values = sampler.getOutput().getArray();
  if (times.length < 10) continue; // static bone, held with two keys

  let first = -1;
  let last = -1;
  let previous = quatAngle(values[3]);
  for (let i = 1; i < times.length; i++) {
    const angle = quatAngle(values[i * 4 + 3]);
    if (Math.abs(angle - previous) > 0.05) {
      if (first < 0) first = i - 1;
      last = i;
    }
    previous = angle;
  }
  if (first < 0) continue;

  segments.push({
    bone: channel.getTargetNode().getName(),
    start: Number(times[first].toFixed(4)),
    end: Number(times[last].toFixed(4)),
  });
}
segments.sort((a, b) => a.start - b.start);

/* Snap each stop to the midpoint of the gap between two segments, so a
 * scrub always lands on a settled pose with no visible hitch. */
const duration = Math.max(...segments.map((s) => s.end));
const stops = [0];
for (let i = 0; i < segments.length - 1; i++) {
  stops.push(Number(((segments[i].end + segments[i + 1].start) / 2).toFixed(4)));
}
stops.push(Number(duration.toFixed(4)));

console.log(`\n  animation "${clip.getName()}"  ${duration.toFixed(2)}s`);
segments.forEach((segment, i) => {
  console.log(
    `    step ${i}  bone "${segment.bone}"  ` +
      `${segment.start.toFixed(2)}s -> ${segment.end.toFixed(2)}s   ` +
      `scrub ${stops[i].toFixed(3)} -> ${stops[i + 1].toFixed(3)}`,
  );
});

/* ------------------------------------------------------------------ *
 * 4. Drop everything the kept scene no longer needs, and merge
 *    duplicate accessors / materials / textures.
 * ------------------------------------------------------------------ */
await document.transform(dedup(), prune());

/* ------------------------------------------------------------------ *
 * 5. Give every texture a readable name, so page artwork can later be
 *    replaced by dropping a new file into public/model/textures.
 *    Only the name is set here -- the URI has to wait until after
 *    re-encoding, because it is what tells glTF-Transform the format.
 * ------------------------------------------------------------------ */
const slug = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "texture";

const spreads = [];
for (const texture of root.listTextures()) {
  const name = texture.getName();
  const size = texture.getSize() ?? [0, 0];
  const isSpread = /^[1-6]$/.test(name) && size[0] > 2000;
  const base = isSpread ? `page-${name}` : slug(name);

  texture.setName(base);
  if (isSpread) spreads.push(base);

  console.log(
    `  texture      ${base.padEnd(26)} ${String(size[0]).padStart(5)}x${String(size[1]).padEnd(5)} ` +
      `${mb(texture.getImage().byteLength).padStart(9)}${isSpread ? "  [spread]" : ""}`,
  );
}
spreads.sort();

/* ------------------------------------------------------------------ *
 * 6. Re-encode. The spreads ship as 4725x2363 PNGs -- roughly 56 MB of
 *    VRAM each, ~340 MB for the set, which is what starves the GPU and
 *    leaves later pages rendering black. WebP keeps alpha and mip
 *    quality while bringing the whole set under ~100 MB.
 * ------------------------------------------------------------------ */
console.log(`\n  re-encoding textures -> webp`);
for (const texture of root.listTextures()) {
  const isSpread = spreads.includes(texture.getName());
  const limit = isSpread ? SPREAD_MAX : PROP_MAX;
  await compressTexture(texture, {
    encoder: sharp,
    targetFormat: "webp",
    quality: isSpread ? QUALITY : 95,
    effort: 6,
    resize: [limit, limit],
    resizeFilter: "lanczos3",
  });
}

for (const texture of root.listTextures()) {
  texture.setURI(`textures/${texture.getName()}.webp`);
  const size = texture.getSize() ?? [0, 0];
  console.log(
    `    ${texture.getName().padEnd(26)} ${String(size[0]).padStart(5)}x${String(size[1]).padEnd(5)} ` +
      `${mb(texture.getImage().byteLength).padStart(9)}`,
  );
}

/* ------------------------------------------------------------------ *
 * 7. Write .gltf + .bin + textures/
 * ------------------------------------------------------------------ */
fs.rmSync(path.join(OUT_DIR, "textures"), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT_DIR, "textures"), { recursive: true });
await io.write(OUT, document);

fs.writeFileSync(
  MANIFEST,
  `${JSON.stringify(
    {
      note: "Generated by scripts/convert-model.mjs - do not edit by hand.",
      clip: clip.getName(),
      duration,
      spreadCount: spreads.length,
      spreads,
      /** stops[i] -> stops[i + 1] is exactly one page turn. */
      stops,
      segments,
    },
    null,
    2,
  )}\n`,
);

/* ------------------------------------------------------------------ */
const report = [];
let total = 0;
for (const file of fs.readdirSync(OUT_DIR, { recursive: true })) {
  const full = path.join(OUT_DIR, file);
  if (!fs.statSync(full).isFile() || file.endsWith(".glb")) continue;
  const { size } = fs.statSync(full);
  total += size;
  report.push([String(file), size]);
}
report.sort((a, b) => b[1] - a[1]);

console.log("\n  output:");
for (const [file, size] of report) console.log(`    ${file.padEnd(40)} ${mb(size).padStart(9)}`);
console.log(`    ${"TOTAL".padEnd(40)} ${mb(total).padStart(9)}   (was ${mb(fs.statSync(SRC).size)})\n`);
