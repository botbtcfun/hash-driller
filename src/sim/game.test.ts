import { describe, expect, it } from 'vitest';

import { DOWN, FALL, Game, type GameEvent, LEFT, RIGHT, UP, WOBBLE } from './game';
import { BOMB, COLOR, EMPTY, FEE, HEADER, NONCE, ROCK, STEEL, STONE } from './grid';
import { Mine, headerY, layerAt } from './layers';
import { InputLog } from './replay';
import { Rng } from './rng';
import * as R from './rules';

/** Runs ticks with one input, returning every event. */
function run(game: Game, ticks: number, input = 0): GameEvent[] {
  const events: GameEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    game.step(input);
    events.push(...game.events);
  }
  return events;
}

/** What a cell holds, as fromRows writes it, and whether it is moving. */
function at(game: Game, x: number, y: number): string {
  const g = game.grid;
  const k = g.kindAt(x, y);
  const body = game.bodies.get(g.bodyAt(x, y));
  const motion = body?.state === WOBBLE ? '~' : body?.state === FALL ? 'v' : '';
  if (k === COLOR) return `${g.color[g.i(x, y)]}${motion}`;
  return ({ [EMPTY]: '.', [ROCK]: '#', [STEEL]: 'S', [STONE]: 'L', [BOMB]: 'B', [HEADER]: '=', [NONCE]: 'N', [FEE]: '$' } as Record<number, string>)[k] ?? '?';
}

const mine = (seed: string) => new Mine({ seed, layers: [] });

describe('drilling', () => {
  it('removes the whole same-colour group and nothing else', () => {
    const game = Game.fromRows([
      '@........', //
      '001122333',
      '011223333',
      '222222222',
    ]);
    const events = run(game, 1, DOWN);
    expect([at(game, 0, 1), at(game, 1, 1), at(game, 0, 2)]).toEqual(['.', '.', '.']);
    expect(at(game, 2, 1)).toBe('1');
    expect(events).toContainEqual(expect.objectContaining({ type: 'drill' }));
    expect(game.sats).toBe(3 * R.DRILL_SATS);
  });

  it('breaks hard rock after ROCK_HITS hits', () => {
    const game = Game.fromRows([
      '@........', //
      '#33333333',
      '333333333',
    ]);
    const rocks = run(game, 1 + 2 * R.DRILL_TICKS, DOWN).filter((e) => e.type === 'rock');
    expect(rocks.map((e) => e.type === 'rock' && e.broken)).toEqual([false, false, true]);
  });

  it('never digs through steel', () => {
    const game = Game.fromRows([
      '@........', //
      'S33333333',
      '333333333',
    ]);
    const events = run(game, 10 * R.DRILL_TICKS, DOWN);
    expect([game.bot.y, at(game, 0, 1)]).toEqual([0, 'S']);
    expect(events.filter((e) => e.type === 'clang').length).toBeGreaterThan(5);
  });

  it('digs steel only when there is no other way down from its row, so the bot is never stuck', () => {
    const game = Game.fromRows([
      '.@.S33333', //
      'SSSS33333',
      '333333333',
    ]);
    run(game, R.DRILL_TICKS + 1, DOWN);
    expect(at(game, 1, 1)).toBe('.');
    const free = Game.fromRows([
      '.@..33333', //
      'SSSS33333',
      '333333333',
    ]);
    run(free, R.DRILL_TICKS + 1, DOWN);
    expect(at(free, 1, 1)).toBe('S');
  });

  it('lights a bomb, which blasts the 3x3 around it once its fuse burns down, steel and all', () => {
    const game = Game.fromRows([
      '@........', //
      'BS3......',
      '333333333',
    ]);
    const lit = run(game, 1, DOWN);
    expect(lit).toContainEqual({ type: 'fuse', x: 0, y: 1 });
    expect(at(game, 0, 1)).toBe('B');
    // Walk clear, out of its reach.
    const events = run(game, R.FUSE_TICKS + 30, RIGHT);
    expect(events).toContainEqual(expect.objectContaining({ type: 'blast', x: 0, y: 1 }));
    expect([at(game, 0, 1), at(game, 1, 1), at(game, 0, 2), at(game, 1, 2)]).toEqual(['.', '.', '.', '.']);
    expect([at(game, 2, 1), at(game, 2, 2)]).toEqual(['3', '3']);
    expect(game.lives).toBe(R.LIVES);
  });

  it('takes the bot in a blast it stays in', () => {
    const game = Game.fromRows([
      '@........', //
      'B33333333',
      '333333333',
    ]);
    run(game, 1, DOWN);
    const events = run(game, R.FUSE_TICKS + 5);
    expect(events).toContainEqual({ type: 'die', cause: 'blast' });
    expect(game.lives).toBe(R.LIVES - 1);
  });

  it('sets off a bomb caught in a blast', () => {
    const game = Game.fromRows([
      '@........', //
      'BB.......',
      '333333333',
    ]);
    run(game, 1, DOWN);
    const events = run(game, R.FUSE_TICKS + R.CHAIN_FUSE_TICKS + 5, RIGHT);
    expect(events.filter((e) => e.type === 'blast')).toHaveLength(2);
    expect(at(game, 2, 2)).toBe('.');
  });
});

describe('gravity', () => {
  it('drops a loose stone at once, with no wobble first', () => {
    const game = Game.fromRows([
      '.........', //
      '..L......',
      '..3@.....',
      '333333333',
    ]);
    const events = run(game, 1, LEFT);
    expect(game.bodies.get(game.grid.bodyAt(2, 1))?.state).toBe(FALL);
    expect(events.some((e) => e.type === 'wobble')).toBe(false);
  });

  it('wobbles a loose block, then drops it until it lands', () => {
    const game = Game.fromRows([
      '.1.......', //
      '@0.......',
      '222222222',
    ]);
    run(game, 1, RIGHT);
    expect(at(game, 1, 0)).toBe('1~');
    run(game, R.WOBBLE_TICKS - 2);
    expect(at(game, 1, 0)).toBe('1~');
    run(game, 2 * R.FALL_TICKS + 1);
    expect([at(game, 1, 0), at(game, 1, 1)]).toEqual(['.', '1']);
  });

  it('digs away a falling piece right above, saving the bot', () => {
    const game = Game.fromRows([
      '.1.......', //
      '.........',
      '.........',
      '.@.......',
      '222222222',
    ]);
    for (let t = 0; t < 200 && at(game, 1, 2) !== '1v'; t++) game.step(0);
    expect(at(game, 1, 2)).toBe('1v');
    run(game, 1, UP);
    run(game, 60);
    expect([at(game, 1, 2), game.lives]).toEqual(['.', R.LIVES]);
  });

  it('smashes a whole stack coming down with one ↑ as it arrives', () => {
    const game = Game.fromRows([
      '222222...', //
      '111111...',
      '.........',
      '..@......',
      '333333333',
    ]);
    let pressed = false;
    for (let t = 0; t < 200; t++) {
      const above = game.grid.kindAt(game.bot.x, game.bot.y - 1) !== EMPTY;
      game.step(above && !pressed ? UP : 0);
      pressed ||= above;
    }
    expect(game.lives).toBe(R.LIVES);
    expect([at(game, 2, 1), at(game, 2, 0)]).toEqual(['.', '.']);
  });

  it('braces with ↑ pressed early, and smashes what comes down as it arrives', () => {
    const game = Game.fromRows([
      '222222...', //
      '111111...',
      '.........',
      '..@......',
      '333333333',
    ]);
    run(game, 1, UP);
    expect(game.braced).toBe(true);
    const events = run(game, 200);
    expect(events.some((e) => e.type === 'die')).toBe(false);
    expect(events.some((e) => e.type === 'hop')).toBe(false);
  });

  it('lets go of the brace to move', () => {
    const game = Game.fromRows([
      '111111...', //
      '.........',
      '..@......',
      '333333333',
    ]);
    run(game, 1, UP);
    run(game, 1, RIGHT);
    expect(game.braced).toBe(false);
  });

  it('still crushes the bot under falling hard rock, braced or not', () => {
    const game = Game.fromRows([
      '..#......', //
      '.........',
      '..@......',
      '333333333',
    ]);
    const events = run(game, 1, UP).concat(run(game, 200));
    expect(events).toContainEqual({ type: 'die', cause: 'crush' });
  });

  it('crushes the bot under a falling block', () => {
    const game = Game.fromRows([
      '.1.......', //
      '.@.......',
      '222222222',
    ]);
    const events = run(game, R.WOBBLE_TICKS + R.FALL_TICKS);
    expect(events).toContainEqual({ type: 'die', cause: 'crush' });
    expect(game.lives).toBe(R.LIVES - 1);
  });

  it('pops four after a fall, and combos a second pop', () => {
    const game = Game.fromRows([
      '.0.......', //
      '@122#####',
      '3000#####',
      '3#22#####',
    ]);
    const events = run(game, 1, RIGHT).concat(run(game, 240));
    const pops = events.filter((e) => e.type === 'pop');
    expect(pops.map((e) => e.type === 'pop' && [e.combo, e.bits.length])).toEqual([
      [1, 4],
      [2, 4],
    ]);
    expect(game.maxCombo).toBe(2);
    expect(game.combo).toBe(0);
    expect(game.sats).toBe(R.DRILL_SATS + R.POP_SATS * 4 * 1 + R.POP_SATS * 4 * 2);
  });

  it('never drops header tiles, and holds up what rests on them', () => {
    const game = Game.fromRows([
      '.1.......', //
      '@=.......',
      '.........',
      '222222222',
    ]);
    run(game, 100);
    expect(game.bodies.size).toBe(0);
    expect([at(game, 1, 0), at(game, 1, 1)]).toEqual(['1', '=']);
  });

  it('starts nothing falling out of sight above the bot', () => {
    const rows = ['1........', ...Array(8).fill('.........'), '.2.......', '.........', '.........', '@........', '333333333'];
    const game = Game.fromRows(rows);
    run(game, 200);
    expect(at(game, 0, 0)).toBe('1');
    expect(at(game, 1, 12)).toBe('2');
    expect(game.lives).toBe(R.LIVES);
  });

  it('keeps blocks on rock, and on blocks of another colour', () => {
    const game = Game.fromRows([
      '1#2......', //
      '0#1......',
      '333333333',
    ]);
    run(game, 100);
    expect(game.bodies.size).toBe(0);
  });
});

describe('the bot', () => {
  it('digs a block it pushes into, rather than climbing it', () => {
    const game = Game.fromRows([
      '.........', //
      '@0.......',
      '333333333',
    ]);
    run(game, 1, RIGHT);
    expect([game.bot.x, game.bot.y, game.bot.action, at(game, 1, 1)]).toEqual([0, 1, 'drill', '.']);
  });

  it('never climbs: what is above stays above', () => {
    const game = Game.fromRows([
      '.........', //
      '@0.......',
      '333333333',
    ]);
    run(game, 3 * R.DRILL_TICKS, RIGHT);
    expect(game.bot.y).toBe(1);
  });

  it('climbs onto steel it walks into, where there is room, and walks on along it', () => {
    const game = Game.fromRows([
      '.........', //
      '.....$...',
      '....@SSS.',
      '333333333',
    ]);
    // The hop onto the first steel, then along the bar to the last.
    const events = run(game, R.CLIMB_TICKS + R.WALK_TICKS + 2, RIGHT);
    expect(events).toContainEqual({ type: 'climb' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'fee' }));
    expect([game.bot.x, game.bot.y]).toEqual([7, 1]);
  });

  it('climbs no steel without room above it and above the bot', () => {
    for (const rows of [
      ['.....1...', '....@S...', '333333333'],
      ['....1....', '....@S...', '333333333'],
    ]) {
      const game = Game.fromRows(rows);
      const events = run(game, 3 * R.CLIMB_TICKS, RIGHT);
      expect(events.some((e) => e.type === 'climb')).toBe(false);
      expect(game.bot.y).toBe(1);
    }
  });

  it('jumps with ↑ where it is open, and comes back down', () => {
    const game = Game.fromRows([
      '.........', //
      '.........',
      '....@....',
      '333333333',
    ]);
    const events = run(game, 1, UP);
    expect(events).toContainEqual({ type: 'hop' });
    expect(game.bot.y).toBe(1);
    run(game, 40);
    expect(game.bot.y).toBe(2);
  });

  it('lands a jump on a ledge with ← or →, pressed during it or held', () => {
    for (const keys of [[UP, RIGHT], [UP | RIGHT, UP | RIGHT]]) {
      const game = Game.fromRows([
        '.........', //
        '.........',
        '....@3...',
        '333333333',
      ]);
      run(game, 2, keys[0]);
      run(game, R.HOP_TICKS, keys[1]);
      run(game, 30);
      expect([game.bot.x, game.bot.y]).toEqual([5, 1]);
    }
  });

  it('digs up instead of jumping when something is coming down', () => {
    const game = Game.fromRows([
      '....1....', //
      '.........',
      '....@....',
      '333333333',
    ]);
    const events = run(game, 1, UP);
    expect(events.some((e) => e.type === 'hop')).toBe(false);
    expect(game.bot.y).toBe(2);
  });

  it('never gets more than a row above its deepest point: a jump is no way back up', () => {
    const game = Game.fromRows([
      '.........', //
      '.........',
      '......2..',
      '....@33..',
      '333333333',
    ]);
    run(game, 2, UP);
    run(game, R.HOP_TICKS, RIGHT);
    run(game, 30);
    expect([game.bot.x, game.bot.y]).toEqual([5, 2]);
    // Up again from the step: no jump, as that would be two rows above the deepest point.
    const events = run(game, 2, UP);
    expect(events.some((e) => e.type === 'hop')).toBe(false);
    expect(game.bot.y).toBe(2);
  });

  it('keeps a tap made while busy, and uses it once free', () => {
    const game = Game.fromRows([
      '@........', //
      '000000000',
      '111111111',
      '222222222',
    ]);
    run(game, 1, DOWN);
    run(game, 2);
    run(game, 1, DOWN);
    run(game, 2 * R.DRILL_TICKS + R.BUFFER_TICKS);
    expect([at(game, 0, 1), at(game, 0, 2)]).toEqual(['.', '.']);
  });

  it('takes one step for a short press, and two for two', () => {
    const rows = ['@........', '333333333'];
    const once = Game.fromRows(rows);
    run(once, 4, RIGHT);
    run(once, 40);
    expect(once.bot.x).toBe(1);
    const twice = Game.fromRows(rows);
    run(twice, 3, RIGHT);
    run(twice, 2);
    run(twice, 2, RIGHT);
    run(twice, 40);
    expect(twice.bot.x).toBe(2);
  });

  it('forgets a tap after BUFFER_TICKS', () => {
    // A four-row fall keeps the bot busy for longer than a tap is kept.
    const game = Game.fromRows([
      '@........', //
      '.11111111',
      '.11111111',
      '.11111111',
      '.11111111',
      '222222222',
    ]);
    run(game, 2);
    run(game, 1, RIGHT);
    run(game, 4 * R.BOT_FALL_TICKS + R.DRILL_TICKS);
    expect([game.bot.y, at(game, 1, 4)]).toEqual([4, '1']);
  });

  it('falls into a hole', () => {
    const game = Game.fromRows([
      '@........', //
      '.33333333',
      '333333333',
    ]);
    run(game, R.BOT_FALL_TICKS + 1);
    expect(game.bot.y).toBe(1);
  });

  it('keeps going as long as the bot does: nothing runs out', () => {
    const game = Game.fromRows(['@........', '333333333']);
    run(game, 60 * 60 * 5);
    expect([game.lives, game.over]).toEqual([R.LIVES, false]);
  });

  it('ends the run with the last life', () => {
    const game = Game.fromRows(['@........', ...Array<string>(12).fill('333333333')]);
    for (let life = 0; life < R.LIVES; life++) {
      // Lands in the last crater, then digs a bomb put right under it, and stays.
      run(game, 60);
      const i = game.grid.i(game.bot.x, game.bot.y + 1);
      game.grid.kind[i] = BOMB;
      game.grid.color[i] = game.grid.hits[i] = 0;
      run(game, 1, DOWN);
      run(game, R.FUSE_TICKS + R.DEATH_TICKS + 5);
    }
    expect(game.over).toBe(true);
  });
});

describe('the mine', () => {
  it('generates the same rows for the same seed', () => {
    const a = mine('day-1');
    const b = mine('day-1');
    const c = mine('day-2');
    let same = true;
    let differs = false;
    for (let y = 0; y < 300; y++) {
      const ra = a.next();
      const rb = b.next();
      const rc = c.next();
      same &&= ra.kind.join() === rb.kind.join() && ra.color.join() === rb.color.join();
      differs ||= ra.color.join() !== rc.color.join();
    }
    expect(same).toBe(true);
    expect(differs).toBe(true);
  });

  it('has air, then easy topsoil, then a header at each layer', () => {
    const m = mine('day-1');
    const rows = Array.from({ length: headerY(3) + 1 }, () => m.next());
    for (let y = 0; y < R.FIELD_TOP; y++) expect(rows[y]!.kind.every((k) => k === EMPTY)).toBe(true);
    for (let y = R.FIELD_TOP; y < headerY(1); y++) {
      expect(rows[y]!.kind.some((k) => k === ROCK)).toBe(false);
      expect(rows[y]!.color.every((c) => c < R.TOPSOIL_COLORS)).toBe(true);
    }
    for (const k of [1, 2, 3]) expect(rows[headerY(k)]!.kind.every((v) => v === HEADER)).toBe(true);
  });

  it('brings each new kind of block on its own level, and none before', () => {
    const first = new Map<number, number>();
    for (const seed of ['day-1', 'day-2', 'day-3', 'day-4', 'day-5']) {
      const m = mine(seed);
      for (let y = 0; y < headerY(7); y++) {
        const k = layerAt(y);
        for (const kind of m.next().kind) if (!first.has(kind) || first.get(kind)! > k) first.set(kind, k);
      }
    }
    expect([first.get(ROCK), first.get(STEEL), first.get(STONE), first.get(BOMB)]).toEqual([R.ROCK_LEVEL, R.STEEL_LEVEL, R.STONE_LEVEL, R.BOMB_LEVEL]);
  });

  it('puts one steel bar in a row at most, never in the row under another, so there is always a way past', () => {
    const m = mine('day-1');
    let above = false;
    for (let y = 0; y < headerY(20); y++) {
      // A fee, bomb or nonce may sit in a bar, but the bar spans STEEL_BAR_MAX at most.
      const steel = [...m.next().kind].flatMap((k, x) => (k === STEEL ? [x] : []));
      if (steel.length) expect(steel.at(-1)! - steel[0]! + 1).toBeLessThanOrEqual(R.STEEL_BAR_MAX);
      expect(above && steel.length > 0).toBe(false);
      above = steel.length > 0;
    }
  });

  it('never drops steel: it is anchored, and holds up what rests on it', () => {
    const game = Game.fromRows([
      '..1......', //
      '..S......',
      '.........',
      '@........',
      '333333333',
    ]);
    run(game, 200);
    expect([at(game, 2, 0), at(game, 2, 1)]).toEqual(['1', 'S']);
  });

  it('scatters fees through every layer, about FEE_CHANCE a row', () => {
    const m = mine('day-1');
    let fees = 0;
    for (let y = 0; y < headerY(11); y++) {
      const row = m.next();
      if (y >= headerY(1)) fees += row.kind.filter((k) => k === FEE).length;
    }
    const perLayer = fees / 10;
    expect(perLayer).toBeGreaterThan(R.FEE_CHANCE * R.LAYER_ROWS * 0.6);
    expect(perLayer).toBeLessThan(R.FEE_CHANCE * R.LAYER_ROWS * 1.4);
  });

  it('hides exactly one nonce in every layer, below its header', () => {
    const m = mine('day-1');
    const nonces: number[] = [];
    for (let y = 0; y < headerY(6); y++) {
      const row = m.next();
      row.kind.forEach((k) => k === NONCE && nonces.push(y));
    }
    expect(nonces).toHaveLength(5);
    nonces.forEach((y, i) => {
      const [lo, hi] = i === 0 ? [R.FIRST_NONCE_MIN_ROW, R.FIRST_NONCE_MAX_ROW] : [R.NONCE_MIN_ROW, R.NONCE_MAX_ROW];
      expect(y - headerY(i + 1)).toBeGreaterThanOrEqual(lo);
      expect(y - headerY(i + 1)).toBeLessThanOrEqual(hi);
    });
  });

  it('points at block 1\'s nonce from the start', () => {
    const game = new Game(mine('day-1'));
    const [, y] = game.nonce()!;
    expect(y - headerY(1)).toBeGreaterThanOrEqual(R.FIRST_NONCE_MIN_ROW);
    expect(y - headerY(1)).toBeLessThanOrEqual(R.FIRST_NONCE_MAX_ROW);
  });
});

describe('mining', () => {
  it('pays the block reward for a nonce', () => {
    const game = Game.fromRows([
      '@N.......', //
      '333333333',
    ]);
    const events = run(game, 1, RIGHT);
    expect(events).toContainEqual(expect.objectContaining({ type: 'nonce', reward: R.BLOCK_REWARD, chain: 1 }));
    expect([game.sats, game.mined]).toEqual([R.BLOCK_REWARD, 1]);
  });

  it('pays fees out with the next nonce, times the chain', () => {
    const game = Game.fromRows([
      '@$$N.....', //
      '333333333',
    ]);
    const events = run(game, 1, RIGHT).concat(run(game, R.WALK_TICKS + 1, RIGHT), run(game, R.WALK_TICKS + 1, RIGHT));
    expect(events.filter((e) => e.type === 'fee').map((e) => e.type === 'fee' && e.pending)).toEqual([R.FEE_SATS, 2 * R.FEE_SATS]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'nonce', fees: 2 * R.FEE_SATS, reward: R.BLOCK_REWARD + 2 * R.FEE_SATS }));
    expect([game.pending, game.sats]).toEqual([0, R.BLOCK_REWARD + 2 * R.FEE_SATS]);
  });

  it('catches a falling nonce instead of being crushed by it', () => {
    const game = Game.fromRows([
      '.N.......', //
      '.@.......',
      '222222222',
    ]);
    const events = run(game, R.WOBBLE_TICKS + R.FALL_TICKS);
    expect(events.map((e) => e.type)).toContain('nonce');
    expect(game.lives).toBe(R.LIVES);
  });

  it('settles every layer left behind as mined or missed, and grows the chain only in a row', () => {
    const game = new Game(mine('day-1'));
    const events = run(game, 4000, DOWN);
    const left = events.filter((e) => e.type === 'layer' && e.layer >= 2).map((e) => (e.type === 'layer' ? e.layer - 1 : 0));
    expect(left.length).toBeGreaterThanOrEqual(2);
    for (const k of left) {
      const settled = events.filter((e) => (e.type === 'nonce' || e.type === 'missed') && e.layer === k);
      expect(settled).toHaveLength(1);
    }
    expect(game.missed).toBeGreaterThan(0);
    // Each nonce pays the subsidy and the fees since the last nonce, times the
    // chain it makes; a miss breaks the chain and loses the fees.
    let chain = 0;
    let fees = 0;
    for (const e of events) {
      if (e.type === 'fee') fees += e.value;
      else if (e.type === 'missed') {
        expect(e.fees).toBe(fees);
        chain = fees = 0;
      } else if (e.type === 'nonce') {
        chain++;
        expect([e.chain, e.fees]).toEqual([chain, fees]);
        const halvings = Math.floor((e.layer - 1) / R.HALVING_LAYERS);
        expect(e.reward).toBe(((R.BLOCK_REWARD >> halvings) + fees) * Math.min(chain, R.MAX_CHAIN));
        fees = 0;
      }
    }
    expect([game.chain, game.pending]).toEqual([chain, fees]);
    // Holding down never digs sideways, so it finds few nonces.
    expect(game.mined).toBeLessThan(game.missed);
  });
});

describe('a whole run', () => {
  /** Plays a mine with random but seeded inputs, held for a few ticks each. */
  function play(seed: string, ticks: number, log?: InputLog): Game {
    const game = new Game(mine(seed));
    const rng = new Rng(`inputs:${seed}`);
    let input = 0;
    for (let t = 0; t < ticks && !game.over; t++) {
      if (t % 12 === 0) input = [DOWN, DOWN, DOWN, LEFT, RIGHT, UP, UP | LEFT, 0][rng.below(8)]!;
      log?.push(input);
      game.step(input);
    }
    return game;
  }

  it('is deterministic', () => {
    const a = play('day-1', 4000);
    expect(a.depth).toBeGreaterThan(20);
    expect(play('day-1', 4000).hash()).toBe(a.hash());
    expect(play('day-2', 4000).hash()).not.toBe(a.hash());
  });

  it('replays from its input log', () => {
    const log = new InputLog();
    const a = play('day-1', 4000, log);
    const inputs = InputLog.decode(log.encode());
    expect(inputs.length).toBe(log.ticks);
    const b = new Game(mine('day-1'));
    for (const input of inputs) b.step(input);
    expect(b.hash()).toBe(a.hash());
  });

});
