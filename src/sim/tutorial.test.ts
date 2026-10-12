import { describe, expect, it } from 'vitest';

import { DOWN, Game, LEFT, RIGHT, UP } from './game';
import { Mine } from './layers';
import { type Lesson, TUTORIAL_ROWS, Tutorial } from './tutorial';

const KEY: Partial<Record<Lesson, number>> = { dig: DOWN, cell: RIGHT, fee: LEFT, loose: UP, level: DOWN, nonce: RIGHT };

const tutorialGame = () => new Game(new Mine({ seed: 'tutorial', layers: [], rows: TUTORIAL_ROWS }));

/** Plays the tutorial as a player following the coach would: holding what each lesson asks for. */
function play(): { game: Game; tutorial: Tutorial; seen: Lesson[] } {
  const game = tutorialGame();
  const tutorial = new Tutorial();
  const seen: Lesson[] = [tutorial.lesson];
  for (let t = 0; t < 60 * 120 && tutorial.lesson !== 'done'; t++) {
    const key = KEY[tutorial.lesson] ?? DOWN;
    tutorial.press(key);
    game.step(key & tutorial.allowed);
    if (tutorial.tick(game)) seen.push(tutorial.lesson);
  }
  return { game, tutorial, seen };
}

describe('tutorial', () => {
  it('teaches every lesson in order, and a player who follows it mines level 1 unharmed', () => {
    const { game, seen } = play();
    expect(seen).toEqual(['dig', 'cell', 'fee', 'loose', 'level', 'nonce', 'mined', 'done']);
    expect(game.mined).toBe(1);
    expect(game.lives).toBe(3);
  });

  it('stands still until the player presses what the lesson asks for', () => {
    const tutorial = new Tutorial();
    tutorial.press(RIGHT);
    expect(tutorial.waiting).toBe(true);
    tutorial.press(DOWN);
    expect(tutorial.waiting).toBe(false);
  });

  it('lets through only the key the lesson is about', () => {
    const game = tutorialGame();
    const tutorial = new Tutorial();
    tutorial.press(DOWN);
    for (let t = 0; t < 30; t++) game.step(RIGHT & tutorial.allowed);
    expect(game.bot.x).toBe(4);
  });

  it('crushes a player who ignores the loose block', () => {
    const game = tutorialGame();
    const tutorial = new Tutorial();
    while (tutorial.lesson !== 'loose') {
      const key = KEY[tutorial.lesson]!;
      tutorial.press(key);
      game.step(key);
      tutorial.tick(game);
    }
    for (let t = 0; t < 120; t++) game.step(0);
    expect(game.lives).toBe(2);
  });

  it('generates the rows after its own as the plain mine would', () => {
    const made = new Mine({ seed: 'tutorial', layers: [], rows: TUTORIAL_ROWS });
    const plain = new Mine({ seed: 'tutorial', layers: [] });
    for (let y = 0; y < 120; y++) {
      const a = made.next();
      const b = plain.next();
      if (y >= TUTORIAL_ROWS.length) expect([...a.kind, ...a.color]).toEqual([...b.kind, ...b.color]);
    }
  });
});
