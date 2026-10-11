import '@fontsource/press-start-2p/latin-400.css';
import '@fontsource/vt323/latin-400.css';
import './ui/style.css';

import Phaser from 'phaser';

import { Sound } from './audio/sound';
import { Input } from './render/input';
import { MIN_VIEW_ROWS, PlayScene, type Session } from './render/scene';
import { BG, TILE } from './render/sprites';
import { Game, type GameEvent } from './sim/game';
import { Mine } from './sim/layers';
import { InputLog } from './sim/replay';
import { WIDTH } from './sim/rules';
import { Hud, isTouch } from './ui/hud';
import { touchControls } from './ui/touch';

const WIDTH_PX = WIDTH * TILE;
const MIN_HEIGHT_PX = MIN_VIEW_ROWS * TILE;
/** The UTC day: one mine per day, the same for everyone. */
const day = Math.floor(Date.now() / 86_400_000);

const hud = new Hud();
const keys = new Input();
const sound = new Sound();

class Run implements Session {
  game = new Game(new Mine({ seed: `day:${day}`, layers: [] }));
  log = new InputLog();
  pausedByUser = false;
  hidden = false;
  started = false;

  get paused(): boolean {
    return !this.started || this.pausedByUser || this.hidden || this.game.over;
  }

  start(): void {
    this.started = true;
    keys.reset();
    hud.overlay(null);
    sound.unlock();
    sound.start();
  }

  step(input: number): void {
    this.log.push(input);
    this.game.step(input);
  }

  onEvents(events: GameEvent[]): void {
    hud.events(events, this.game);
    sound.events(events);
    if (this.game.over) hud.gameOver(this.game);
  }

  onFrame(): void {
    hud.update(this.game);
    sound.frame(this.game, this.pausedByUser || this.hidden);
  }

  onHint(hint: 'loose'): void {
    if (hint === 'loose') hud.toast('<b>LOOK OUT!</b><br>SOMETHING ABOVE YOU CAME LOOSE.<br>STEP ASIDE, OR DIG IT WITH ↑.', true);
  }

  restart(): void {
    this.game = new Game(new Mine({ seed: `day:${day}`, layers: [] }));
    this.log = new InputLog();
    this.pausedByUser = false;
    keys.reset();
    scene.reset();
    hud.overlay(null);
  }

  togglePause(): void {
    if (this.game.over || !this.started) return;
    this.pausedByUser = !this.pausedByUser;
    hud.overlay(this.pausedByUser ? `<h2>PAUSED</h2><p>${isTouch() ? 'TAP TO PLAY' : 'P TO PLAY'}</p>` : null);
  }
}

const run = new Run();
const scene = new PlayScene(run, keys);

// Canvas text needs the pixel font loaded before it is first drawn.
await document.fonts.load('8px "Press Start 2P"');

// A touch screen gets on-screen controls, and a layout for its orientation.
const coarse = window.matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch', coarse);
orient();

const size = fit();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: WIDTH_PX,
  height: size.height,
  pixelArt: true,
  backgroundColor: BG,
  banner: false,
  audio: { noAudio: true },
  scale: { mode: Phaser.Scale.NONE, zoom: size.zoom },
  scene: [scene],
});

function orient(): void {
  const portrait = window.innerHeight >= window.innerWidth;
  document.body.classList.toggle('portrait', portrait);
  document.body.classList.toggle('landscape', !portrait);
}

/** Whether the panel sits beside the playfield rather than above it. */
function sideBySide(): boolean {
  return isTouch() ? window.innerWidth > window.innerHeight : window.innerWidth > 640;
}

/**
 * The zoom that fits MIN_VIEW_ROWS rows, and the playfield's height at that
 * zoom: the rest of the height shows more of the shaft below the bot. Zoom is
 * a whole number on desktops, so pixels stay square; touch screens are dense
 * enough to hide uneven pixels, so there it fills the space.
 */
function fit(): { zoom: number; height: number } {
  const el = (id: string) => document.getElementById(id)!;
  const hud = el('hud');
  const touch = isTouch();
  let w: number;
  let h: number;
  if (touch && !sideBySide()) {
    // Padding and the stage's border; the panel above and the controls below, with gaps.
    w = window.innerWidth - 16 - 8;
    h = window.innerHeight - 16 - 8 - 2 * 8 - hud.offsetHeight - el('pad').offsetHeight;
  } else if (touch) {
    const actions = document.querySelector<HTMLElement>('.actions')!;
    w = window.innerWidth - 16 - 8 - 3 * 12 - hud.offsetWidth - el('dpad').offsetWidth - actions.offsetWidth;
    h = window.innerHeight - 16 - 8;
  } else if (!sideBySide()) {
    w = window.innerWidth - 16 - 8;
    h = window.innerHeight - 16 - 8 - 8 - hud.offsetHeight;
  } else {
    // Padding, the stage's border, and the sidebar with its gap.
    w = window.innerWidth - 32 - 8 - 16 - hud.offsetWidth;
    h = window.innerHeight - 32 - 8;
  }
  const fitted = Math.min(w / WIDTH_PX, h / MIN_HEIGHT_PX);
  const zoom = touch ? Math.max(0.5, Math.floor(fitted * 100) / 100) : Math.max(1, Math.floor(fitted));
  return { zoom, height: Math.max(MIN_HEIGHT_PX, Math.floor(h / zoom)) };
}

/** Sizes the playfield to the window, and the sidebar to the playfield. */
function layout(): void {
  orient();
  const hud = document.getElementById('hud')!;
  hud.style.height = '';
  const { zoom, height } = fit();
  game.scale.resize(WIDTH_PX, height);
  game.scale.setZoom(zoom);
  if (sideBySide()) hud.style.height = `${document.getElementById('stage')!.offsetHeight}px`;
}

window.addEventListener('resize', layout);
game.events.once('ready', layout);
// A touch screen that didn't say so up front gets its controls on the first touch.
window.addEventListener(
  'touchstart',
  () => {
    if (isTouch()) return;
    document.body.classList.add('touch');
    layout();
    if (!run.started) intro();
  },
  { once: true, passive: true },
);
touchControls(keys, () => run.togglePause());
document.addEventListener('visibilitychange', () => {
  run.hidden = document.hidden;
  sound.setHidden(document.hidden);
  if (document.hidden) keys.reset();
});

function toggleSound(): void {
  hud.sound(!sound.toggleMute());
}
hud.sound(!sound.muted);
for (const id of ['sound', 'sound-pad']) {
  document.getElementById(id)!.addEventListener('click', () => {
    sound.unlock();
    toggleSound();
  });
}

function intro(): void {
  const controls = isTouch() ? 'D-pad: move and dig · JUMP: hop onto a step' : '← → ↓ ↑ move and dig · SPACE jump';
  hud.overlay(`<h2>HASH DRILLER</h2>
<p class="how">Dig down level by level. Every level has<br>one golden <b>#</b>: touch it to mine the level.<br>That's the goal. No need to dig the rest.</p>
<p class="how">Grab the orange coins: they're fees,<br>and the <b>#</b> pays them out with the level.</p>
<p class="how">Mine every level to grow your chain:<br>each pays more. Pass the next <b>LEVEL</b> line<br>without its <b>#</b> and the chain breaks,<br>and its fees are lost.</p>
<p class="how">Power drains: grab <b>⚡</b> cells.<br>Dig out from under something and it falls:<br>a red <b>!</b> over you means step aside,<br>or dig it away with ↑ just in time.</p>
<p class="how">${controls}</p>
<p class="how dim">Each level is a real botBTC block,<br>and its <b>#</b> is the block's nonce.</p>
<p class="blink">${isTouch() ? 'TAP TO START' : 'PRESS ANY KEY'}</p>`);
}
intro();

window.addEventListener('keydown', (e) => {
  if (!run.started) {
    if (!e.metaKey && !e.ctrlKey && !e.altKey) run.start();
    return;
  }
  if (e.code === 'KeyM') toggleSound();
  else if (e.code === 'KeyR' || (run.game.over && (e.code === 'Enter' || e.code === 'Space'))) run.restart();
  else if (e.code === 'KeyP' || e.code === 'Escape') run.togglePause();
});
// A click, not a pointerdown: on phones only the end of a tap may start sound.
document.getElementById('overlay')!.addEventListener('click', () => {
  if (!run.started) run.start();
  else if (run.game.over) run.restart();
  else if (run.pausedByUser) run.togglePause();
});
// Phones can suspend sound, after a call for instance; any tap resumes it.
document.addEventListener('pointerup', () => {
  if (run.started) sound.unlock();
});

// For checking the game from the browser console while developing.
if (import.meta.env.DEV) Object.assign(window, { drill: run, sound });
