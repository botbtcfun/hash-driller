import { CELL, COLOR, FEE, HEADER, NONCE, ROCK, type Row, parseRow } from './grid';
import { Rng } from './rng';
import {
  CELL_CHANCE,
  COLORS,
  CONTESTED_REVEALS,
  CONTESTED_ROCK,
  FEE_CHANCE,
  FIELD_TOP,
  FIRST_NONCE_MAX_ROW,
  FIRST_NONCE_MIN_ROW,
  LAYER_ROWS,
  NONCE_MAX_ROW,
  NONCE_MIN_ROW,
  ROCK_BASE,
  ROCK_MAX,
  ROCK_STEP,
  STICK_LEFT,
  STICK_UP,
  TOPSOIL_CELL_CHANCE,
  TOPSOIL_COLORS,
  TOPSOIL_FEE_CHANCE,
  TOPSOIL_ROWS,
  WIDTH,
} from './rules';

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
        const [lo, hi] = k === 1 ? [FIRST_NONCE_MIN_ROW, FIRST_NONCE_MAX_ROW] : [NONCE_MIN_ROW, NONCE_MAX_ROW];
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
    const colors = k === 0 ? TOPSOIL_COLORS : COLORS;
    let rock = k === 0 ? 0 : Math.min(ROCK_BASE + (k - 1) * ROCK_STEP, ROCK_MAX);
    if (info && info.reveals >= CONTESTED_REVEALS) rock += CONTESTED_ROCK;
    const cells = k === 0 ? TOPSOIL_CELL_CHANCE : CELL_CHANCE;
    const row = new Int8Array(WIDTH).fill(-1);
    for (let x = 0; x < WIDTH; x++) {
      if (rng.chance(rock)) {
        kind[x] = ROCK;
        continue;
      }
      const r = rng.float();
      const left = x > 0 ? row[x - 1]! : -1;
      const up = this.prev[x]!;
      let c: number;
      if (left >= 0 && r < STICK_LEFT) c = left;
      else if (up >= 0 && up < colors && r < STICK_LEFT + STICK_UP) c = up;
      else c = rng.below(colors);
      kind[x] = COLOR;
      color[x] = c;
      row[x] = c;
    }
    if (rng.chance(cells)) {
      const x = rng.below(WIDTH);
      kind[x] = CELL;
      color[x] = 0;
      row[x] = -1;
    }
    if (rng.chance(k === 0 ? TOPSOIL_FEE_CHANCE : FEE_CHANCE)) {
      const x = rng.below(WIDTH);
      if (kind[x] !== CELL) {
        kind[x] = FEE;
        color[x] = 0;
        row[x] = -1;
      }
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
