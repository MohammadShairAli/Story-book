/**
 * The six decals on the book's sound module, and what pressing each plays.
 *
 * Real recordings can be dropped into `public/audio/` and listed in
 * `RECORDINGS`. Anything without a recording is synthesised on the fly, so
 * every button responds out of the box.
 */

export type SoundId = "whistle" | "crowd" | "aaah" | "ole" | "stadium" | "rec";

export const SOUND_BUTTON_ORDER: readonly SoundId[] = ["crowd", "whistle", "stadium", "aaah", "ole", "rec"];

/**
 * Every button's decal is also printed as a small round badge in the top
 * corner of one spread, and pressing the button flips the book to it.
 * `page` is that spread's number, which is also its stop in the timeline.
 */
export const SOUNDS: Record<SoundId, { label: string; page: number }> = {
  crowd: { label: "The crowd cheers", page: 1 },
  whistle: { label: "Whistle!", page: 2 },
  stadium: { label: "Stadium roar", page: 3 },
  aaah: { label: "Aaah!", page: 4 },
  ole: { label: "Olé!", page: 5 },
  rec: { label: "Recording…", page: 6 },
};

/** Keyed by the decal image names baked into the model. */
const TEXTURE_TO_SOUND: Record<string, SoundId> = {
  "buton-whistle": "whistle",
  "button-crowd": "crowd",
  "button-aaah": "aaah",
  "buton-ole": "ole",
  "button-stadium": "stadium",
  "button-rec": "rec",
};

/** The decal printed on a button's cap, as served from `public/`. */
export const decalUrl = (id: SoundId) =>
  `/model/textures/${Object.keys(TEXTURE_TO_SOUND).find((name) => TEXTURE_TO_SOUND[name] === id)}.webp`;

export const soundForTexture = (name: string | undefined): SoundId | null =>
  (name && TEXTURE_TO_SOUND[name]) || null;

/** e.g. `whistle: "/audio/whistle.mp3"` once a real recording exists. */
const RECORDINGS: Partial<Record<SoundId, string>> = {};

export function playSound(id: SoundId) {
  if (process.env.NODE_ENV !== "production") {
    // Dev-only trail, so scripts can check what played and when.
    const scope = window as unknown as { __soundLog?: SoundId[] };
    (scope.__soundLog ??= []).push(id);
  }

  const recording = RECORDINGS[id];
  if (recording) {
    new Audio(recording).play().catch(() => synthesise(id));
    return;
  }
  synthesise(id);
}

/* ------------------------------------------------------------------ *
 * Synthesis
 * ------------------------------------------------------------------ */

let context: AudioContext | null = null;
let output: GainNode | null = null;
let noise: AudioBuffer | null = null;

function audio() {
  if (typeof window === "undefined") return null;

  if (!context) {
    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return null;

    context = new Context();
    output = context.createGain();
    output.gain.value = 0.55;
    output.connect(context.createDynamicsCompressor()).connect(context.destination);
  }

  if (context.state === "suspended") void context.resume();
  return { ctx: context, out: output! };
}

function noiseBuffer(ctx: AudioContext) {
  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

function envelope(
  param: AudioParam,
  start: number,
  attack: number,
  hold: number,
  release: number,
  peak: number,
) {
  param.setValueAtTime(0.0001, start);
  param.exponentialRampToValueAtTime(peak, start + attack);
  param.setValueAtTime(peak, start + attack + hold);
  param.exponentialRampToValueAtTime(0.0001, start + attack + hold + release);
}

/** A referee's pea whistle: a short blast, then a long one. */
function whistle(ctx: AudioContext, out: AudioNode) {
  const now = ctx.currentTime;

  for (const [offset, length] of [
    [0, 0.16],
    [0.26, 0.52],
  ]) {
    const start = now + offset;
    const tone = ctx.createOscillator();
    tone.frequency.value = 2850;

    // The pea rattling inside the whistle.
    const trill = ctx.createOscillator();
    trill.frequency.value = 42;
    const depth = ctx.createGain();
    depth.gain.value = 140;
    trill.connect(depth).connect(tone.frequency);

    const gain = ctx.createGain();
    envelope(gain.gain, start, 0.015, length - 0.06, 0.045, 0.32);
    tone.connect(gain).connect(out);

    for (const oscillator of [tone, trill]) {
      oscillator.start(start);
      oscillator.stop(start + length + 0.05);
    }
  }
}

/** Filtered noise swelling and fading, optionally pulsing like a chant. */
function roar(
  ctx: AudioContext,
  out: AudioNode,
  { length, cutoff, swell, chant }: { length: number; cutoff: number; swell: number; chant?: number },
) {
  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  source.loop = true;

  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = cutoff;
  band.Q.value = 0.55;

  const low = ctx.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = cutoff * 2.4;

  const pulse = ctx.createGain();
  pulse.gain.value = chant ? 0.72 : 1;
  if (chant) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = chant;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.28;
    lfo.connect(lfoDepth).connect(pulse.gain);
    lfo.start(now);
    lfo.stop(now + length);
  }

  const hold = length * 0.3;
  const gain = ctx.createGain();
  envelope(gain.gain, now, swell, hold, length - swell - hold, 0.9);

  source.connect(band).connect(low).connect(pulse).connect(gain).connect(out);
  source.start(now);
  source.stop(now + length);
}

type Note = { freq: number; glide?: number; start: number; length: number; formants: [number, number] };

/** A small group of voices, shaped into a vowel by two formant filters. */
function voices(ctx: AudioContext, out: AudioNode, notes: Note[]) {
  const now = ctx.currentTime;

  for (const note of notes) {
    const start = now + note.start;
    const end = start + note.length;

    const mix = ctx.createGain();
    mix.gain.value = 0.18;

    const vowel = ctx.createGain();
    for (const [index, formant] of note.formants.entries()) {
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = formant;
      filter.Q.value = 7;
      const weight = ctx.createGain();
      weight.gain.value = index === 0 ? 1 : 0.6;
      mix.connect(filter).connect(weight).connect(vowel);
    }

    const gain = ctx.createGain();
    envelope(gain.gain, start, 0.06, note.length - 0.24, 0.18, 1.4);
    vowel.connect(gain).connect(out);

    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5.5;
    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.value = 4;
    vibrato.connect(vibratoDepth);
    vibrato.start(start);
    vibrato.stop(end);

    for (const [spread, detune] of [
      [0.985, -12],
      [0.995, -4],
      [1.004, 5],
      [1.016, 13],
    ]) {
      const voice = ctx.createOscillator();
      voice.type = "sawtooth";
      voice.detune.value = detune;
      voice.frequency.setValueAtTime(note.freq * spread, start);
      if (note.glide) voice.frequency.exponentialRampToValueAtTime(note.glide * spread, end);
      vibratoDepth.connect(voice.frequency);
      voice.connect(mix);
      voice.start(start);
      voice.stop(end);
    }
  }
}

function beep(ctx: AudioContext, out: AudioNode) {
  const now = ctx.currentTime;
  for (const offset of [0, 0.14]) {
    const tone = ctx.createOscillator();
    tone.frequency.value = 1320;
    const gain = ctx.createGain();
    envelope(gain.gain, now + offset, 0.008, 0.06, 0.03, 0.25);
    tone.connect(gain).connect(out);
    tone.start(now + offset);
    tone.stop(now + offset + 0.12);
  }
}

function synthesise(id: SoundId) {
  const graph = audio();
  if (!graph) return;
  const { ctx, out } = graph;

  switch (id) {
    case "whistle":
      return whistle(ctx, out);
    case "crowd":
      return roar(ctx, out, { length: 1.6, cutoff: 1100, swell: 0.25 });
    case "stadium":
      return roar(ctx, out, { length: 2.6, cutoff: 700, swell: 0.6, chant: 2.2 });
    case "aaah":
      return voices(ctx, out, [{ freq: 240, glide: 190, start: 0, length: 1.1, formants: [800, 1150] }]);
    case "ole":
      return voices(ctx, out, [
        { freq: 294, start: 0, length: 0.36, formants: [500, 850] },
        { freq: 392, start: 0.34, length: 0.6, formants: [420, 1900] },
      ]);
    case "rec":
      return beep(ctx, out);
  }
}
