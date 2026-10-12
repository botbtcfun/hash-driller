import { DOWN, FALL, type Game, LEFT, RIGHT, UP, WOBBLE } from './game';
import { headerY } from './layers';

/**
 * The tutorial's mine, made by hand so every lesson is where the coach says:
 * three blocks to dig down through, a cell to the right, a fee to the left
 * with a block over it that comes loose, a column down through the LEVEL 1
 * line, and level 1's golden # two blocks right of where it comes out. Every
 * block on the way stands alone, so digging it takes nothing else with it.
 * Past these rows the mine goes on generated. Rows 0-3 are air; the bot
 * starts on row 3, in the middle.
 */
export const TUTORIAL_ROWS = [
  '.........',
  '.........',
  '.........',
  '.........',
  '111102222',
  '112132222',
  '11$303+22',
  '110112222',
  '113112222',
  '110112222',
  '113112222',
  '110112222',
  '=========',
  '11030N222',
  '111112222',
  '300112233',
  '301122303',
  '221+30011',
  '2213$0012',
  '330011220',
  '301122003',
  '112230032',
];

/** The row of the cell and the fee: the dig lesson ends on reaching it. */
const ITEM_ROW = TUTORIAL_ROWS.findIndex((r) => r.includes('+'));

/** What the coach is teaching, in order, then the level mined and the tutorial done. */
export type Lesson = 'dig' | 'cell' | 'fee' | 'loose' | 'level' | 'nonce' | 'mined' | 'done';

/** The lessons that count as steps, for "2/6". */
export const LESSONS: Lesson[] = ['dig', 'cell', 'fee', 'loose', 'level', 'nonce'];

const ANY = LEFT | RIGHT | UP | DOWN;

/**
 * The keys each lesson lets through: just the one it's about, so the bot
 * can't wander off the lesson, or below the # with no way back up.
 */
const ALLOWED: Record<Lesson, number> = { dig: DOWN, cell: RIGHT, fee: LEFT, loose: UP, level: DOWN, nonce: RIGHT, mined: ANY, done: 0 };

/** How long the mined level is celebrated before the tutorial's last screen. */
const MINED_TICKS = 90;

/**
 * The tutorial's lessons, moved on by what happens in the game. Each lesson
 * starts with the mine standing still until the player presses what it asks
 * for, so there is time to read.
 */
export class Tutorial {
  lesson: Lesson = 'dig';
  waiting = true;
  /**
   * A lesson began while the bot was on the move: the mine stands still once
   * it comes to rest, not before, or it would hang between two cells.
   */
  private settling = false;
  private minedAt = 0;

  /** The keys let through to the game now. */
  get allowed(): number {
    return ALLOWED[this.lesson];
  }

  /** Presses made while waiting: one the lesson asks for sets the mine going. */
  press(fresh: number): void {
    if (this.waiting && fresh & this.allowed) this.waiting = false;
  }

  /**
   * After each tick, with the input it had: moves to the next lesson once this
   * one is done. Returns whether it did.
   */
  tick(game: Game, input: number): boolean {
    const next = this.next(game);
    if (next) {
      this.lesson = next;
      // Only the celebration of the mined level runs on by itself, and the last screen covers the mine.
      this.settling = next !== 'mined' && next !== 'done';
      this.waiting = next === 'done';
      if (next === 'mined') this.minedAt = game.tick;
    }
    // Already pressing what the new lesson asks for: no need to stop.
    if (this.settling && input & this.allowed) this.settling = false;
    if (this.settling && game.bot.action === 'idle') {
      this.settling = false;
      this.waiting = true;
    }
    return !!next;
  }

  private next(game: Game): Lesson | null {
    const saw = (type: string) => game.events.some((e) => e.type === type);
    switch (this.lesson) {
      case 'dig':
        return game.bot.y >= ITEM_ROW ? 'cell' : null;
      case 'cell':
        return saw('cell') ? 'fee' : null;
      case 'fee':
        // Taking the fee leaves the block over it hanging: the next lesson.
        return saw('fee') ? (saw('wobble') ? 'loose' : 'level') : null;
      case 'loose':
        return [...game.bodies.values()].some((b) => b.state === WOBBLE || b.state === FALL) ? null : 'level';
      case 'level':
        // Through the line and a row into level 1, level with its #.
        return game.bot.y > headerY(1) ? 'nonce' : null;
      case 'nonce':
        return saw('nonce') ? 'mined' : null;
      case 'mined':
        return game.tick - this.minedAt >= MINED_TICKS ? 'done' : null;
      default:
        return null;
    }
  }
}
