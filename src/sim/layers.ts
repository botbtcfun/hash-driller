import { BOMB, COLOR, FEE, HEADER, NONCE, ROCK, type Row, STEEL, STONE, parseRow } from './grid';
import { Rng } from './rng';
import * as R from './rules';
import { FIELD_TOP, LAYER_ROWS, TOPSOIL_ROWS, WIDTH } from './rules';


/** A mined block a layer is made from, as the API serves it. */
export interface LayerInfo {
  id: number;
  mined: boolean;
  winner: string | null;
  /** cbBTC paid, in sats, once settled. A label only: never part of the seed. */
  reward: string | null;
  reveals: number;
  target: string | null;
}

export interface MineSpec {
  /** The day's seed, or a random one for Free Dig. */
  seed: string;
  /** Layer 1 first. Past the end, layers come from the seed alone. */
  layers: LayerInfo[];
  /** Rows made by hand, from the top, in place of the generated ones: the tutorial's. */
  rows?: string[];
}

/** The row of layer k's header, for k >= 1. */
export function headerY(k: number): number {
  return FIELD_TOP + TOPSOIL_ROWS + (k - 1) * LAYER_ROWS;
}

/** The layer a row is in: 0 for the air and the topsoil. */
export function layerAt(y: number): number {
  const below = y - FIELD_TOP - TOPSOIL_ROWS;
  return below < 0 ? 0 : 1 + Math.floor(below / LAYER_ROWS);
}

/**
 * Generates the shaft row by row, top down. Each layer has its own random
 * stream, and a row depends only on the rows generated before it, never on
 * play, so everyone digging a seed digs the same mine.
 */
export class Mine {
  private y = 0;
  private rng: Rng | null = null;
  private rngLayer = -1;
  /** Whether the last generated row has a steel bar. */
  private prevSteel = false;
  /** The colours of the last generated row, -1 where it had no colour. */
  private prev = new Int8Array(WIDTH).fill(-1);
  /** Where the current layer's nonce goes. */
  private nonceY = -1;
  private nonceX = 0;

  constructor(readonly spec: MineSpec) {}

  info(k: number): LayerInfo | null {
    return this.spec.layers[k - 1] ?? null;
  }

  next(): Row {
    const y = this.y;
    // Generated even when replaced, so the rows after made ones come out the same.
    const row = this.generate();
    const made = this.spec.rows?.[y];
    return made === undefined ? row : parseRow(made, layerAt(y));
  }

  private generate(): Row {
    const y = this.y++;
    const kind = new Uint8Array(WIDTH);
    const color = new Uint8Array(WIDTH);
    if (y < FIELD_TOP) return { kind, color };

    const k = layerAt(y);
    if (k !== this.rngLayer) {
      const b = this.info(k);
      this.rng = new Rng(`${this.spec.seed}:${k}:${b ? `${b.id}:${b.winner ?? '-'}:${b.target ?? '-'}` : '-'}`);
      this.rngLayer = k;
      if (k >= 1) {
        const [lo, hi] = k === 1 ? [R.FIRST_NONCE_MIN_ROW, R.FIRST_NONCE_MAX_ROW] : [R.NONCE_MIN_ROW, R.NONCE_MAX_ROW];
        this.nonceY = headerY(k) + lo + this.rng.below(hi - lo + 1);
        this.nonceX = this.rng.below(WIDTH);
      }
    }
    const rng = this.rng!;

    if (k >= 1 && y === headerY(k)) {
      kind.fill(HEADER);
      this.prev.fill(-1);
      return { kind, color };
    }

    const info = this.info(k);
    const colors = k === 0 ? R.TOPSOIL_COLORS : R.COLORS;
    let rock = share(k, R.ROCK_LEVEL, R.ROCK_BASE, R.ROCK_STEP, R.ROCK_MAX);
    if (rock && info && info.reveals >= R.CONTESTED_REVEALS) rock += R.CONTESTED_ROCK;
    const stone = share(k, R.STONE_LEVEL, R.STONE_BASE, R.STONE_STEP, R.STONE_MAX);
    const row = new Int8Array(WIDTH).fill(-1);
    for (let x = 0; x < WIDTH; x++) {
      if (rng.chance(rock)) {
        kind[x] = ROCK;
        continue;
      }
      if (rng.chance(stone)) {
        kind[x] = STONE;
        continue;
      }
      const r = rng.float();
      const left = x > 0 ? row[x - 1]! : -1;
      const up = this.prev[x]!;
      let c: number;
      if (left >= 0 && r < R.STICK_LEFT) c = left;
      else if (up >= 0 && up < colors && r < R.STICK_LEFT + R.STICK_UP) c = up;
      else c = rng.below(colors);
      kind[x] = COLOR;
      color[x] = c;
      row[x] = c;
    }
    // One steel bar a row at most, and never in the row under another: a bar
    // is at most 4 of the 9 columns, so there is always a way around it.
    const steel = rng.chance(share(k, R.STEEL_LEVEL, R.STEEL_BASE, R.STEEL_STEP, R.STEEL_MAX));
    if (steel && !this.prevSteel) {
      const length = R.STEEL_BAR_MIN + rng.below(R.STEEL_BAR_MAX - R.STEEL_BAR_MIN + 1);
      const x0 = rng.below(WIDTH - length + 1);
      for (let x = x0; x < x0 + length; x++) {
        kind[x] = STEEL;
        color[x] = 0;
        row[x] = -1;
      }
    }
    this.prevSteel = steel && !this.prevSteel;
    if (rng.chance(share(k, R.BOMB_LEVEL, R.BOMB_BASE, R.BOMB_STEP, R.BOMB_MAX))) {
      const x = rng.below(WIDTH);
      kind[x] = BOMB;
      color[x] = 0;
      row[x] = -1;
    }
    if (rng.chance(k === 0 ? R.TOPSOIL_FEE_CHANCE : R.FEE_CHANCE)) {
      const x = rng.below(WIDTH);
      kind[x] = FEE;
      color[x] = 0;
      row[x] = -1;
    }
    if (y === this.nonceY) {
      kind[this.nonceX] = NONCE;
      color[this.nonceX] = k & 0xff;
      row[this.nonceX] = -1;
    }
    this.prev = row;
    return { kind, color };
  }
}

/** A kind of block's share at layer k: none before its level, then a base growing a step a level to a cap. */
function share(k: number, level: number, base: number, step: number, max: number): number {
  return k < level ? 0 : Math.min(base + (k - level) * step, max);
}
