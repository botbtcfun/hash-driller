import { WIDTH, WINDOW_ROWS } from './rules';

// What a cell holds
export const EMPTY = 0;
export const COLOR = 1;
export const ROCK = 2;
export const CELL = 3;
export const HEADER = 4;
/** A layer's golden nonce. Its colour byte holds the layer it belongs to. */
export const NONCE = 5;
/** Below the generated rows: solid, not drillable. */
export const GROUND = 6;
/** Left or right of the shaft. */
export const WALL = 7;

/** Things the bot picks up by drilling or walking into them. */
export const isItem = (kind: number): boolean => kind === CELL || kind === NONCE;

/** A row as generated: a kind and a colour per column. */
export interface Row {
  kind: Uint8Array;
  color: Uint8Array;
}

/**
 * Rows [top, bottom) of the shaft, in a ring buffer indexed by absolute row.
 * Above top is air. From bottom down is ground that is not generated yet.
 */
export class Grid {
  top = 0;
  bottom = 0;
  readonly kind = new Uint8Array(WIDTH * WINDOW_ROWS);
  readonly color = new Uint8Array(WIDTH * WINDOW_ROWS);
  /** Hits a hard rock has taken. */
  readonly hits = new Uint8Array(WIDTH * WINDOW_ROWS);
  /** The moving body a cell belongs to, or 0 at rest. */
  readonly body = new Int32Array(WIDTH * WINDOW_ROWS);

  i(x: number, y: number): number {
    return (y % WINDOW_ROWS) * WIDTH + x;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && x < WIDTH && y >= this.top && y < this.bottom;
  }

  kindAt(x: number, y: number): number {
    if (x < 0 || x >= WIDTH) return WALL;
    if (y >= this.bottom) return GROUND;
    if (y < this.top) return EMPTY;
    return this.kind[this.i(x, y)]!;
  }

  bodyAt(x: number, y: number): number {
    return this.inside(x, y) ? this.body[this.i(x, y)]! : 0;
  }

  clear(x: number, y: number): void {
    const i = this.i(x, y);
    this.kind[i] = EMPTY;
    this.color[i] = 0;
    this.hits[i] = 0;
    this.body[i] = 0;
  }

  /** Moves a cell's contents one row down. The cell below must be empty. */
  moveDown(x: number, y: number): void {
    const from = this.i(x, y);
    const to = this.i(x, y + 1);
    this.kind[to] = this.kind[from]!;
    this.color[to] = this.color[from]!;
    this.hits[to] = this.hits[from]!;
    this.body[to] = this.body[from]!;
    this.clear(x, y);
  }

  push(row: Row): void {
    if (this.bottom - this.top >= WINDOW_ROWS) throw new Error('grid window full');
    const y = this.bottom++;
    for (let x = 0; x < WIDTH; x++) {
      this.clear(x, y);
      const i = this.i(x, y);
      this.kind[i] = row.kind[x]!;
      this.color[i] = row.color[x]!;
    }
  }

  dropTop(): void {
    for (let x = 0; x < WIDTH; x++) this.clear(x, this.top);
    this.top++;
  }
}
