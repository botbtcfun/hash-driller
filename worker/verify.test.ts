import { describe, expect, it } from 'vitest';

import { DOWN, Game, LEFT, RIGHT, UP } from '../src/sim/game';
import { Mine } from '../src/sim/layers';
import { InputLog } from '../src/sim/replay';
import { Rng } from '../src/sim/rng';
import { RULES_VERSION } from '../src/sim/rules';
import { dayOf, verify } from './verify';

const NOW = Date.UTC(2026, 9, 14, 12);
const DAY = dayOf(NOW);

/** Plays today's mine with seeded random inputs to its end, as the browser would log it. */
function play(): { game: Game; inputs: string } {
  const game = new Game(new Mine({ seed: `day:${DAY}`, layers: [] }));
  const log = new InputLog();
  const rng = new Rng('verify');
  let input = 0;
  for (let t = 0; !game.over && t < 60 * 60 * 60; t++) {
    if (t % 12 === 0) input = [DOWN, DOWN, DOWN, LEFT, RIGHT, UP, 0][rng.below(7)]!;
    log.push(input);
    game.step(input);
  }
  return { game, inputs: log.encode() };
}

describe('verifying a run', () => {
  const { game, inputs } = play();
  const body = { day: DAY, rules: RULES_VERSION, initials: 'ABC', inputs };

  it('replays a finished run to the score the browser saw', () => {
    expect(game.over).toBe(true);
    const verdict = verify(body, NOW);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect([verdict.run.sats, verdict.run.depth, verdict.run.level, verdict.run.chain, verdict.run.hash]).toEqual([game.sats, game.depth, game.layer, game.maxChain, game.hash()]);
  });

  it("takes yesterday's mine, for a run over midnight, but nothing older", () => {
    expect(verify(body, NOW + 86_400_000).ok).toBe(true);
    expect(verify(body, NOW + 2 * 86_400_000).ok).toBe(false);
    expect(verify({ ...body, day: DAY + 1 }, NOW).ok).toBe(false);
  });

  it('turns away a run cut short, or one going on past its end', () => {
    const steps = InputLog.decode(inputs);
    const cut = new InputLog();
    for (const s of steps.subarray(0, steps.length - 100)) cut.push(s);
    expect(verify({ ...body, inputs: cut.encode() }, NOW)).toMatchObject({ ok: false, error: 'the run is not over' });
    const long = new InputLog();
    for (const s of steps) long.push(s);
    long.push(0);
    expect(verify({ ...body, inputs: long.encode() }, NOW)).toMatchObject({ ok: false, error: 'inputs after the run ended' });
  });

  it('asks an old version of the game to reload', () => {
    expect(verify({ ...body, rules: RULES_VERSION - 1 }, NOW)).toMatchObject({ ok: false, status: 409 });
  });

  it('takes three letters or digits as initials, and nothing else', () => {
    for (const initials of ['AB', 'ABCD', 'ab1', 'A C', '<b>']) expect(verify({ ...body, initials }, NOW).ok).toBe(false);
    expect(verify({ ...body, initials: 'X9Z' }, NOW).ok).toBe(true);
  });

  it('turns away inputs that are not a log', () => {
    for (const bad of ['zz', '1.0', 'x', 42]) expect(verify({ ...body, inputs: bad }, NOW).ok).toBe(false);
  });
});
