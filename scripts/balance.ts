/**
 * Plays many runs headless with simple policies and prints how they go, for
 * tuning src/sim/rules.ts against numbers instead of feel alone.
 *
 *   pnpm --filter @botbtc/drill balance [seeds=20] [minutes=5]
 */
import { CELL, COLOR, EMPTY, NONCE, isItem } from '../src/sim/grid';
import { DOWN, FALL, Game, JUMP, LEFT, RIGHT, UP, WOBBLE } from '../src/sim/game';
import { Mine } from '../src/sim/layers';
import { Rng } from '../src/sim/rng';
import { CELL_POWER, COMBO_POWER, POWER_MAX, TICK_HZ } from '../src/sim/rules';

type Policy = (game: Game, rng: Rng, t: number) => number;

/** Holds down the whole time. */
const down: Policy = () => DOWN;

/** Mashes: a random input held for a fifth of a second. */
let held = 0;
const random: Policy = (_g, rng, t) => {
  if (t % 12 === 0) held = [DOWN, DOWN, DOWN, LEFT, RIGHT, JUMP, JUMP | LEFT, 0][rng.below(8)]!;
  return held;
};

/** Is anything loose above this column, before the first resting block? */
function danger(game: Game, x: number, y: number): boolean {
  const g = game.grid;
  for (let yy = y - 1; yy >= y - 8; yy--) {
    const b = game.bodies.get(g.bodyAt(x, yy));
    if (b && (b.state === WOBBLE || b.state === FALL)) return true;
    if (!b && g.kindAt(x, yy) !== EMPTY) return false;
  }
  return false;
}

/** Digs down, steps out from under loose blocks, and fetches power cells when low. */
const careful: Policy = (game) => {
  const { x, y } = game.bot;
  const g = game.grid;
  const side = (dx: number) => (dx < 0 ? LEFT : RIGHT);
  if (danger(game, x, y)) {
    for (const dx of [-1, 1]) {
      const k = g.kindAt(x + dx, y);
      if ((k === EMPTY || k === CELL) && !danger(game, x + dx, y)) return side(dx);
    }
    for (const dx of [-1, 1]) if (g.kindAt(x + dx, y) === COLOR && !danger(game, x + dx, y)) return side(dx);
  }
  if (game.power < POWER_MAX / 2) {
    let best: [number, number] | null = null;
    for (let yy = y; yy <= y + 6; yy++) {
      for (let xx = 0; xx < 9; xx++) {
        if (g.kindAt(xx, yy) !== CELL) continue;
        const d = Math.abs(xx - x) + (yy - y);
        if (!best || d < Math.abs(best[0] - x) + (best[1] - y)) best = [xx, yy];
      }
    }
    if (best && best[0] !== x) {
      const dx = best[0] < x ? -1 : 1;
      return side(dx);
    }
  }
  return DOWN;
};

/** The nearest cell of a kind in rows [from, to] around the bot. */
function nearest(game: Game, kind: number, from: number, to: number): [number, number] | null {
  const { x, y } = game.bot;
  let best: [number, number] | null = null;
  for (let yy = y + from; yy <= y + to; yy++) {
    for (let xx = 0; xx < 9; xx++) {
      if (game.grid.kindAt(xx, yy) !== kind) continue;
      if (!best || Math.abs(xx - x) + Math.abs(yy - y) < Math.abs(best[0] - x) + Math.abs(best[1] - y)) best = [xx, yy];
    }
  }
  return best;
}

/** Goes for each nonce, and for power cells when low; otherwise as careful. */
const miner: Policy = (game, rng, t) => {
  const { x, y } = game.bot;
  const g = game.grid;
  const side = (dx: number) => (dx < 0 ? LEFT : RIGHT);
  if (danger(game, x, y)) return careful(game, rng, t);
  const target = nearest(game, NONCE, -3, 14) ?? (game.power < POWER_MAX * 0.6 ? nearest(game, CELL, -1, 8) : null);
  if (!target) return DOWN;
  const [tx, ty] = target;
  if (tx !== x && ty <= y + 1) {
    const dx = tx < x ? -1 : 1;
    const k = g.kindAt(x + dx, y);
    return side(dx);
  }
  if (ty > y) return DOWN;
  if (ty < y) return UP;
  return DOWN;
};

const seeds = Number(process.argv[2] ?? 20);
const minutes = Number(process.argv[3] ?? 5);
const maxTicks = minutes * 60 * TICK_HZ;

const rows = [];
for (const [name, policy] of Object.entries({ down, random, careful, miner })) {
  const totals = { seconds: 0, depth: 0, sats: 0, layer: 0, crush: 0, power: 0, pops: 0, combos: 0, maxCombo: 0, maxChain: 0, cells: 0, fees: 0, difficulty: 0, mined: 0, missed: 0 };
  for (let s = 0; s < seeds; s++) {
    const game = new Game(new Mine({ seed: `balance:${s}`, layers: [] }));
    const rng = new Rng(`policy:${s}`);
    let t = 0;
    for (; t < maxTicks && !game.over; t++) {
      game.step(policy(game, rng, t));
      for (const e of game.events) {
        if (e.type === 'die') totals[e.cause]++;
        else if (e.type === 'pop') {
          totals.pops++;
          if (e.combo >= 2) totals.combos++;
          totals.fees += COMBO_POWER * e.bits.length * (e.combo - 1);
        }
        else if (e.type === 'cell') totals.cells++;
      }
    }
    totals.seconds += t / TICK_HZ;
    totals.depth += game.depth;
    totals.sats += game.sats;
    totals.layer += game.layer;
    totals.maxCombo += game.maxCombo;
    totals.maxChain += game.maxChain;
    totals.mined += game.mined;
    totals.missed += game.missed;
    totals.difficulty += game.difficulty / 1000;
  }
  const avg = (v: number) => Math.round((v / seeds) * 10) / 10;
  rows.push({
    policy: name,
    'survived s': avg(totals.seconds),
    'depth m': avg(totals.depth),
    'm/min': Math.round((totals.depth / totals.seconds) * 60),
    layers: avg(totals.layer),
    mined: avg(totals.mined),
    missed: avg(totals.missed),
    sats: Math.round(totals.sats / seeds),
    'crushes': avg(totals.crush),
    'power outs': avg(totals.power),
    'pops/min': Math.round((totals.pops / totals.seconds) * 60),
    'combos/min': Math.round((totals.combos / totals.seconds) * 60),
    'max combo': avg(totals.maxCombo),
    'max chain': avg(totals.maxChain),
    'cells': avg(totals.cells),
    /** Power from fees against power from cells. */
    'fees:cells': Math.round((totals.fees / Math.max(1, totals.cells * CELL_POWER)) * 100) / 100,
    'diff': avg(totals.difficulty),
  });
}
console.log(`${seeds} seeds, up to ${minutes} min each`);
console.table(rows);
