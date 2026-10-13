import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

interface Art {
  palette: Record<string, string>;
  rows: string[];
}

const readBot = () => JSON.parse(readFileSync(new URL('./src/art/bot.json', import.meta.url), 'utf8')) as Art;

/** The B-bot as an SVG, from the same pixel grid the game draws it from. */
function botSvg(): string {
  const bot = readBot();
  const rects: string[] = [];
  bot.rows.forEach((row, y) => {
    // One rect per run of a colour along the row.
    for (let x = 0; x < row.length; ) {
      const ch = row[x]!;
      let end = x + 1;
      while (row[end] === ch) end++;
      if (bot.palette[ch]) rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${bot.palette[ch]}"/>`);
      x = end;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}

/** Puts the bot in the loading screen and in the tab, as a data URI: no image files. */
function bot(): Plugin {
  return {
    name: 'drill-bot',
    transformIndexHtml(html) {
      const svg = botSvg();
      return html
        .replace('<!-- bot -->', svg.replace('<svg ', '<svg aria-hidden="true" '))
        .replace('</head>', `  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(svg)}" />\n  </head>`);
    },
  };
}

/** The home screen icons, by file: their size, and how many pixels an art pixel takes. */
const ICONS: Record<string, [size: number, scale: number]> = {
  'icon-192.png': [192, 9],
  'icon-512.png': [512, 24],
  // Android crops these to a circle or a squircle: the bot keeps to the middle.
  'icon-maskable.png': [512, 18],
  'apple-touch-icon.png': [180, 8],
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}

/** The bot, centred on the game's night blue, as a square PNG. */
function iconPng(size: number, scale: number): Buffer {
  const bot = readBot();
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const bg = rgb('#00081c');
  // Centre what's drawn, not the 16x16 canvas around it.
  let [left, right, top, bottom] = [Infinity, -1, Infinity, -1];
  bot.rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (!bot.palette[ch]) return;
      [left, right, top, bottom] = [Math.min(left, x), Math.max(right, x), Math.min(top, y), Math.max(bottom, y)];
    }),
  );
  const ox = Math.floor((size - (right - left + 1) * scale) / 2) - left * scale;
  const oy = Math.floor((size - (bottom - top + 1) * scale) / 2) - top * scale;
  const line = size * 3 + 1;
  const raw = Buffer.alloc(size * line);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ch = bot.rows[Math.floor((y - oy) / scale)]?.[Math.floor((x - ox) / scale)];
      raw.set(ch && bot.palette[ch] ? rgb(bot.palette[ch]) : bg, y * line + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

/** Draws the home screen icons from the bot's pixel grid: served in development, written by the build. */
function icons(): Plugin {
  const draw = (name: string) => iconPng(...ICONS[name]!);
  return {
    name: 'drill-icons',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0]?.slice(1) ?? '';
        if (!(name in ICONS)) return next();
        res.setHeader('Content-Type', 'image/png');
        res.end(draw(name));
      });
    },
    generateBundle() {
      for (const name of Object.keys(ICONS)) this.emitFile({ type: 'asset', fileName: name, source: draw(name) });
    },
  };
}

/**
 * Hands the game's script to public/loader.js instead of the browser, with
 * its size, so the loading screen can count the bytes as they arrive.
 */
function loader(): Plugin {
  return {
    name: 'drill-loader',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const tag = /\s*<script type="module" crossorigin src="([^"]+)"><\/script>/.exec(html);
        const entry = Object.values(ctx.bundle ?? {}).find((c) => c.type === 'chunk' && c.isEntry);
        if (!tag || !entry || entry.type !== 'chunk') throw new Error('drill-loader: no entry script to hand over');
        const size = Buffer.byteLength(entry.code);
        return html.replace(tag[0], '').replace('<script src="/loader.js"></script>', `<script src="/loader.js" data-main="${tag[1]}" data-size="${size}"></script>`);
      },
    },
  };
}

export default defineConfig({
  plugins: [bot(), icons(), loader()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
  // In development, the leaderboard comes from `wrangler dev` (pnpm exec wrangler dev --port 8788 --local).
  server: { proxy: { '/api': 'http://localhost:8788' } },
  test: { include: ['src/**/*.test.ts', 'worker/**/*.test.ts'] },
});
