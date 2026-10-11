import { readFileSync } from 'node:fs';

import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** The B-bot as an SVG, from the same pixel grid the game draws it from. */
function botSvg(): string {
  const bot = JSON.parse(readFileSync(new URL('./src/art/bot.json', import.meta.url), 'utf8')) as {
    palette: Record<string, string>;
    rows: string[];
  };
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
  plugins: [bot(), loader()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
  test: { include: ['src/**/*.test.ts'] },
});
