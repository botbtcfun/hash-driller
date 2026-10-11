import { describe, expect, it } from 'vitest';

import { DOWN, FALL, Game, type GameEvent, JUMP, LEFT, RIGHT, UP, WOBBLE } from './game';
import { CELL, COLOR, EMPTY, HEADER, NONCE, ROCK } from './grid';
import { Mine, headerY } from './layers';
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
  return ({ [EMPTY]: '.', [ROCK]: '#', [CELL]: '+', [HEADER]: '=', [NONCE]: 'N' } as Record<number, string>)[k] ?? '?';
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

  it('breaks hard rock after ROCK_HITS hits, each costing power', () => {
    const game = Game.fromRows([
      '@........', //
      '#33333333',
      '333333333',
    ]);
    const rocks = run(game, 1 + 2 * R.DRILL_TICKS, DOWN).filter((e) => e.type === 'rock');
    expect(rocks.map((e) => e.type === 'rock' && e.broken)).toEqual([false, false, true]);
    expect(game.power).toBe(R.POWER_MAX - R.ROCK_HITS * R.ROCK_HIT_POWER - game.tick * 1000);
  });
});

describe('gravity', () => {
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

  it('jumps onto a step one block high, the way it holds or faces', () => {
    const game = Game.fromRows([
      '.........', //
      '0@0......',
      '333333333',
    ]);
    run(game, 1, JUMP);
    expect([game.bot.x, game.bot.y, game.bot.action]).toEqual([2, 0, 'climb']);
    const left = Game.fromRows(['.........', '0@0......', '333333333']);
    run(left, 1, JUMP | LEFT);
    expect([left.bot.x, left.bot.y]).toEqual([0, 0]);
  });

  it('cannot jump two blocks high', () => {
    const game = Game.fromRows([
      '.0.......', //
      '@0.......',
      '333333333',
    ]);
    run(game, 1, JUMP);
    expect([game.bot.x, game.bot.y, at(game, 1, 1)]).toEqual([0, 1, '0']);
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

  it('forgets a tap after BUFFER_TICKS', () => {
    const game = Game.fromRows([
      '.........', //
      '@0.......',
      '333333333',
    ]);
    run(game, 1, JUMP);
    run(game, 1, LEFT);
    run(game, 2 * R.CLIMB_TICKS);
    expect([game.bot.x, game.bot.y]).toEqual([1, 0]);
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

  it('collects a power cell by walking into it', () => {
    const game = Game.fromRows([
      '@+.......', //
      '333333333',
    ]);
    run(game, 1500);
    const before = game.power;
    run(game, 1, RIGHT);
    expect(game.power).toBe(before + R.CELL_POWER - 1000);
    expect(at(game, 1, 0)).toBe('.');
  });

  it('dies when power runs out, and the run ends with the last life', () => {
    const game = Game.fromRows(['@........', '333333333']);
    const events = run(game, R.LIVES * (R.POWER_MAX / 1000 + R.DEATH_TICKS) + 10);
    expect(events.filter((e) => e.type === 'die')).toHaveLength(R.LIVES);
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
    expect(left.length).toBeGreaterThan(2);
    for (const k of left) {
      const settled = events.filter((e) => (e.type === 'nonce' || e.type === 'missed') && e.layer === k);
      expect(settled).toHaveLength(1);
    }
    expect(game.missed).toBeGreaterThan(0);
    // Each nonce pays the block reward times the chain it makes; a miss breaks the chain.
    let chain = 0;
    for (const e of events) {
      if (e.type === 'missed') chain = 0;
      else if (e.type === 'nonce') {
        chain++;
        expect(e.chain).toBe(chain);
        const halvings = Math.floor((e.layer - 1) / R.HALVING_LAYERS);
        expect(e.reward).toBe((R.BLOCK_REWARD >> halvings) * Math.min(chain, R.MAX_CHAIN));
      }
    }
    expect(game.chain).toBe(chain);
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
      if (t % 12 === 0) input = [DOWN, DOWN, DOWN, LEFT, RIGHT, JUMP, JUMP | LEFT, 0][rng.below(8)]!;
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
