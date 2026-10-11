import type Phaser from 'phaser';

import bot from '../art/bot.json';

export const TILE = 16;

/** Block colours: base, highlight, shade. Blue is left to the bot. */
export const BLOCK_COLORS: [string, string, string][] = [
  ['#f7931a', '#ffc46b', '#a85f08'],
  ['#33ff99', '#a3ffd0', '#0f9e5a'],
  ['#ff4d79', '#ff9db4', '#a3193f'],
  ['#9b5cff', '#c9a6ff', '#5a24b3'],
];
export const PARTICLE_COLORS = BLOCK_COLORS.map(([base]) => parseInt(base.slice(1), 16));

const OUTLINE = '#00081c';
export const BG = '#000c26';

/** A small mark per colour, so colours can be told apart without seeing them. */
const SYMBOLS = [
  ['####', '#..#', '#..#', '####'],
  ['.##.', '#..#', '#..#', '.##.'],
  ['.##.', '####', '####', '.##.'],
  ['#..#', '.##.', '.##.', '#..#'],
];

const ROCK = ['#4a5578', '#6b7aa6', '#2a3150', '#1f2540'];

const CRACKS = [
  [],
  ['......#.........', '.....#..........', '.....##.........', '......#.........', '.......#........'],
  [
    '......#.........',
    '.....#....#.....',
    '.....##..#......',
    '......#.#.......',
    '.......#........',
    '......#.##......',
    '.....#....#.....',
    '..........#.....',
  ],
];

const DRILL = ['##...', '####.', '#####', '####.', '##...'];

/** The nonce's glyph: a hash sign. */
const HASH = ['.#.#.', '#####', '.#.#.', '#####', '.#.#.'];

const ARROW = ['#######', '.#####.', '..###..', '...#...'];

const WARN = ['.###.', '#####', '#####', '.###.', '.###.', '..#..', '.....', '.###.', '.###.'];

const STAR = ['...#...', '...#...', '..#W#..', '##WWW##', '..#W#..', '...#...', '...#...'];

/** The nonce's halo: rings of gold, stepped like pixel art, faintest outside. */
export const GLOW_SIZE = 48;
const GLOW_RINGS: [radius: number, alpha: number][] = [
  [24, 0.08],
  [19, 0.12],
  [14, 0.18],
  [10, 0.26],
];

type Ctx = CanvasRenderingContext2D;

function canvas(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: Ctx) => void): void {
  const tex = scene.textures.createCanvas(key, w, h)!;
  draw(tex.getContext());
  tex.refresh();
}

function grid(ctx: Ctx, rows: string[], palette: Record<string, string>, ox = 0, oy = 0): void {
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const c = palette[ch];
      if (!c) return;
      ctx.fillStyle = c;
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }),
  );
}

/**
 * A block tile. `mask` says which sides join a block of the same group (1 up,
 * 2 right, 4 down, 8 left): joined sides get no edge, so a group reads as one
 * shape.
 */
function block(ctx: Ctx, color: number, mask: number): void {
  const [base, hi, lo] = BLOCK_COLORS[color]!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TILE, TILE);
  const up = mask & 1;
  const right = mask & 2;
  const down = mask & 4;
  const left = mask & 8;
  ctx.fillStyle = hi;
  if (!up) ctx.fillRect(0, 1, TILE, 1);
  if (!left) ctx.fillRect(1, 0, 1, TILE);
  ctx.fillStyle = lo;
  if (!down) ctx.fillRect(0, TILE - 2, TILE, 1);
  if (!right) ctx.fillRect(TILE - 2, 0, 1, TILE);
  ctx.fillStyle = OUTLINE;
  if (!up) ctx.fillRect(0, 0, TILE, 1);
  if (!down) ctx.fillRect(0, TILE - 1, TILE, 1);
  if (!left) ctx.fillRect(0, 0, 1, TILE);
  if (!right) ctx.fillRect(TILE - 1, 0, 1, TILE);
  grid(ctx, SYMBOLS[color]!, { '#': lo }, 6, 6);
}

export function makeTextures(scene: Phaser.Scene): void {
  for (let c = 0; c < BLOCK_COLORS.length; c++) {
    for (let mask = 0; mask < 16; mask++) canvas(scene, `block${c}_${mask}`, TILE, TILE, (ctx) => block(ctx, c, mask));
  }

  for (let hits = 0; hits < CRACKS.length; hits++) {
    canvas(scene, `rock${hits}`, TILE, TILE, (ctx) => {
      const [base, hi, lo, speck] = ROCK;
      ctx.fillStyle = OUTLINE;
      ctx.fillRect(0, 0, TILE, TILE);
      ctx.fillStyle = base!;
      ctx.fillRect(1, 1, TILE - 2, TILE - 2);
      ctx.fillStyle = hi!;
      ctx.fillRect(1, 1, TILE - 2, 1);
      ctx.fillRect(1, 1, 1, TILE - 2);
      ctx.fillStyle = lo!;
      ctx.fillRect(1, TILE - 2, TILE - 2, 1);
      ctx.fillRect(TILE - 2, 1, 1, TILE - 2);
      ctx.fillStyle = speck!;
      for (const [x, y] of [[4, 4], [10, 3], [7, 9], [12, 11], [3, 12], [11, 7]]) ctx.fillRect(x!, y!, 2, 1);
      grid(ctx, CRACKS[hits]!, { '#': OUTLINE }, 0, 4);
    });
  }

  for (const frame of [0, 1]) {
    canvas(scene, `cell${frame}`, TILE, TILE, (ctx) => {
      const glow = frame ? '#fff3a8' : '#ffd60a';
      grid(
        ctx,
        [
          '................',
          '......####......',
          '.....######.....',
          '....oyyyyyyo....',
          '....oyGGyyyo....',
          '....oyGyyyyo....',
          '....oyyyyyyo....',
          '....oyyyyyyo....',
          '....oyy##yyo....',
          '....oy####yo....',
          '....oyy##yyo....',
          '....oyyyyyyo....',
          '....oyyyyyyo....',
          '....oyyyyyyo....',
          '....oooooooo....',
          '................',
        ],
        { '#': '#7a6300', o: '#7a6300', y: '#ffd60a', G: glow },
      );
    });
  }

  canvas(scene, 'header', TILE, TILE, (ctx) => {
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(0, 0, TILE, TILE);
    ctx.fillStyle = '#06246b';
    ctx.fillRect(0, 1, TILE, TILE - 2);
    ctx.fillStyle = '#4d8bff';
    ctx.fillRect(0, 2, TILE, 1);
    ctx.fillStyle = '#0033a3';
    ctx.fillRect(0, TILE - 3, TILE, 1);
  });

  // The nonce: gold with a hash sign, and a glint that sweeps across it.
  for (const frame of [0, 1, 2, 3]) {
    canvas(scene, `nonce${frame}`, TILE, TILE, (ctx) => {
      ctx.fillStyle = OUTLINE;
      ctx.fillRect(0, 0, TILE, TILE);
      ctx.fillStyle = '#ffd60a';
      ctx.fillRect(1, 1, TILE - 2, TILE - 2);
      ctx.fillStyle = '#fff3a8';
      ctx.fillRect(1, 1, TILE - 2, 1);
      ctx.fillRect(1, 1, 1, TILE - 2);
      ctx.fillStyle = '#b88a00';
      ctx.fillRect(1, TILE - 2, TILE - 2, 1);
      ctx.fillRect(TILE - 2, 1, 1, TILE - 2);
      grid(ctx, HASH, { '#': '#b88a00' }, 5, 5);
      if (frame) {
        ctx.fillStyle = '#ffffff';
        const x0 = frame * 4 - 2;
        for (let i = 0; i < 12; i++) {
          const x = x0 + i;
          const y = 13 - i;
          if (x >= 2 && x < TILE - 2 && y >= 2 && y < TILE - 2) ctx.fillRect(x, y, 2, 1);
        }
      }
    });
  }
  canvas(scene, 'arrow', 7, 4, (ctx) => grid(ctx, ARROW, { '#': '#ffd60a' }));
  canvas(scene, 'warn', 5, 9, (ctx) => grid(ctx, WARN, { '#': '#ff4d79' }));
  canvas(scene, 'star', 7, 7, (ctx) => grid(ctx, STAR, { '#': '#ffe066', W: '#ffffff' }));
  canvas(scene, 'glow', GLOW_SIZE, GLOW_SIZE, (ctx) => {
    const c = GLOW_SIZE / 2;
    for (const [r, a] of GLOW_RINGS) {
      ctx.fillStyle = `rgba(255, 214, 10, ${a})`;
      for (let y = 0; y < GLOW_SIZE; y++) {
        for (let x = 0; x < GLOW_SIZE; x++) if ((x + 0.5 - c) ** 2 + (y + 0.5 - c) ** 2 <= r * r) ctx.fillRect(x, y, 1, 1);
      }
    }
  });

  canvas(scene, 'bot', TILE, TILE, (ctx) => grid(ctx, bot.rows, bot.palette as Record<string, string>));
  canvas(scene, 'drill', 5, 5, (ctx) => grid(ctx, DRILL, { '#': '#c9d3e8' }));
  canvas(scene, 'px', 2, 2, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 2, 2);
  });
}
