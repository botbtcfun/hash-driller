import { Game } from '../src/sim/game';
import { Mine } from '../src/sim/layers';
import { InputLog } from '../src/sim/replay';
import { RULES_VERSION, TICK_HZ } from '../src/sim/rules';

/** The UTC day a time falls on: one mine a day, the same for everyone. */
export const dayOf = (ms: number) => Math.floor(ms / 86_400_000);

/** The longest run taken: an hour. */
export const MAX_TICKS = 60 * 60 * TICK_HZ;

/** A run as the leaderboard keeps it, worked out by replaying it, never taken on trust. */
export interface Run {
  day: number;
  initials: string;
  sats: number;
  depth: number;
  level: number;
  chain: number;
  ticks: number;
  /** The final state's hash: the same run twice is one entry. */
  hash: number;
  inputs: string;
}

export type Verdict = { ok: true; run: Run } | { ok: false; status: number; error: string };

/**
 * Checks a submitted run: today's or yesterday's mine, this version of the
 * rules, three-letter initials, and inputs that replay to the end of a run.
 * The score is whatever the replay comes to.
 */
export function verify(body: unknown, now: number): Verdict {
  const fail = (status: number, error: string): Verdict => ({ ok: false, status, error });
  if (!body || typeof body !== 'object') return fail(400, 'bad request');
  const { day, rules, initials, inputs } = body as Record<string, unknown>;
  if (rules !== RULES_VERSION) return fail(409, 'the game has been updated: reload to play the new version');
  const today = dayOf(now);
  if (typeof day !== 'number' || (day !== today && day !== today - 1)) return fail(400, 'not a mine of today');
  if (typeof initials !== 'string' || !/^[A-Z0-9]{3}$/.test(initials)) return fail(400, 'initials are three letters or digits');
  if (typeof inputs !== 'string' || inputs.length > 400_000) return fail(400, 'bad inputs');

  let steps: Uint8Array;
  try {
    steps = InputLog.decode(inputs);
  } catch {
    return fail(400, 'bad inputs');
  }
  if (steps.length > MAX_TICKS) return fail(400, 'run too long');

  const game = new Game(new Mine({ seed: `day:${day}`, layers: [] }));
  for (const input of steps) {
    // A finished run's log ends where it did.
    if (game.over) return fail(400, 'inputs after the run ended');
    game.step(input);
  }
  if (!game.over) return fail(400, 'the run is not over');
  return {
    ok: true,
    run: { day, initials, sats: game.sats, depth: game.depth, level: game.layer, chain: game.maxChain, ticks: steps.length, hash: game.hash(), inputs },
  };
}
