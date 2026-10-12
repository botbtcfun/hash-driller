# Hash Driller

A pixel-art digging game. Dig down level by level: every level has one golden
**#**, its nonce. Touch it to mine the level. On the way, grab the orange
coins: they're transaction fees, and the # pays them out with the level's
subsidy, which halves as you go deeper while fees grow. Mine level after level
to grow your chain, and each one pays more; pass the next LEVEL line without
its # and the chain breaks and its fees are lost. Anything you dig out from
under falls, and every level from 2 to 5 brings a new kind of block: hard
rock that takes a few hits, steel you climb or go around, loose stones that
drop without warning, and bombs that blast everything around them. Deeper
down there is more of each, and loose blocks give you less warning.

Each level is a real [botBTC](https://botbtc.fun) block, and its # is the
block's nonce. Made for Round 01 (games) of
[Project Treetop](https://twigpine.com/treetop).

## Play

The first time, a short tutorial teaches the moves on a mine made for it,
at a slower speed: each lesson waits until you press what it asks for. You
can skip it, and replay it from HOW TO PLAY on the start screen.

| Key | |
|---|---|
| ← → | Move, dig what's in the way, or climb onto steel |
| ↓ / ↑ | Dig down / dig up. Each tap of ↑ hits a piece coming down on you and holds the rest up a moment: tap fast to break a whole stack, even hard rock |
| ↑ where it's open | Jump; ← or → in the air lands on a ledge. One step up at most: there's no way back up |
| P | Pause |
| R | Restart |
| M | Sound on or off |

On phones and tablets the shaft fills the screen. A strip with your sats,
level, chain and lives floats over the top, and a d-pad you can slide a
thumb across floats at the bottom. Hold its centre to drag it where you like:
it stays there, and the pause and sound buttons move to the corner it leaves
clear. In landscape the controls sit either side of the shaft. Add `?debug` to
the address to see what the browser reports about the screen.

It can be added to the home screen, to open full screen like an app. On
Android the ADD TO HOME SCREEN button asks the browser to install it; on iOS,
where only the share sheet can, the button shows how. The icons are drawn
from the bot's pixel grid by the build, like the favicon.

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
