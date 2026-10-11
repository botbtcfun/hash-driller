# Hash Driller

A pixel-art digging game. Dig down level by level: every level has one golden
**#**, its nonce. Touch it to mine the level. Mine level after level to grow
your chain, and each one pays more; pass the next LEVEL line without its # and
the chain breaks. Power drains, so grab ⚡ cells, and anything you dig out
from under falls.

Each level is a real [botBTC](https://botbtc.fun) block, and its # is the
block's nonce. Made for Round 01 (games) of
[Project Treetop](https://twigpine.com/treetop).

## Play

| Key | |
|---|---|
| ← → | Move, or dig what's in the way |
| ↓ / ↑ | Dig down / dig up, even a piece falling onto you |
| Space | Jump onto a step |
| P | Pause |
| R | Restart |
| M | Sound on or off |

On phones and tablets the game shows a d-pad you can slide a thumb across, a
JUMP button, and pause and sound buttons, laid out for portrait or landscape.

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # the simulation's tests
pnpm balance    # plays thousands of runs headless and prints how they go
pnpm build      # the static site, in dist/
```

## How it's made

- `src/sim`: the game itself, in plain TypeScript with no browser in it. It
  runs on a fixed 60 Hz tick with integer arithmetic and a seeded generator,
  so the same mine and the same inputs give the same run on any device. A run
  is its input log.
- `src/render`: drawing with [Phaser](https://phaser.io). Every sprite is
  a pixel grid in code, drawn into a texture at startup; there are no image
  files.
- `src/audio`: music and sound effects synthesised in the browser with Web
  Audio; there are no audio files. The soundtrack is three stems in F minor at
  140 BPM, rendered at load, that come in as a run heats up.
- `src/ui`: the side panel, banners and overlays.

## Licence

MIT, see [LICENSE](LICENSE). The fonts are Press Start 2P and VT323 (SIL Open
Font License), through [Fontsource](https://fontsource.org).
