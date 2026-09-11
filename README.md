# My First Football Match — interactive 3D book

A Next.js page that shows the animated story-book model full screen. The reader turns one page at a time with the arrows under the book, and the six sound buttons on the book's module can be pressed.

```bash
npm install
npm run dev          # http://localhost:3000
```

## Where things live

| Path | What it does |
| --- | --- |
| `app/BookExperience.tsx` | The page UI: loader, page arrows, page dots, page counter, sound-button toast. |
| `app/book/BookScene.tsx` | The 3D scene. Loads the model, turns one page per step, frames the camera, handles button presses. |
| `app/book/timeline.ts` | Every step the reader can stop at: cover, spreads 1–6, the keepsake pocket, and the back cover. The model has no animation for turning the book over, so the back cover is one extra step added in code. |
| `app/book/guide.ts` | What young readers see: the hint shown on each page, and the page button labels ("Open the book", "Turn over", …). |
| `app/book/sounds.ts` | Which sound each button plays, and which page it opens. Each button's icon matches the round badge printed in the corner of its page. |
| `model-source/book.glb` | The original Blender export (58 MB). Kept out of `public/`, so it is never deployed. |
| `public/model/` | The converted model that the site loads (~6 MB). **Generated. Don't edit it by hand, except for textures (see below).** |

## Updating the model

Export from Blender to `model-source/book.glb`, then run:

```bash
npm run model:convert
```

The script (`scripts/convert-model.mjs`):

- Converts the `.glb` into `book.gltf` + `book.bin` + one file per texture in `textures/`.
- Drops the unused second scene and the duplicate animation.
- Resizes the page artwork from 4725×2363 PNG to 2560×1280 WebP. The originals used ~340 MB of GPU memory, which is why later pages went black.
- Reads the rig to find where each page turn starts and ends in the single long animation. It writes those points to `book.pages.json`, so **Next** turns exactly one page.

## Replacing page artwork

Overwrite `public/model/textures/page-N.webp` with a new image of the same name. Each file is a full double-page spread at a 2:1 ratio, ideally 2560×1280.

Re-running `model:convert` regenerates this folder from the `.glb`, so put permanent artwork changes into the Blender file.

## Keepsake photo (last page)

When the book settles on the last page, an **Add your photo** button appears over the pocket uncovered by the white card.

- **Saving:** the picked image is shrunk to at most 1024 px and saved as a JPEG in the browser's `localStorage` (key `story-book:keepsake-photo`), so it stays on that device.
- **Removing:** clicking the photo shows a **Remove photo** button.

The storage code is in `app/book/photo.ts`. The 3D placement is in `app/book/PhotoSlot.tsx`.

## Real button sounds

Every button plays a synthesised sound until a recording is supplied. To use a recording:

1. Put the file in `public/audio/`, e.g. `public/audio/whistle.mp3`.
2. List it in `RECORDINGS` in `app/book/sounds.ts`, e.g. `whistle: "/audio/whistle.mp3"`.

## Visual checks (development)

With `npm run dev` running and Chrome started with `--remote-debugging-port=9224`:

```bash
node scripts/inspect-page.mjs          # screenshot every page step  -> .scratch/shots
node scripts/sweep-clip.mjs 0 1.5 3    # screenshot raw animation times -> .scratch/sweep
```
