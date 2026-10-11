/**
 * The soundtrack, in F minor at 140 BPM half-time, on the chords and hook of
 * the botBTC videos. It renders once, offline, into three stems that loop
 * together: the bed (pads and keys), the beat (kick, 808, snare, hats) and
 * the hook (plucks, then the lead). The game fades the beat and the hook in
 * and out as the run heats up.
 */
import { BAR, BEAT, STEP, type Out, backbeat, crash, e808, hat, keysChord, kick, lead, mix, pad, pluck, reverseCymbal, snare } from './synth';

/** A bar at 140 BPM is 12/7 s: at this rate exactly 54,000 samples, so stems of 4 and 8 bars stay in step. */
const RATE = 31500;
const BAR_SAMPLES = 54000;
/** Rendered past each loop so reverb and delay tails wrap round to its start. */
const TAIL = 2.5;
/** Each stem's level against the others: the chords and the hook up, the beat down. */
const STEM_GAIN = [2.8, 0.8, 5];

export type Stems = [bed: AudioBuffer, beat: AudioBuffer, hook: AudioBuffer];

const at = (bar: number, step = 0) => bar * BAR + step * STEP;
const NOTE = (s: string) => {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(s)!;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as 'C'];
  return base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
};

type Chord = 'Fm' | 'Db' | 'Ab' | 'Eb';
const PROG: Chord[] = ['Fm', 'Db', 'Ab', 'Eb'];
export const CHORDS: Record<Chord, { pad: number[]; keys: number[]; root: number }> = {
  Fm: { pad: [56, 60, 63, 67, 72], keys: [53, 56, 60, 63, 67], root: 29 }, // Fm9
  Db: { pad: [56, 60, 63, 65, 72], keys: [49, 53, 56, 60, 63], root: 37 }, // Dbmaj9
  Ab: { pad: [56, 60, 63, 70, 72], keys: [56, 60, 63, 67, 70], root: 32 }, // Ab(add9)
  Eb: { pad: [55, 58, 63, 65, 70], keys: [51, 55, 58, 65, 70], root: 39 }, // Eb(add9)
};

/** 808 and kick per bar of the four-bar loop: [step, length in steps, octave, glide from the last note]. */
const BASS: [number, number, number, boolean?][][] = [
  [[0, 6, 0], [6, 4, 0], [10, 6, 0]],
  [[0, 7, 0], [7, 3, 0], [10, 6, 0]],
  [[0, 6, 0], [6, 4, 0], [10, 2, 0], [12, 4, 1, true]],
  [[0, 6, 0], [6, 2, 0], [8, 2, 0], [10, 6, 0]],
];

/** The hook, and its answer: [step, note, length in steps] per chord. */
const MEL_A: Record<Chord, [number, string, number][]> = {
  Fm: [[0, 'C5', 3], [3, 'Eb5', 3], [6, 'F5', 2], [8, 'G5', 4], [12, 'Ab5', 2], [14, 'G5', 2]],
  Db: [[0, 'F5', 6], [6, 'Eb5', 2], [8, 'C5', 8]],
  Ab: [[0, 'C5', 3], [3, 'Eb5', 3], [6, 'F5', 2], [8, 'G5', 4], [12, 'Bb5', 2], [14, 'Ab5', 2]],
  Eb: [[0, 'G5', 6], [6, 'F5', 2], [8, 'Eb5', 4], [12, 'F5', 2], [14, 'G5', 2]],
};
const MEL_B: Record<Chord, [number, string, number][]> = {
  Fm: [[0, 'C6', 3], [3, 'Bb5', 3], [6, 'Ab5', 2], [8, 'G5', 4], [12, 'F5', 2], [14, 'G5', 2]],
  Db: [[0, 'Ab5', 6], [6, 'G5', 2], [8, 'F5', 8]],
  Ab: [[0, 'Eb5', 3], [3, 'F5', 3], [6, 'G5', 2], [8, 'Ab5', 4], [12, 'Bb5', 2], [14, 'C6', 2]],
  Eb: [[0, 'Bb5', 6], [6, 'G5', 2], [8, 'Bb5', 4], [12, 'C6', 4]],
};

const HATS: Record<string, [number, number][]> = {
  eighths: [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, s % 4 ? 0.75 : 1]),
  trip: [...[0, 2, 4, 6, 8, 10].map((s): [number, number] => [s, s % 4 ? 0.75 : 1]), ...Array.from({ length: 6 }, (_, k): [number, number] => [12 + (k * 4) / 6, 0.55 + 0.08 * k])],
  roll: [
    ...[0, 2, 4, 6].map((s): [number, number] => [s, s % 4 ? 0.75 : 1]),
    ...[8, 9, 10, 11, 12, 13].map((s): [number, number] => [s, s % 2 ? 0.6 : 0.85]),
    ...Array.from({ length: 4 }, (_, k): [number, number] => [14 + k * 0.5, 0.5 + 0.13 * k]),
  ],
  sixteenths: Array.from({ length: 16 }, (_, s): [number, number] => [s, s % 4 === 0 ? 1 : s % 2 ? 0.55 : 0.78]),
};

/** Renders one stem: `bars` long, with its tail folded back onto its start so it loops seamlessly. */
async function renderStem(bars: number, gain: number, play: (ctx: BaseAudioContext, out: Out) => void): Promise<AudioBuffer> {
  const loop = bars * BAR_SAMPLES;
  const ctx = new OfflineAudioContext(2, loop + Math.ceil(TAIL * RATE), RATE);
  play(ctx, mix(ctx, ctx.destination));
  const rendered = await ctx.startRendering();
  const buf = new AudioBuffer({ numberOfChannels: 2, length: loop, sampleRate: RATE });
  for (const c of [0, 1]) {
    const src = rendered.getChannelData(c);
    const dst = buf.getChannelData(c);
    for (let i = 0; i < loop; i++) dst[i] = src[i]! * gain;
    for (let i = loop; i < src.length; i++) dst[(i - loop) % loop]! += src[i]! * gain;
  }
  return buf;
}

/** The bed: pads pumping with the kick, and rolled keys. Four bars, one per chord. */
function bed(ctx: BaseAudioContext, out: Out): void {
  const duck = ctx.createGain();
  duck.connect(out.dry);
  const padOut: Out = { ...out, dry: duck };
  for (let bar = 0; bar < 4; bar++) {
    const ch = CHORDS[PROG[bar]!];
    const tb = at(bar);
    pad(ctx, padOut, tb, BAR - 0.01, ch.pad, { vol: 0.05, a: 0.02, r: 0.25, cut: 2800 });
    keysChord(ctx, out, tb, 3 * BEAT, ch.keys, 0.045, 0.014);
    for (const [s, , , glide] of BASS[bar]!) {
      if (glide) continue;
      duck.gain.setValueAtTime(0.45, tb + s * STEP);
      duck.gain.setTargetAtTime(1, tb + s * STEP, 0.07);
    }
  }
}

/** The beat: kick and 808, the backbeat, hats that change in the second half, a fill into the top. */
function beat(ctx: BaseAudioContext, out: Out): void {
  for (let bar = 0; bar < 8; bar++) {
    const ch = CHORDS[PROG[bar % 4]!];
    const tb = at(bar);
    let prev: number | null = null;
    for (const [s, len, oct, glide] of BASS[bar % 4]!) {
      const m = ch.root + 12 * oct;
      e808(ctx, out, tb + s * STEP, len * STEP - 0.004, m, { from: glide ? prev : null });
      if (!glide) kick(ctx, out, tb + s * STEP);
      prev = m;
    }
    backbeat(ctx, out, tb + 8 * STEP);
    const kind = (bar >= 4 ? ['sixteenths', 'trip', 'sixteenths', 'roll'] : ['eighths', 'trip', 'eighths', 'roll'])[bar % 4]!;
    for (const [s, v] of HATS[kind]!) hat(ctx, out, tb + s * STEP, 0.1 * v, false, 0.15 + 0.2 * Math.sin(s));
    if (bar % 2 === 1) hat(ctx, out, tb + 6 * STEP, 0.06, true, -0.25);
  }
  for (const s of [12, 13, 14, 15]) snare(ctx, out, at(7, s), 0.12 + 0.03 * (s - 12), 0.35);
  crash(ctx, out, 0, 0.05);
  reverseCymbal(ctx, out, at(8), 0.9, 0.05);
}

/** The hook: plucks play it, then the lead answers it higher, with quiet plucks an octave up. */
function hook(ctx: BaseAudioContext, out: Out): void {
  for (let bar = 0; bar < 8; bar++) {
    const name = PROG[bar % 4]!;
    const tb = at(bar);
    if (bar < 4) {
      for (const [s, n, len] of MEL_A[name]) pluck(ctx, out, tb + s * STEP, NOTE(n), { vol: 0.065, len: Math.min(0.7, len * STEP + 0.2), p: 0.15 });
      continue;
    }
    let last: number | null = null;
    for (const [s, n, len] of MEL_B[name]) {
      const m = NOTE(n);
      lead(ctx, out, tb + s * STEP, len * STEP - 0.01, m, { from: last !== null && Math.abs(last - m) <= 5 ? last : null, vol: 0.07 });
      pluck(ctx, out, tb + s * STEP, m + 12, { vol: 0.025, len: 0.35, p: -0.25, cut: 1200 });
      last = m;
    }
  }
}

/**
 * Renders the three stems in parallel. Needs no user gesture: nothing plays.
 * The bed loops every 4 bars and the others every 8; started together, they
 * stay in step.
 */
export async function renderMusic(): Promise<Stems> {
  const stems = await Promise.all([renderStem(4, STEM_GAIN[0], bed), renderStem(8, STEM_GAIN[1], beat), renderStem(8, STEM_GAIN[2], hook)]);
  // One more gain for all of them, so the full mix peaks with headroom.
  const [b, d, h] = stems.map((buf) => [buf.getChannelData(0), buf.getChannelData(1)]);
  let peak = 0;
  for (let i = 0; i < d![0]!.length; i++) {
    for (const c of [0, 1]) peak = Math.max(peak, Math.abs(b![c]![i % b![c]!.length]! + d![c]![i]! + h![c]![i]!));
  }
  const g = 0.85 / Math.max(peak, 1e-6);
  for (const buf of stems) for (const c of [0, 1]) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < data.length; i++) data[i]! *= g;
  }
  return stems as Stems;
}
