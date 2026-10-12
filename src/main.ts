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
/** Tiles stop growing at 56 px, for tablets; landscape phones show at least LANDSCAPE_ROWS rows. */
const MAX_TOUCH_ZOOM = 3.5;
const LANDSCAPE_ROWS = 12;
/** How far up from the bottom of an iPhone's screen Safari's floating bar reaches, with a little room. */
const IOS_BAR_PX = 96;
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

/**
 * The visible area in CSS pixels as if not pinch-zoomed: iOS shrinks
 * innerWidth and innerHeight while the page is zoomed, and the playfield
 * must not shrink with them.
 */
function viewport(): { w: number; h: number } {
  const v = window.visualViewport;
  return v ? { w: Math.round(v.width * v.scale), h: Math.round(v.height * v.scale) } : { w: window.innerWidth, h: window.innerHeight };
}

/**
 * Safari in a tab on an iPhone, whose address bar floats over the page. Not
 * other iOS browsers or in-app views, whose bars sit outside the page, and
 * not a web app opened from the home screen, which has no bar.
 */
function iosBar(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPod/.test(ua) && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) && !(navigator as Navigator & { standalone?: boolean }).standalone;
}

/**
 * How much of the bottom of the page Safari's floating bar covers: the bar
 * reaches IOS_BAR_PX up from the bottom of the screen, and the page may end
 * above part or all of it.
 */
function barCover(): number {
  const v = window.visualViewport;
  const bottom = v ? v.offsetTop + v.height : window.innerHeight;
  return Math.max(0, Math.round(IOS_BAR_PX - (window.screen.height - bottom)));
}

function orient(): void {
  const { w, h } = viewport();
  document.body.classList.toggle('portrait', h >= w);
  document.body.classList.toggle('landscape', h < w);
  document.body.classList.toggle('ios-bar', iosBar());
  document.documentElement.style.setProperty('--bar', `${barCover()}px`);
  // The page fills exactly the visible height, between the browser's bars.
  document.documentElement.style.setProperty('--vh', `${h}px`);
}

/** Whether the panel sits beside the playfield rather than above it. */
function sideBySide(): boolean {
  const { w, h } = viewport();
  return isTouch() ? w > h : w > 640;
}

/** The safe areas' insets in CSS pixels, read from a probe padded by them. */
function safeArea(): { top: number; right: number; bottom: number; left: number } {
  const s = getComputedStyle(document.getElementById('safe')!);
  const px = (v: string) => Math.round(parseFloat(v) || 0);
  return { top: px(s.paddingTop), right: px(s.paddingRight), bottom: px(s.paddingBottom), left: px(s.paddingLeft) };
}

/**
 * The zoom, and the playfield's height in game pixels. On touch screens the
 * shaft is the screen: in portrait as wide and as tall as it, with the strip
 * and the controls floating over it; in landscape as tall as it, between the
 * d-pad and the strip. Zoom there is fractional, as phones are dense enough
 * to hide uneven pixels. On desktops it is a whole number, so pixels stay
 * square, fitting MIN_VIEW_ROWS rows, and the rest of the height shows more
 * of the shaft below the bot.
 */
function fit(): { zoom: number; height: number } {
  const view = viewport();
  const floor2 = (z: number) => Math.max(0.5, Math.floor(z * 100) / 100);
  if (isTouch()) {
    if (view.h >= view.w) {
      const zoom = floor2(Math.min(view.w / WIDTH_PX, MAX_TOUCH_ZOOM));
      return { zoom, height: Math.ceil(view.h / zoom) };
    }
    const safe = safeArea();
    const side = Math.max(document.getElementById('dpad')!.offsetWidth, 190);
    const w = view.w - 2 * side - 2 * 12 - Math.max(12, safe.left) - Math.max(12, safe.right);
    const zoom = floor2(Math.min(view.h / (LANDSCAPE_ROWS * TILE), w / WIDTH_PX, MAX_TOUCH_ZOOM));
    return { zoom, height: Math.ceil(view.h / zoom) };
  }
  const hud = document.getElementById('hud')!;
  let w: number;
  let h: number;
  if (!sideBySide()) {
    w = view.w - 16 - 8;
    h = view.h - 16 - 8 - 8 - hud.offsetHeight;
  } else {
    // Padding, the stage's border, and the sidebar with its gap.
    w = view.w - 32 - 8 - 16 - hud.offsetWidth;
    h = view.h - 32 - 8;
  }
  const zoom = Math.max(1, Math.floor(Math.min(w / WIDTH_PX, h / MIN_HEIGHT_PX)));
  return { zoom, height: Math.max(MIN_HEIGHT_PX, Math.floor(h / zoom)) };
}

/**
 * Sizes the playfield to the window. On touch screens, tells the scene how
 * much the strip and the controls cover; on desktops, sizes the sidebar to
 * the playfield.
 */
function layout(): void {
  orient();
  const hud = document.getElementById('hud')!;
  hud.style.height = '';
  const { zoom, height } = fit();
  game.scale.resize(WIDTH_PX, height);
  game.scale.setZoom(zoom);
  if (isTouch()) {
    const portrait = document.body.classList.contains('portrait');
    const strip = portrait ? document.getElementById('strip')!.offsetHeight : 0;
    const keysTop = Math.min(document.getElementById('dpad')!.getBoundingClientRect().top, document.querySelector('.actions')!.getBoundingClientRect().top);
    const pad = portrait ? Math.max(0, viewport().h - keysTop) : 0;
    document.documentElement.style.setProperty('--strip-h', `${strip}px`);
    scene.setInsets(strip / zoom, pad / zoom, true);
  } else {
    scene.setInsets(0, 0, false);
    if (sideBySide()) hud.style.height = `${document.getElementById('stage')!.offsetHeight}px`;
  }
}

// ?debug shows what the browser reports about the screen, for tuning layouts on a phone.
if (new URLSearchParams(window.location.search).has('debug')) {
  const box = document.createElement('div');
  box.className = 'debug';
  document.body.append(box);
  const show = () => {
    const v = window.visualViewport;
    const s = safeArea();
    const keys = document.getElementById('dpad')!.getBoundingClientRect();
    box.textContent = [
      `inner ${window.innerWidth}x${window.innerHeight}`,
      `client ${document.documentElement.clientWidth}x${document.documentElement.clientHeight}`,
      v ? `visual ${Math.round(v.width)}x${Math.round(v.height)} @${v.scale.toFixed(2)} top ${Math.round(v.offsetTop)}` : 'visual -',
      `screen ${window.screen.width}x${window.screen.height} dpr ${window.devicePixelRatio}`,
      `safe t${s.top} r${s.right} b${s.bottom} l${s.left} bar ${barCover()}`,
      `zoom ${game.scale.zoom.toFixed(2)} game ${WIDTH_PX}x${game.scale.height}`,
      `dpad top ${Math.round(keys.top)} bottom ${Math.round(keys.bottom)}`,
      document.body.className,
    ].join('\n');
  };
  setInterval(show, 500);
}

// Rotation, the browser's bars sliding in and out, and zoom all resize: lay out once a frame at most.
let pending = 0;
const relayout = () => {
  if (!pending) pending = requestAnimationFrame(() => {
    pending = 0;
    layout();
  });
};
window.addEventListener('resize', relayout);
window.visualViewport?.addEventListener('resize', relayout);
game.events.once('ready', layout);

// No page zoom while playing: iOS ignores the viewport's user-scalable=no, so
// cancel its pinch gestures, double-tap zoom, and two-finger moves directly.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });
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
  if (isTouch()) {
    // A phone gets the short version: the shaft says the rest as you play.
    hud.overlay(`<h2>HASH DRILLER</h2>
<p class="how">Dig down. Every level has one golden <b>#</b>:<br>touch it to mine the level.</p>
<p class="how">Orange coins are fees: the <b>#</b> pays them out.<br>Mine levels in a row to grow your chain.</p>
<p class="how">Power drains: grab <b>⚡</b>. A red <b>!</b> means<br>something above you is about to fall.</p>
<p class="how">D-pad: move and dig. There's no way back up.</p>
<p class="how dim">Each level is a real botBTC block,<br>and its <b>#</b> is the block's nonce.</p>
<p class="blink">TAP TO START</p>`);
    return;
  }
  const controls = '← → ↓ ↑ move and dig. There\'s no way back up.';
  hud.overlay(`<h2>HASH DRILLER</h2>
<p class="how">Dig down level by level. Every level has<br>one golden <b>#</b>: touch it to mine the level.<br>That's the goal. No need to dig the rest.</p>
<p class="how">Grab the orange coins: they're fees,<br>and the <b>#</b> pays them out with the level.</p>
<p class="how">Mine every level to grow your chain:<br>each pays more. Pass the next <b>LEVEL</b> line<br>without its <b>#</b> and the chain breaks,<br>and its fees are lost.</p>
<p class="how">Power drains: grab <b>⚡</b> cells.<br>Dig out from under something and it falls:<br>a red <b>!</b> over you means step aside,<br>or dig it away with ↑ just in time.</p>
<p class="how">${controls}</p>
<p class="how dim">Each level is a real botBTC block,<br>and its <b>#</b> is the block's nonce.</p>
<p class="blink">PRESS ANY KEY</p>`);
}
intro();
// The game is up: the loading screen goes, and the music renders while the intro is read.
document.getElementById('loading')?.remove();
setTimeout(() => void sound.prepare(), 300);

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
