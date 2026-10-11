import type { Game, GameEvent } from '../sim/game';
import { HEADER } from '../sim/grid';
import { POWER_MAX } from '../sim/rules';
import { CHORDS, renderMusic, type Stems } from './music';
import {
  type Out,
  bell,
  blip,
  crash,
  downlifter,
  e808,
  impact,
  keys,
  keysChord,
  mix,
  pluck,
  reverseCymbal,
  riser,
  stab,
  subDrop,
  sweep,
  whoosh,
} from './synth';

const MUTED_KEY = 'hash-driller:muted';
const MUSIC_VOL = 0.5;
const FX_VOL = 0.85;
/** F minor pentatonic, from F4: combos climb it. */
const PENTA = [65, 68, 70, 72, 75, 77, 80, 82, 84, 87, 89];
/** The chord a mined nonce stabs, by chain length: up through the song's chords. */
const MINED_CHORDS = ['Fm', 'Ab', 'Db', 'Eb'] as const;

/**
 * The soundtrack and the sound effects, all synthesised. Silent until the
 * first key or tap, as browsers require; the music renders in the meantime.
 */
export class Sound {
  muted = load();
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private muffle!: BiquadFilterNode;
  private fx!: Out;
  /** The bed, the beat and the hook, each behind its own fader. */
  private stems: GainNode[] = [];
  private stemsReady: Promise<Stems | null>;
  private level = 0;
  private muffled = false;
  private last = new Map<string, number>();
  private nextBeat = 0;

  constructor() {
    this.stemsReady = renderMusic().catch(() => null);
  }

  /** Call from a key or tap handler: browsers only start audio from one. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = (this.ctx = new Ctor());
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 10;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(comp).connect(ctx.destination);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0;
      this.muffle = ctx.createBiquadFilter();
      this.muffle.type = 'lowpass';
      this.muffle.frequency.value = 20000;
      this.muffle.connect(this.musicBus).connect(this.master);
      const fxBus = ctx.createGain();
      fxBus.gain.value = FX_VOL;
      fxBus.connect(this.master);
      this.fx = mix(ctx, fxBus, { revWet: 0.25, dlyWet: 0.3 });
      void this.stemsReady.then((stems) => stems && this.startMusic(stems));
    }
    void this.ctx.resume();
  }

  /** Stops all sound while the page is hidden. */
  setHidden(hidden: boolean): void {
    if (!this.ctx) return;
    void (hidden ? this.ctx.suspend() : this.ctx.resume());
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTED_KEY, this.muted ? '1' : '0');
    } catch {
      // Storage can be blocked; the setting then lasts for this visit.
    }
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  private startMusic(stems: Stems): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.1;
    this.stems = stems.map((buf, i) => {
      const g = ctx.createGain();
      g.gain.value = i === 0 || i <= this.level ? 1 : 0;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(g).connect(this.muffle);
      src.start(t);
      return g;
    });
    this.musicBus.gain.setValueAtTime(0, t);
    this.musicBus.gain.linearRampToValueAtTime(MUSIC_VOL, t + 2);
  }

  /**
   * Once a frame: how hot the music runs, muffled while paused, low on power
   * or over, and a heartbeat when power is low.
   */
  frame(game: Game, paused: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const level = game.over ? 0 : game.chain >= 2 ? 2 : game.layer >= 1 ? 1 : 0;
    if (level !== this.level) {
      this.level = level;
      this.stems.forEach((g, i) => g.gain.setTargetAtTime(i === 0 || i <= level ? 1 : 0, t, i === 2 && level < 2 ? 0.08 : 0.3));
    }
    const low = game.power < POWER_MAX / 4 && game.bot.action !== 'dead' && !game.over;
    const muffled = paused || game.over || low;
    if (muffled !== this.muffled) {
      this.muffled = muffled;
      this.muffle.frequency.setTargetAtTime(muffled ? 700 : 20000, t, 0.12);
    }
    if (low && !paused && !this.muted && t >= this.nextBeat) {
      this.nextBeat = t + 0.8;
      blip(ctx, this.fx, t, { from: 70, to: 45, glide: 0.05, vol: 0.32, decay: 0.08 });
      blip(ctx, this.fx, t + 0.17, { from: 62, to: 42, glide: 0.05, vol: 0.22, decay: 0.08 });
    }
  }

  /** The press of a key on the start screen. */
  start(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + 0.02;
    impact(ctx, this.fx, t, 0.3);
    whoosh(ctx, this.fx, t + 0.25, 0.06, 1);
    bell(ctx, this.fx, t + 0.05, 89, { vol: 0.04 });
  }

  events(events: GameEvent[]): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || !events.length) return;
    const t = ctx.currentTime + 0.01;
    const out = this.fx;
    for (const e of events) {
      switch (e.type) {
        case 'drill': {
          if (!this.every('drill', 0.05)) break;
          const p = 1 + (Math.random() - 0.5) * 0.12;
          const size = e.bits.length;
          const header = e.bits[0]?.kind === HEADER;
          sweep(ctx, out, t, 0.08, { vol: 0.15, from: 2400 * p, to: 900 * p, q: 0.9, shape: (x) => Math.exp(-x * 6) });
          blip(ctx, out, t, { from: (header ? 120 : 165) * p, to: 60, glide: 0.03, vol: 0.26, decay: 0.045 });
          if (size >= 4) sweep(ctx, out, t, 0.2, { vol: 0.12 * Math.min(size, 10) / 10, type: 'lowpass', from: 800, shape: (x) => Math.exp(-x * 5) });
          break;
        }
        case 'shatter':
          sweep(ctx, out, t, 0.2, { vol: 0.15, from: 3000, to: 800, shape: (x) => Math.exp(-x * 5) });
          break;
        case 'rock':
          bell(ctx, out, t, 79 + Math.round(Math.random() * 2), { vol: 0.045, len: 0.25, rev: 0.15, dly: 0 });
          sweep(ctx, out, t, 0.06, { vol: 0.1, type: 'highpass', from: 3000, shape: (x) => 1 - x });
          blip(ctx, out, t, { from: 220, to: 120, vol: 0.14, decay: 0.05 });
          if (e.broken) {
            sweep(ctx, out, t, 0.32, { vol: 0.18, type: 'lowpass', from: 1500, to: 400, shape: (x) => Math.exp(-x * 4) });
            blip(ctx, out, t, { from: 90, to: 45, vol: 0.25, decay: 0.08 });
          }
          break;
        case 'cell':
          [77, 80, 84, 89].forEach((m, i) => bell(ctx, out, t + i * 0.045, m, { vol: 0.07, p: -0.3 + i * 0.2 }));
          sweep(ctx, out, t, 0.3, { vol: 0.08, from: 600, to: 5000, q: 1.2, shape: (x) => Math.sin(Math.PI * x) ** 2 });
          break;
        case 'nonce': {
          // The big one: an impact, a chord stab that climbs with the chain, an 808 and sparkles.
          const name = MINED_CHORDS[(e.chain - 1) % MINED_CHORDS.length]!;
          const up = 12 * Math.min(2, Math.floor((e.chain - 1) / MINED_CHORDS.length));
          const ch = CHORDS[name];
          impact(ctx, out, t, 0.3);
          crash(ctx, out, t, 0.035);
          stab(ctx, out, t, ch.pad.map((m) => m + up), { vol: 0.16, len: 0.9 });
          e808(ctx, out, t, 0.5, ch.root + 12, { vol: 0.2 });
          ch.pad.slice(-3).forEach((m, i) => bell(ctx, out, t + 0.09 + i * 0.07, m + 12 + up, { vol: 0.04, p: (i - 1) * 0.5 }));
          break;
        }
        case 'missed':
          downlifter(ctx, out, t, 0.9, 0.09);
          e808(ctx, out, t, 0.6, 36, { from: 41, glide: 0.15, vol: 0.18 });
          keys(ctx, out, t, 0.5, 53, { vol: 0.05 });
          keys(ctx, out, t + 0.02, 0.5, 52, { vol: 0.04 });
          break;
        case 'pop': {
          if (!this.every('pop', 0.04)) break;
          const m = PENTA[Math.min(PENTA.length - 1, e.combo - 1 + Math.min(3, e.bits.length >> 2))]!;
          pluck(ctx, out, t, m + 12, { vol: 0.2, len: 0.35, cut: 1500, env: 5000, dly: 0.35 });
          blip(ctx, out, t, { from: 500, to: 1100, glide: 0.015, vol: 0.2, decay: 0.035 });
          break;
        }
        case 'land':
          if (!this.every('land', 0.07)) break;
          sweep(ctx, out, t, 0.12, { vol: 0.13, type: 'lowpass', from: 400, shape: (x) => Math.exp(-x * 5) });
          blip(ctx, out, t, { from: 95, to: 48, vol: 0.16, decay: 0.05 });
          break;
        case 'wobble':
          if (!this.every('wobble', 0.25)) break;
          sweep(ctx, out, t, 0.35, { vol: 1, from: 900, q: 4, shape: (x) => (0.5 + 0.5 * Math.sin(2 * Math.PI * 7.7 * x)) * Math.sin(Math.PI * x) });
          break;
        case 'jump':
          blip(ctx, out, t, { from: 320, to: 720, glide: 0.03, vol: 0.12, decay: 0.06 });
          sweep(ctx, out, t, 0.16, { vol: 0.06, from: 800, to: 3500, shape: (x) => Math.sin(Math.PI * x) ** 2 });
          break;
        case 'die':
          if (e.cause === 'crush') {
            impact(ctx, out, t, 0.38);
            sweep(ctx, out, t, 0.35, { vol: 0.2, type: 'lowpass', from: 2500, to: 300, shape: (x) => Math.exp(-x * 3) });
            e808(ctx, out, t, 0.8, 29, { from: 41, glide: 0.2, vol: 0.25, drive: 6 });
          } else {
            blip(ctx, out, t, { type: 'sawtooth', from: 440, to: 55, glide: 0.3, vol: 0.3, decay: 0.45, cut: 2500, cutTo: 150 });
            downlifter(ctx, out, t, 1, 0.08);
            subDrop(ctx, out, t + 0.3, 0.2);
          }
          break;
        case 'respawn':
          riser(ctx, out, t, t + 0.45, 0.12);
          bell(ctx, out, t + 0.45, 84, { vol: 0.08 });
          break;
        case 'layer':
          whoosh(ctx, out, t + 0.25, 0.27, -1);
          if (e.halving) {
            reverseCymbal(ctx, out, t + 0.7, 0.7, 0.07);
            impact(ctx, out, t + 0.7, 0.35);
            subDrop(ctx, out, t + 0.7, 0.25);
          }
          break;
        case 'over':
          downlifter(ctx, out, t, 1.6, 0.1);
          impact(ctx, out, t, 0.3);
          keysChord(ctx, out, t, 1.5, [41, 48, 53, 56], 0.05);
          break;
      }
    }
  }

  /** Throttles a sound to once per `gap` seconds. */
  private every(name: string, gap: number): boolean {
    const now = this.ctx!.currentTime;
    if (now - (this.last.get(name) ?? -1) < gap) return false;
    this.last.set(name, now);
    return true;
  }
}

function load(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}
