/**
 * Plays many runs headless with simple policies and prints how they go, for
 * tuning src/sim/rules.ts against numbers instead of feel alone.
 *
 *   pnpm --filter @botbtc/drill balance [seeds=20] [minutes=5]
 */
import { BOMB, COLOR, EMPTY, FEE, NONCE, STEEL, STONE } from '../src/sim/grid';
import { DOWN, FALL, Game, LEFT, RIGHT, UP, WOBBLE } from '../src/sim/game';
import { Mine } from '../src/sim/layers';
import { Rng } from '../src/sim/rng';
import { TICK_HZ } from '../src/sim/rules';

type Policy = (game: Game, rng: Rng, t: number) => number;

/** Holds down the whole time. */
const down: Policy = () => DOWN;

/** Mashes: a random input held for a fifth of a second. */
let held = 0;
const random: Policy = (_g, rng, t) => {
  if (t % 12 === 0) held = [DOWN, DOWN, DOWN, LEFT, RIGHT, UP, UP | LEFT, 0][rng.below(8)]!;
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

/** What can't be dug through on the way down: steel, and bombs, best left alone. */
const blocked = (k: number) => k === STEEL || k === BOMB;

/**
 * Below is blocked: heads along the row for the nearest column it can dig
 * down, going around steel and bombs in the way. 0 if there is none.
 */
function around(game: Game): number {
  const { x, y } = game.bot;
  const g = game.grid;
  for (let d = 1; d < 9; d++) {
    for (const dx of [-d, d]) {
      const tx = x + dx;
      if (tx < 0 || tx > 8 || blocked(g.kindAt(tx, y + 1))) continue;
      let clear = true;
      for (let xx = x + Math.sign(dx); xx !== tx + Math.sign(dx); xx += Math.sign(dx)) if (blocked(g.kindAt(xx, y))) clear = false;
      if (clear) return dx < 0 ? LEFT : RIGHT;
    }
  }
  return 0;
}

/** Digs down, steps out from under loose blocks, and goes around what can't be dug. */
const careful: Policy = (game) => {
  const { x, y } = game.bot;
  const g = game.grid;
  const side = (dx: number) => (dx < 0 ? LEFT : RIGHT);
  if (danger(game, x, y)) {
    for (const dx of [-1, 1]) {
      const k = g.kindAt(x + dx, y);
      if (k === EMPTY && !danger(game, x + dx, y)) return side(dx);
    }
    for (const dx of [-1, 1]) if ((g.kindAt(x + dx, y) === COLOR || g.kindAt(x + dx, y) === STONE) && !danger(game, x + dx, y)) return side(dx);
  }
  if (blocked(g.kindAt(x, y + 1))) return around(game);
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

/** Goes for fees close by, then each nonce; otherwise as careful. */
const miner: Policy = (game, rng, t) => {
  const { x, y } = game.bot;
  const g = game.grid;
  const side = (dx: number) => (dx < 0 ? LEFT : RIGHT);
  if (danger(game, x, y) || blocked(g.kindAt(x, y + 1))) return careful(game, rng, t);
  const target = nearest(game, FEE, 0, 3) ?? nearest(game, NONCE, 0, 14);
  if (!target) return DOWN;
  const [tx, ty] = target;
  if (tx !== x && ty <= y + 1) {
    const dx = tx < x ? -1 : 1;
    // Never step under something already shaking: dig it out first, or wait.
    if (g.kindAt(x + dx, y) === EMPTY && danger(game, x + dx, y)) return 0;
    if (blocked(g.kindAt(x + dx, y))) return DOWN;
    return side(dx);
  }
  if (ty > y) return DOWN;
  if (ty < y) return UP;
  return DOWN;
};

/** A person: the miner's choices, but decided only every `every` ticks and held meanwhile. */
function human(every: number): Policy {
  let last = 0;
  return (game, rng, t) => {
    if (t % every === 0) last = miner(game, rng, t);
    return last;
  };
}

const seeds = Number(process.argv[2] ?? 20);
const minutes = Number(process.argv[3] ?? 5);
const maxTicks = minutes * 60 * TICK_HZ;

/** A run counts as stuck once the bot has gone this long without getting deeper. */
const STUCK_TICKS = 60 * TICK_HZ;

const rows = [];
const policies = { down, random, careful, miner, 'human .25s': human(15), 'novice .4s': human(24) };
for (const [name, policy] of Object.entries(policies)) {
  const totals = { seconds: 0, depth: 0, sats: 0, layer: 0, crush: 0, blast: 0, stuck: 0, maxChain: 0, coins: 0, mined: 0, missed: 0, pops: 0 };
  for (let s = 0; s < seeds; s++) {
    const game = new Game(new Mine({ seed: `balance:${s}`, layers: [] }));
    const rng = new Rng(`policy:${s}`);
    let t = 0;
    let deepest = 0;
    let deeperAt = 0;
    for (; t < maxTicks && !game.over; t++) {
      game.step(policy(game, rng, t));
      for (const e of game.events) {
        if (e.type === 'die') totals[e.cause]++;
        else if (e.type === 'fee') totals.coins++;
        else if (e.type === 'pop') totals.pops++;
      }
      if (game.bot.y > deepest) [deepest, deeperAt] = [game.bot.y, t];
      else if (t - deeperAt > STUCK_TICKS) {
        totals.stuck++;
        break;
      }
    }
    totals.seconds += t / TICK_HZ;
    totals.depth += game.depth;
    totals.sats += game.sats;
    totals.layer += game.layer;
    totals.maxChain += game.maxChain;
    totals.mined += game.mined;
    totals.missed += game.missed;
  }
  const avg = (v: number) => Math.round((v / seeds) * 10) / 10;
  rows.push({
    policy: name,
    'lasted s': avg(totals.seconds),
    'depth m': avg(totals.depth),
    'm/min': Math.round((totals.depth / totals.seconds) * 60),
    level: avg(totals.layer),
    mined: avg(totals.mined),
    missed: avg(totals.missed),
    sats: Math.round(totals.sats / seeds),
    crushes: avg(totals.crush),
    blasts: avg(totals.blast),
    'stuck %': Math.round((totals.stuck / seeds) * 100),
    'max chain': avg(totals.maxChain),
    'fee coins': avg(totals.coins),
  });
}
console.log(`${seeds} seeds, up to ${minutes} min each; a run is stuck after ${STUCK_TICKS / TICK_HZ} s without getting deeper`);
console.table(rows);
