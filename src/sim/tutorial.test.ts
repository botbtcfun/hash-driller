import { describe, expect, it } from 'vitest';

import { DOWN, Game, LEFT, RIGHT, UP } from './game';
import { Mine } from './layers';
import { type Lesson, TUTORIAL_ROWS, Tutorial } from './tutorial';

const KEY: Partial<Record<Lesson, number>> = { dig: DOWN, coin: RIGHT, fee: LEFT, loose: UP, level: DOWN, nonce: RIGHT };

const tutorialGame = () => new Game(new Mine({ seed: 'tutorial', layers: [], rows: TUTORIAL_ROWS }));

/** Plays the tutorial as a player following the coach would: holding what each lesson asks for. */
function play(): { game: Game; tutorial: Tutorial; seen: Lesson[] } {
  const game = tutorialGame();
  const tutorial = new Tutorial();
  const seen: Lesson[] = [tutorial.lesson];
  for (let t = 0; t < 60 * 120 && tutorial.lesson !== 'done'; t++) {
    const key = KEY[tutorial.lesson] ?? DOWN;
    tutorial.press(key);
    if (tutorial.waiting) continue;
    game.step(key & tutorial.allowed);
    if (tutorial.tick(game, key & tutorial.allowed)) seen.push(tutorial.lesson);
  }
  return { game, tutorial, seen };
}

describe('tutorial', () => {
  it('teaches every lesson in order, and a player who follows it mines level 1 unharmed', () => {
    const { game, seen } = play();
    expect(seen).toEqual(['dig', 'coin', 'fee', 'loose', 'level', 'nonce', 'mined', 'done']);
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
      game.step(key & tutorial.allowed);
      tutorial.tick(game, key & tutorial.allowed);
    }
    for (let t = 0; t < 120; t++) game.step(0);
    expect(game.lives).toBe(2);
  });

  it('stands still for each lesson with the bot at rest, not between two cells', () => {
    const game = tutorialGame();
    const tutorial = new Tutorial();
    const stops: string[] = [];
    let holding = tutorial.lesson;
    for (let t = 0; t < 60 * 60 && tutorial.lesson !== 'mined'; t++) {
      // A player reading the coach presses the key it asks for, and lets go when the lesson changes.
      if (tutorial.waiting) {
        holding = tutorial.lesson;
        tutorial.press(KEY[holding]!);
      }
      const input = tutorial.lesson === holding ? KEY[holding]! & tutorial.allowed : 0;
      game.step(input);
      tutorial.tick(game, input);
      const { bot } = game;
      if (tutorial.waiting) stops.push(`${tutorial.lesson}:${bot.action}:${bot.x === bot.fromX && bot.y === bot.fromY}`);
    }
    expect(stops).toEqual(['coin:idle:true', 'fee:idle:true', 'loose:idle:true', 'level:idle:true', 'nonce:idle:true']);
  });

  it('keeps going into a lesson already pressing its key', () => {
    const game = tutorialGame();
    const tutorial = new Tutorial();
    tutorial.press(DOWN);
    // Holding ↓ then → together: once the dig lesson ends, → goes on at once.
    for (let t = 0; t < 600 && tutorial.lesson === 'dig'; t++) {
      game.step((DOWN | RIGHT) & tutorial.allowed);
      tutorial.tick(game, (DOWN | RIGHT) & tutorial.allowed);
    }
    for (let t = 0; t < 10; t++) {
      game.step((DOWN | RIGHT) & tutorial.allowed);
      tutorial.tick(game, (DOWN | RIGHT) & tutorial.allowed);
    }
    expect(tutorial.lesson).toBe('coin');
    expect(tutorial.waiting).toBe(false);
  });

  it("keeps to each lesson when the last one's key is mashed through the change", () => {
    const game = tutorialGame();
    const tutorial = new Tutorial();
    tutorial.press(DOWN);
    // ↓ tapped as fast as can be, through the dig lesson and well past its end.
    for (let t = 0; t < 300; t++) {
      const key = t % 2 === 0 ? DOWN : 0;
      tutorial.press(key);
      if (tutorial.waiting) continue;
      game.step(key & tutorial.allowed);
      tutorial.tick(game, key & tutorial.allowed);
    }
    expect(tutorial.lesson).toBe('coin');
    expect(game.bot.y).toBe(6);
  });

  it('moves on, rather than getting stuck, if the bot ends up below a lesson anyway', () => {
    const game = tutorialGame();
    const tutorial = new Tutorial();
    while (tutorial.lesson === 'dig') {
      tutorial.press(DOWN);
      game.step(DOWN & tutorial.allowed);
      tutorial.tick(game, DOWN & tutorial.allowed);
    }
    // Past the rails: the bot digs on down, under the coins it can no longer reach.
    for (let t = 0; t < 120; t++) {
      game.step(DOWN);
      tutorial.tick(game, DOWN);
    }
    expect(game.bot.y).toBeGreaterThan(6);
    expect(['level', 'nonce', 'done']).toContain(tutorial.lesson);
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
