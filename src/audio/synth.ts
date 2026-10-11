/**
 * Instruments built from Web Audio nodes, so the same code plays the sound
 * effects live and renders the music offline. Modelled on the botBTC video
 * soundtrack: trap and future bass at 140 BPM, nothing chiptune.
 */

export const BPM = 140;
export const BEAT = 60 / BPM;
export const STEP = BEAT / 4;
export const BAR = 4 * BEAT;

export const midi = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** Where an instrument plays: dry, and the reverb and delay sends. */
export interface Out {
  dry: AudioNode;
  rev: AudioNode;
  dly: AudioNode;
}

type Ctx = BaseAudioContext;

const noises = new WeakMap<Ctx, AudioBuffer>();

/** Two seconds of white noise per context, played from a random point. */
function noise(ctx: Ctx, t: number, dur: number): AudioBufferSourceNode {
  let buf = noises.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, 2 * ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noises.set(ctx, buf);
  }
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.start(t, Math.random() * 1.9);
  s.stop(t + dur + 0.05);
  return s;
}

function osc(ctx: Ctx, type: OscillatorType, freq: number, t: number, dur: number, detune = 0): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.detune.value = detune;
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

function gain(ctx: Ctx, value = 1): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

function filter(ctx: Ctx, type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function pan(ctx: Ctx, p: number): StereoPannerNode {
  const n = ctx.createStereoPanner();
  n.pan.value = p;
  return n;
}

const shapers = new WeakMap<Ctx, Map<number, Float32Array>>();

/** tanh saturation, normalised so full scale stays full scale. */
function shaper(ctx: Ctx, drive: number): WaveShaperNode {
  let byDrive = shapers.get(ctx);
  if (!byDrive) shapers.set(ctx, (byDrive = new Map()));
  let curve = byDrive.get(drive);
  if (!curve) {
    curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(drive * ((i / (curve.length - 1)) * 2 - 1)) / Math.tanh(drive);
    byDrive.set(drive, curve);
  }
  const s = ctx.createWaveShaper();
  s.curve = curve as Float32Array<ArrayBuffer>;
  return s;
}

/** A sharp attack, then an exponential fall with time constant `tau`. */
function perc(p: AudioParam, t: number, peak: number, attack: number, tau: number): void {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.setTargetAtTime(0, t + attack, tau);
}

/** Attack, decay to a sustain level, and a release from `t + dur`. */
function adsr(p: AudioParam, t: number, dur: number, peak: number, a: number, d: number, s: number, r: number): void {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setTargetAtTime(peak * s, t + a, d / 3);
  p.setTargetAtTime(0, t + Math.max(dur, a), r / 3);
}

/** Connects `node` to the outputs at these levels. */
function route(ctx: Ctx, node: AudioNode, out: Out, dry = 1, rev = 0, dly = 0): void {
  if (dry) node.connect(gain(ctx, dry)).connect(out.dry);
  if (rev) node.connect(gain(ctx, rev)).connect(out.rev);
  if (dly) node.connect(gain(ctx, dly)).connect(out.dly);
}

// Drums

export function kick(ctx: Ctx, out: Out, t: number, vol = 0.55): void {
  const o = osc(ctx, 'sine', 210, t, 0.5);
  o.frequency.setTargetAtTime(50, t, 0.026);
  const body = gain(ctx, 0);
  perc(body.gain, t, 1, 0.0006, 0.17);
  const sat = shaper(ctx, 2.2);
  o.connect(body).connect(sat);
  const click = gain(ctx, 0);
  perc(click.gain, t, 0.45, 0.0002, 0.0012);
  noise(ctx, t, 0.02).connect(click).connect(sat);
  sat.connect(gain(ctx, vol)).connect(out.dry);
}

/** 808: saturated sine with a pitch punch, or a glide from the previous note. */
export function e808(ctx: Ctx, out: Out, t: number, dur: number, m: number, o: { from?: number | null; glide?: number; vol?: number; drive?: number; decay?: number } = {}): void {
  const { from = null, glide = 0.055, vol = 0.27, drive = 3.2, decay = 1.6 } = o;
  const f1 = midi(m);
  const s = osc(ctx, 'sine', from === null ? f1 * 1.8 : midi(from), t, dur + 0.1);
  s.frequency.setTargetAtTime(f1, t, from === null ? 0.011 : glide);
  const env = gain(ctx, 0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(1, t + 0.003);
  env.gain.setTargetAtTime(0, t + 0.003, decay);
  env.gain.setTargetAtTime(0, t + dur, 0.01);
  s.connect(shaper(ctx, drive)).connect(env).connect(gain(ctx, vol)).connect(out.dry);
}

export function snare(ctx: Ctx, out: Out, t: number, vol = 0.3, rev = 0.3): void {
  const b = osc(ctx, 'sine', 255, t, 0.3);
  b.frequency.setTargetAtTime(185, t, 0.008);
  const bg = gain(ctx, 0);
  perc(bg.gain, t, vol * 0.55, 0.001, 0.06);
  route(ctx, b.connect(bg), out, 1, rev * 0.5);
  const n1 = gain(ctx, 0);
  perc(n1.gain, t, vol * 0.85, 0.001, 0.085);
  route(ctx, noise(ctx, t, 0.4).connect(filter(ctx, 'bandpass', 2600, 0.6)).connect(n1), out, 1, rev);
  const n2 = gain(ctx, 0);
  perc(n2.gain, t, vol * 0.8, 0.001, 0.045);
  noise(ctx, t, 0.25).connect(filter(ctx, 'highpass', 6500)).connect(n2).connect(out.dry);
}

export function clap(ctx: Ctx, out: Out, t: number, vol = 0.24, rev = 0.35): void {
  const len = 0.45;
  const curve = new Float32Array(160);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * len;
    let e = 0;
    for (const b of [0, 0.01, 0.021]) if (x >= b) e += Math.exp(-(x - b) / 0.004);
    if (x >= 0.03) e += 0.8 * Math.exp(-(x - 0.03) / 0.1);
    curve[i] = e * vol;
  }
  const g = gain(ctx, 0);
  g.gain.setValueCurveAtTime(curve, t, len);
  route(ctx, noise(ctx, t, len).connect(filter(ctx, 'bandpass', 1300, 0.9)).connect(g), out, 1, rev);
}

/** Layered snare and clap: the backbeat. */
export function backbeat(ctx: Ctx, out: Out, t: number, vol = 1): void {
  snare(ctx, out, t, 0.3 * vol);
  clap(ctx, out, t + 0.004, 0.22 * vol);
}

// Metallic hats: square waves at three of the 808 cymbal's ratios, filtered high, plus noise.
const HAT_F = [369.6, 540, 800];

export function hat(ctx: Ctx, out: Out, t: number, vol = 0.05, open = false, p = 0.2): void {
  const dur = open ? 0.45 : 0.08;
  const sum = gain(ctx, 1 / HAT_F.length);
  for (const f of HAT_F) osc(ctx, 'square', f * 1.7, t, dur).connect(sum);
  noise(ctx, t, dur).connect(gain(ctx, 0.6 * HAT_F.length)).connect(sum);
  const env = gain(ctx, 0);
  perc(env.gain, t, vol, 0.0004, open ? 0.13 : 0.02);
  const chain = sum.connect(filter(ctx, 'bandpass', 9500, 0.8)).connect(filter(ctx, 'highpass', 7000)).connect(env).connect(pan(ctx, p));
  route(ctx, chain, out, 1, open ? 0.12 : 0.02);
}

export function crash(ctx: Ctx, out: Out, t: number, vol = 0.07): void {
  for (const p of [-0.45, 0.45]) sweep(ctx, out, t, 2.6, { vol, type: 'highpass', from: 5200, to: 5200, shape: (x) => Math.exp((-x * 2.6) / 0.9), pan: p, rev: 0.2 });
}

// Tonal

/** Detuned-saw pad through a low-pass filter. */
export function pad(ctx: Ctx, out: Out, t: number, dur: number, notes: number[], o: { vol?: number; a?: number; r?: number; voices?: number; detune?: number; cut?: number; q?: number; rev?: number } = {}): void {
  const { vol = 0.03, a = 0.08, r = 0.35, voices = 3, detune = 18, cut = 2200, q = 0.8, rev = 0.35 } = o;
  const sum = gain(ctx, vol / Math.sqrt(voices));
  for (const m of notes) {
    for (let v = 0; v < voices; v++) {
      const sp = (v / (voices - 1)) * 2 - 1;
      osc(ctx, 'sawtooth', midi(m), t, dur + r, sp * detune).connect(pan(ctx, sp * 0.95)).connect(sum);
    }
  }
  const env = gain(ctx, 0);
  adsr(env.gain, t, dur, 1, a, 0.01, 1, r);
  route(ctx, sum.connect(filter(ctx, 'lowpass', cut, q)).connect(env), out, 1, rev);
}

/** Two detuned saws with a snappy filter envelope. */
export function pluck(ctx: Ctx, out: Out, t: number, m: number, o: { vol?: number; p?: number; len?: number; cut?: number; env?: number; decay?: number; q?: number; rev?: number; dly?: number } = {}): void {
  const { vol = 0.06, p = 0, len = 0.45, cut = 700, env = 4200, decay = 0.09, q = 1.1, rev = 0.25, dly = 0.3 } = o;
  const sum = gain(ctx, 0.5);
  for (const d of [9, -9]) osc(ctx, 'sawtooth', midi(m), t, len, d).connect(sum);
  const f = filter(ctx, 'lowpass', cut + env, q);
  f.frequency.setValueAtTime(cut + env, t);
  f.frequency.setTargetAtTime(cut, t, decay);
  const g = gain(ctx, 0);
  perc(g.gain, t, vol, 0.002, len * 0.35);
  g.gain.setTargetAtTime(0, t + len - 0.02, 0.006);
  route(ctx, sum.connect(f).connect(g).connect(pan(ctx, p)), out, 1, rev, dly);
}

/** Two-operator FM electric piano, slightly detuned left and right. */
export function keys(ctx: Ctx, out: Out, t: number, dur: number, m: number, o: { vol?: number; rev?: number; dly?: number; index?: number; bright?: number; r?: number; ratio?: number } = {}): void {
  const { vol = 0.08, rev = 0.35, dly = 0.15, index = 1.6, bright = 0.3, r = 0.5, ratio = 1 } = o;
  const f = midi(m);
  for (const [side, p] of [
    [0.9988, -0.6],
    [1.0012, 0.6],
  ] as const) {
    const car = osc(ctx, 'sine', f * side, t, dur + r);
    const mod = osc(ctx, 'sine', f * side * ratio, t, dur + r);
    const depth = gain(ctx, 0);
    depth.gain.setValueAtTime((index + 0.18) * f * side * ratio, t);
    depth.gain.setTargetAtTime(0.18 * f * side * ratio, t, bright);
    mod.connect(depth).connect(car.frequency);
    const env = gain(ctx, 0);
    adsr(env.gain, t, dur, vol, 0.004, 1.2, 0.35, r);
    route(ctx, car.connect(env).connect(pan(ctx, p)), out, 1, rev, dly);
  }
}

/** A chord on the keys, rolled from the bottom. */
export function keysChord(ctx: Ctx, out: Out, t: number, dur: number, notes: number[], vol = 0.06, roll = 0.018): void {
  notes.forEach((m, i) => keys(ctx, out, t + i * roll, dur - i * roll, m, { vol: vol * (i === 0 ? 1.1 : 0.85) }));
}

/** Detuned saw lead with portamento, vibrato and a sine sub-octave. */
export function lead(ctx: Ctx, out: Out, t: number, dur: number, m: number, o: { from?: number | null; vol?: number; voices?: number; detune?: number; rev?: number; dly?: number } = {}): void {
  const { from = null, vol = 0.085, voices = 3, detune = 13, rev = 0.3, dly = 0.32 } = o;
  const f1 = midi(m);
  const f0 = from === null ? f1 : midi(from);
  const end = dur + 0.15;
  const vib = osc(ctx, 'sine', 5.4, t, end);
  const vibDepth = gain(ctx, 0);
  vibDepth.gain.setValueAtTime(0, t + 0.16);
  vibDepth.gain.linearRampToValueAtTime(f1 * 0.008, t + 0.41);
  vib.connect(vibDepth);
  const sum = gain(ctx, 1 / Math.sqrt(voices));
  for (let v = 0; v < voices; v++) {
    const sp = (v / (voices - 1)) * 2 - 1;
    const s = osc(ctx, 'sawtooth', f0, t, end, sp * detune);
    s.frequency.setTargetAtTime(f1, t, 0.045);
    vibDepth.connect(s.frequency);
    s.connect(pan(ctx, sp * 0.6)).connect(sum);
  }
  const f = filter(ctx, 'lowpass', 7100, 0.75);
  f.frequency.setTargetAtTime(2600, t, 0.2);
  const sub = osc(ctx, 'sine', f0 / 2, t, end);
  sub.frequency.setTargetAtTime(f1 / 2, t, 0.045);
  const mixed = gain(ctx, 1);
  sum.connect(f).connect(mixed);
  sub.connect(gain(ctx, 0.7)).connect(mixed);
  const env = gain(ctx, 0);
  adsr(env.gain, t, dur, vol, from === null ? 0.008 : 0.002, 0.25, 0.78, 0.1);
  route(ctx, mixed.connect(env), out, 1, rev, dly);
}

/** A bell: FM with an inharmonic ratio and a fast-falling index. */
export function bell(ctx: Ctx, out: Out, t: number, m: number, o: { vol?: number; p?: number; rev?: number; dly?: number; len?: number } = {}): void {
  const { vol = 0.06, p = 0, rev = 0.4, dly = 0.25, len = 0.9 } = o;
  const f = midi(m);
  const car = osc(ctx, 'sine', f, t, len);
  const mod = osc(ctx, 'sine', f * 3.5, t, len);
  const depth = gain(ctx, 0);
  depth.gain.setValueAtTime(f * 2.5, t);
  depth.gain.setTargetAtTime(f * 0.2, t, 0.12);
  mod.connect(depth).connect(car.frequency);
  const env = gain(ctx, 0);
  perc(env.gain, t, vol, 0.002, len * 0.3);
  route(ctx, car.connect(env).connect(pan(ctx, p)), out, 1, rev, dly);
}

/** A chord stab: detuned saws per note, a falling filter, a quick decay. */
export function stab(ctx: Ctx, out: Out, t: number, notes: number[], o: { vol?: number; len?: number; rev?: number; dly?: number } = {}): void {
  const { vol = 0.1, len = 0.6, rev = 0.45, dly = 0.2 } = o;
  const sum = gain(ctx, vol / Math.sqrt(notes.length * 3));
  for (const m of notes) for (const d of [-14, 0, 14]) osc(ctx, 'sawtooth', midi(m), t, len, d).connect(pan(ctx, d / 20)).connect(sum);
  const f = filter(ctx, 'lowpass', 7000, 1);
  f.frequency.setTargetAtTime(1300, t, 0.15);
  const env = gain(ctx, 0);
  perc(env.gain, t, 1, 0.003, len * 0.4);
  route(ctx, sum.connect(f).connect(env), out, 1, rev, dly);
}

/** A pitched blip: a glide from `from` to `to` Hz under a percussive envelope, through a low-pass that can close. */
export function blip(ctx: Ctx, out: Out, t: number, o: { type?: OscillatorType; from: number; to?: number; glide?: number; vol?: number; attack?: number; decay?: number; cut?: number; cutTo?: number; p?: number; rev?: number; dly?: number }): void {
  const { type = 'sine', from, to = from, glide = 0.03, vol = 0.1, attack = 0.002, decay = 0.05, cut = 0, cutTo = cut, p = 0, rev = 0, dly = 0 } = o;
  const s = osc(ctx, type, from, t, attack + decay * 6);
  if (to !== from) s.frequency.setTargetAtTime(to, t, glide);
  let node: AudioNode = s;
  if (cut) {
    const f = filter(ctx, 'lowpass', cut);
    if (cutTo !== cut) f.frequency.setTargetAtTime(cutTo, t, glide);
    node = node.connect(f);
  }
  const env = gain(ctx, 0);
  perc(env.gain, t, vol, attack, decay);
  route(ctx, node.connect(env).connect(pan(ctx, p)), out, 1, rev, dly);
}

// Noise effects

/** Filtered noise: the frequency sweeps exponentially, the level follows `shape` over [0, 1]. */
export function sweep(ctx: Ctx, out: Out, t: number, dur: number, o: { vol?: number; type?: BiquadFilterType; from?: number; to?: number; q?: number; shape?: (x: number) => number; pan?: number; panTo?: number; rev?: number }): void {
  const { vol = 0.08, type = 'bandpass', from = 1000, to = from, q = 0.7, shape = (x: number) => 1 - x, pan: p0 = 0, panTo = p0, rev = 0 } = o;
  const f = filter(ctx, type, from, q);
  if (to !== from) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const curve = new Float32Array(128);
  for (let i = 0; i < curve.length; i++) curve[i] = vol * shape(i / (curve.length - 1));
  const g = gain(ctx, 0);
  g.gain.setValueCurveAtTime(curve, t, dur);
  const pn = pan(ctx, p0);
  pn.pan.setValueAtTime(p0, t);
  pn.pan.linearRampToValueAtTime(panTo, t + dur);
  route(ctx, noise(ctx, t, dur).connect(f).connect(g).connect(pn), out, 1, rev);
}

/** A hit: a falling sub boom and a dark noise burst. */
export function impact(ctx: Ctx, out: Out, t: number, vol = 0.5): void {
  const o = osc(ctx, 'sine', 112, t, 1.8);
  o.frequency.setTargetAtTime(32, t, 0.1);
  const g = gain(ctx, 0);
  perc(g.gain, t, vol, 0.002, 0.6);
  route(ctx, o.connect(g), out, 1, 0.12);
  sweep(ctx, out, t, 0.7, { vol: vol * 0.5, type: 'lowpass', from: 1200, shape: (x) => Math.exp((-x * 0.7) / 0.12), rev: 0.6 });
}

export function subDrop(ctx: Ctx, out: Out, t: number, vol = 0.32): void {
  const o = osc(ctx, 'sine', 94, t, 1.4);
  o.frequency.setTargetAtTime(34, t, 0.25);
  const g = gain(ctx, 0);
  perc(g.gain, t, vol, 0.005, 0.7);
  o.connect(g).connect(out.dry);
}

/** Noise swelling into `t1`. */
export function riser(ctx: Ctx, out: Out, t0: number, t1: number, vol = 0.08): void {
  sweep(ctx, out, t0, t1 - t0, { vol, from: 300, to: 8000, q: 1.5, shape: (x) => x ** 2.4, pan: -0.5, panTo: 0.5, rev: 0.35 });
}

/** Noise falling away from `t`. */
export function downlifter(ctx: Ctx, out: Out, t: number, dur: number, vol = 0.07): void {
  sweep(ctx, out, t, dur, { vol, from: 7000, to: 250, q: 1.3, shape: (x) => (1 - x) ** 2, pan: 0.5, panTo: -0.5, rev: 0.4 });
}

/** A swish through the stereo field, centred on `tc`; `dir` up or down. */
export function whoosh(ctx: Ctx, out: Out, tc: number, vol = 0.08, dir = 1): void {
  sweep(ctx, out, Math.max(0, tc - 0.3), 0.5, {
    vol,
    from: dir > 0 ? 400 : 6000,
    to: dir > 0 ? 6000 : 400,
    q: 1.2,
    shape: (x) => Math.sin(Math.PI * x) ** 2,
    pan: -0.7 * dir,
    panTo: 0.7 * dir,
    rev: 0.25,
  });
}

/** A cymbal played backwards, swelling into `t1`. */
export function reverseCymbal(ctx: Ctx, out: Out, t1: number, dur = 1.2, vol = 0.09): void {
  for (const p of [-0.4, 0.4]) sweep(ctx, out, t1 - dur, dur, { vol, type: 'highpass', from: 4500, shape: (x) => Math.exp(((x - 1) * dur) / 0.35), pan: p, rev: 0.1 });
}

// The mix

/**
 * Dry, reverb and delay buses into `dest`: a stereo noise-tail reverb with a
 * little pre-delay, and a dotted-eighth ping-pong delay that darkens on each
 * repeat. The sends are high-passed so the low end stays dry.
 */
export function mix(ctx: Ctx, dest: AudioNode, o: { revWet?: number; dlyWet?: number } = {}): Out {
  const { revWet = 0.3, dlyWet = 0.4 } = o;
  const dry = gain(ctx, 1);
  dry.connect(dest);

  const rev = gain(ctx, 1);
  const pre = ctx.createDelay(0.1);
  pre.delayTime.value = 0.03;
  const conv = ctx.createConvolver();
  conv.buffer = impulse(ctx, 2.2);
  rev.connect(filter(ctx, 'highpass', 250)).connect(pre).connect(conv).connect(filter(ctx, 'lowpass', 7000)).connect(gain(ctx, revWet)).connect(dest);

  const dly = gain(ctx, 1);
  dly.channelCount = 1;
  dly.channelCountMode = 'explicit';
  const left = ctx.createDelay(1);
  const right = ctx.createDelay(1);
  left.delayTime.value = right.delayTime.value = 3 * STEP;
  const lpL = filter(ctx, 'lowpass', 3800);
  const lpR = filter(ctx, 'lowpass', 3800);
  const merge = ctx.createChannelMerger(2);
  dly.connect(filter(ctx, 'highpass', 300)).connect(left);
  left.connect(lpL).connect(right);
  right.connect(lpR).connect(gain(ctx, 0.38)).connect(left);
  lpL.connect(merge, 0, 0);
  lpR.connect(merge, 0, 1);
  merge.connect(gain(ctx, dlyWet)).connect(dest);
  merge.connect(gain(ctx, 0.15)).connect(rev);

  return { dry, rev, dly };
}

/** Decaying stereo noise: a room's tail. */
function impulse(ctx: Ctx, seconds: number): AudioBuffer {
  const n = Math.round(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp((-6.9 * i) / n) * 0.5;
  }
  return buf;
}
