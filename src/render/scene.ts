import { FALL, type Game, type GameEvent, POP, WOBBLE } from '../sim/game';
import { BOMB, COLOR, FEE, HEADER, NONCE, ROCK, STEEL, STONE } from '../sim/grid';
import { headerY, layerAt } from '../sim/layers';
import { FALL_TICKS, TICK_HZ, VIEW_ABOVE, WIDTH } from '../sim/rules';
import type { Input } from './input';
import { BG, PARTICLE_COLORS, TILE, type Textures, makeTextures } from './sprites';

/** Rows in view, and how many of them are above the bot. */
export const MIN_VIEW_ROWS = 13;
/** The playfield's width in game pixels: the shaft, wall to wall. */
export const WIDTH_PX = WIDTH * TILE;
const BOT_ROW = VIEW_ABOVE;
const TICK_MS = 1000 / TICK_HZ;

const GOLD = '#ffd60a';
const INK = '#00081c';
const FONT = '8px "Press Start 2P"';

/** What the scene plays: swapped for a new run on restart. */
export interface Session {
  readonly game: Game;
  readonly paused: boolean;
  /** Game time per real time: slower in the tutorial. */
  readonly speed: number;
  step(input: number): void;
  /** After each tick with events, and once a frame. */
  onEvents(events: GameEvent[]): void;
  onFrame(): void;
  /** The first time something needs explaining, such as the loose-block warning. */
  onHint(hint: 'loose'): void;
}

const STEP_OFFSET = { left: [-3, 8], right: [TILE + 2, 8], up: [8, -3], down: [8, TILE + 2] } as const;
/** Quarter turns clockwise from pointing right. */
const STEP_TURNS = { left: 2, right: 0, up: 3, down: 1 } as const;

/** How text sits in its box: bare, on a dark plate, or outlined in dark. */
type TextBox = 'bare' | 'plate' | 'outline';

/** A spark from something dug or blown up: flies, falls and fades. */
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  color: string;
}

/** Text rising from where something happened. */
interface Float {
  text: HTMLCanvasElement;
  x: number;
  y: number;
  age: number;
}

/** A star twinkling by the nonce: grows, then shrinks away. */
interface Star {
  x: number;
  y: number;
  age: number;
}

const SPARK_LIFE = [300, 650] as const;
const SPARK_SPEED = [25, 120] as const;
const SPARK_GRAVITY = 380;
const FLOAT_MS = 900;
const STAR_MS = 160;
const MAX_STARS = 4;

const between = ([lo, hi]: readonly [number, number]) => lo + Math.random() * (hi - lo);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/**
 * The shaft as it is drawn: the mine around the bot, the bot, and the
 * effects of what happens, on a canvas at one pixel per game pixel that the
 * page scales up. It also runs the game: each frame, as many ticks as the
 * time since the last one is worth.
 */
export class PlayScene {
  readonly canvas = document.createElement('canvas');
  /** CSS pixels per game pixel. */
  zoom = 1;
  /** Real time drawn so far, in ms: what animates by the clock rather than by ticks. */
  now = 0;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly textures: Textures = makeTextures();
  private readonly tints = new Map<string, HTMLCanvasElement>();
  private readonly texts = new Map<string, HTMLCanvasElement>();
  /** The drill turned each way, a quarter turn at a time. */
  private readonly drills: HTMLCanvasElement[];
  private readonly bgPattern: CanvasPattern;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private alpha = 0;
  private viewY = 0;
  private warned = false;
  /** Game pixels hidden under the strip and the controls on touch screens. */
  private insetTop = 0;
  private insetBottom = 0;
  /** Whether the nonce shows what it pays, where there's no panel to say so. */
  private showPrice = false;
  private sparks: Spark[] = [];
  private floats: Float[] = [];
  private stars: Star[] = [];
  private starAt = 0;
  private shake = { left: 0, intensity: 0, x: 0, y: 0 };
  private flash = { left: 0, duration: 0, color: '' };

  constructor(
    private readonly session: Session,
    private readonly keys: Input,
  ) {
    this.canvas.width = WIDTH_PX;
    this.canvas.height = MIN_VIEW_ROWS * TILE;
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.bgPattern = this.ctx.createPattern(this.tex('bg'), 'repeat')!;
    this.drills = [0, 1, 2, 3].map((turns) => turn(this.tex('drill'), turns));
  }

  /** The playfield's height in game pixels. */
  get height(): number {
    return this.canvas.height;
  }

  /** Sizes the playfield: `height` game pixels tall, shown `zoom` times as large. */
  resize(height: number, zoom: number): void {
    if (this.canvas.height !== height) this.canvas.height = height;
    this.zoom = zoom;
    this.canvas.style.width = `${WIDTH_PX * zoom}px`;
    this.canvas.style.height = `${height * zoom}px`;
    // A canvas resized is cleared: drawn again now, not a frame late.
    this.draw(this.session.game, this.alpha);
  }

  /** Plays and draws a frame each time the screen refreshes. */
  start(): void {
    const loop = (time: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(this.last ? Math.max(0, time - this.last) : 0);
      this.last = time;
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Stops the frames, for stepping them one by one, as a recording does. */
  sleep(): void {
    cancelAnimationFrame(this.raf);
    this.last = 0;
  }

  /**
   * How much of the playfield the strip and the controls cover, in game
   * pixels: the camera keeps the bot below the strip, and the nonce arrow
   * points from the edge of what is uncovered. With a price, the nonce shows
   * what it pays.
   */
  setInsets(top: number, bottom: number, price: boolean): void {
    this.insetTop = top;
    this.insetBottom = bottom;
    this.showPrice = price;
  }

  /** Jumps the camera to the bot, for a new run. */
  reset(): void {
    this.acc = 0;
    this.viewY = 0;
  }

  /** One frame, `delta` ms after the last: the ticks it is worth, then the picture. */
  frame(delta: number): void {
    this.now += delta;
    this.age(delta);
    const s = this.session;
    if (!s.paused) {
      this.acc += Math.min(delta, 100) * s.speed;
      // A tick can pause the session, as the tutorial does to wait for a press.
      while (!s.paused && this.acc >= TICK_MS) {
        this.acc -= TICK_MS;
        s.step(this.keys.sample());
        const events = s.game.events;
        if (events.length) {
          this.effects(events);
          s.onEvents(events);
        }
      }
    }
    this.alpha = s.paused ? 0 : this.acc / TICK_MS;
    this.draw(s.game, this.alpha);
    s.onFrame();
  }

  /** Rows in view, the last one perhaps partly. */
  private get rows(): number {
    return Math.ceil(this.height / TILE);
  }

  private tex(key: string): HTMLCanvasElement {
    return this.textures.get(key)!;
  }

  /**
   * A sprite with its colours multiplied by `tint`, or with `fill`, in `tint`
   * wherever it isn't see-through. Made once, then kept.
   */
  private tinted(key: string, tint: string, fill = false): HTMLCanvasElement {
    const id = `${key}|${tint}|${fill}`;
    let c = this.tints.get(id);
    if (!c) {
      const src = this.tex(key);
      c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(src, 0, 0);
      const img = ctx.getImageData(0, 0, c.width, c.height);
      const t = rgb(tint);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        for (let j = 0; j < 3; j++) d[i + j] = fill ? t[j]! : Math.round((d[i + j]! * t[j]!) / 255);
      }
      ctx.putImageData(img, 0, 0);
      this.tints.set(id, c);
    }
    return c;
  }

  /** Text in the pixel font, drawn once into a canvas of its own and kept. */
  private text(text: string, color: string, box: TextBox): HTMLCanvasElement {
    const id = `${box}|${color}|${text}`;
    let c = this.texts.get(id);
    if (!c) {
      // Fees float up in all sorts of amounts: keep the last few hundred.
      if (this.texts.size > 300) this.texts.clear();
      c = document.createElement('canvas');
      const ctx = c.getContext('2d')!;
      ctx.font = FONT;
      const width = Math.round(ctx.measureText(text).width);
      const [padX, padY] = box === 'plate' ? [2, 1] : box === 'outline' ? [1, 1] : [0, 0];
      c.width = width + 2 * padX;
      c.height = 8 + 2 * padY;
      if (box === 'plate') {
        ctx.fillStyle = INK;
        ctx.fillRect(0, 0, c.width, c.height);
      }
      // Sizing the canvas reset its font.
      ctx.font = FONT;
      ctx.textBaseline = 'alphabetic';
      if (box === 'outline') {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeText(text, padX, padY + 8);
      }
      ctx.fillStyle = color;
      ctx.fillText(text, padX, padY + 8);
      this.texts.set(id, c);
    }
    return c;
  }

  /** Draws `img` with its point at (ox, oy), as fractions of its size, on (x, y), on whole pixels. */
  private put(img: HTMLCanvasElement, x: number, y: number, ox = 0.5, oy = 0.5): void {
    this.ctx.drawImage(img, Math.round(x - img.width * ox), Math.round(y - img.height * oy));
  }

  /** Draws `img` centred on (x, y) at `scale`, its corners on whole pixels. */
  private putScaled(img: HTMLCanvasElement, x: number, y: number, scale: number): void {
    const w = (img.width * scale) / 2;
    const h = (img.height * scale) / 2;
    const x0 = Math.round(x - w);
    const y0 = Math.round(y - h);
    const x1 = Math.round(x + w);
    const y1 = Math.round(y + h);
    if (x1 > x0 && y1 > y0) this.ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0);
  }

  /** Moves sparks, floating text, stars and camera effects on by `delta` ms. */
  private age(delta: number): void {
    const step = delta / 1000;
    for (const p of this.sparks) {
      p.age += delta;
      p.vy += SPARK_GRAVITY * step;
      p.x += p.vx * step;
      p.y += p.vy * step;
    }
    this.sparks = this.sparks.filter((p) => p.age < p.life);
    for (const f of this.floats) f.age += delta;
    this.floats = this.floats.filter((f) => f.age < FLOAT_MS);
    for (const s of this.stars) s.age += delta;
    this.stars = this.stars.filter((s) => s.age < 2 * STAR_MS);

    const sh = this.shake;
    sh.x = sh.y = 0;
    if (sh.left > 0) {
      sh.left -= delta;
      if (sh.left > 0) {
        sh.x = Math.round((Math.random() * 2 - 1) * sh.intensity * WIDTH_PX);
        sh.y = Math.round((Math.random() * 2 - 1) * sh.intensity * this.height);
      }
    }
    if (this.flash.left > 0) this.flash.left -= delta;
  }

  /** Shakes the view for `ms`, by up to `intensity` of its size; not while it already shakes. */
  private shakeView(ms: number, intensity: number): void {
    if (this.shake.left > 0) return;
    this.shake.left = ms;
    this.shake.intensity = intensity;
  }

  /** Flashes the view in `color`, fading over `ms`; not while it already flashes. */
  private flashView(ms: number, color: string): void {
    if (this.flash.left > 0) return;
    this.flash = { left: ms, duration: ms, color };
  }

  private explode(count: number, x: number, y: number, color: string): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = between(SPARK_SPEED);
      this.sparks.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, age: 0, life: between(SPARK_LIFE), color });
    }
  }

  private draw(game: Game, alpha: number): void {
    const g = game.grid;
    const bot = game.bot;
    const ctx = this.ctx;

    const moving = bot.action === 'walk' || bot.action === 'climb' || bot.action === 'hop' || bot.action === 'fall';
    let p = moving && bot.duration > 0 ? Math.min(1, (bot.duration - bot.timer + alpha) / bot.duration) : 1;
    // A jump rises fast and slows at the top, where it can be steered.
    if (bot.action === 'hop') p = 1 - (1 - p) ** 2;
    const bx = (bot.fromX + (bot.x - bot.fromX) * p) * TILE;
    // A climb hops: a little arc on the way up and over.
    const by = (bot.fromY + (bot.y - bot.fromY) * p) * TILE - (bot.action === 'climb' ? Math.sin(p * Math.PI) * 5 : 0);

    const target = Math.max(-this.insetTop, by - BOT_ROW * TILE - this.insetTop);
    this.viewY += (target - this.viewY) * 0.18;
    if (Math.abs(target - this.viewY) < 0.5) this.viewY = target;
    const scrollY = Math.round(this.viewY);
    const { x: sx, y: sy } = this.shake;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, WIDTH_PX, this.height);
    // The back wall, scrolling at half speed.
    const wall = ((Math.round(this.viewY / 2) % 32) + 32) % 32;
    ctx.setTransform(1, 0, 0, 1, sx, sy - wall);
    ctx.fillStyle = this.bgPattern;
    ctx.fillRect(0, wall, WIDTH_PX, this.height);

    // The mine, in world pixels from here on.
    ctx.setTransform(1, 0, 0, 1, sx, sy - scrollY);
    const first = Math.floor(this.viewY / TILE) - 1;
    const rows = this.rows;
    let nonceAt: [number, number] | null = null;
    for (let y = first; y < first + rows + 2; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const k = g.kindAt(x, y);
        const key = this.texture(game, k, x, y);
        if (!key) continue;
        let dx = 0;
        let dy = 0;
        let img = this.tex(key);
        const body = game.bodies.get(g.bodyAt(x, y));
        if (body?.state === WOBBLE) {
          dx = (game.tick >> 2) & 1 ? 1 : -1;
          if ((game.tick >> 3) & 1) img = this.tinted(key, '#ffc0c0');
        } else if (body?.state === FALL && body.movedAt >= 0) {
          dy = -Math.round((1 - Math.min(1, (game.tick - body.movedAt + alpha) / FALL_TICKS)) * TILE);
        } else if (body?.state === POP && (game.tick >> 1) & 1) img = this.tinted(key, '#ffffff', true);
        ctx.drawImage(img, x * TILE + dx, y * TILE + dy);
        if (k === NONCE && !nonceAt) nonceAt = [x * TILE + dx + TILE / 2, y * TILE + dy + TILE / 2];
      }
    }
    this.labelLevels(first);
    this.shine(game, nonceAt);

    const dead = bot.action === 'dead';
    const x = Math.round(bx);
    const y = Math.round(by);
    if (bot.action === 'drill') {
      const [ox, oy] = STEP_OFFSET[bot.drillDir];
      const jitter = (game.tick >> 1) & 1;
      const along = bot.drillDir === 'up' || bot.drillDir === 'down';
      this.put(this.drills[STEP_TURNS[bot.drillDir]]!, x + ox + (along ? 0 : jitter), y + oy + (along ? jitter : 0));
    } else if (game.braced && !dead) {
      // Braced: the drill held up and still, waiting for what's coming down.
      const [ox, oy] = STEP_OFFSET.up;
      this.put(this.drills[STEP_TURNS.up]!, x + ox, y + oy);
    }

    ctx.globalAlpha = dead ? ((game.tick >> 3) & 1 ? 0.25 : 0.8) : bot.shield > 0 && (game.tick >> 2) & 1 ? 0.35 : 1;
    const botImg = dead ? this.tinted('bot', '#ff4d79') : this.tex('bot');
    if (bot.facing < 0) {
      ctx.save();
      ctx.translate(x + TILE, y);
      ctx.scale(-1, 1);
      ctx.drawImage(botImg, 0, 0);
      ctx.restore();
    } else ctx.drawImage(botImg, x, y);
    ctx.globalAlpha = 1;
    this.warn(game, dead ? null : game.threat(), x, y, by);

    for (const s of this.sparks) {
      ctx.globalAlpha = Math.max(0, 1 - s.age / s.life);
      ctx.fillStyle = s.color;
      ctx.fillRect(Math.round(s.x - 1), Math.round(s.y - 1), 2, 2);
    }
    ctx.globalAlpha = 1;

    this.price(game, nonceAt);
    for (const f of this.floats) {
      const e = 1 - (1 - f.age / FLOAT_MS) ** 3;
      ctx.globalAlpha = 1 - e;
      this.put(f.text, f.x, f.y - 20 * e);
    }
    ctx.globalAlpha = 1;

    // On the screen, not in the mine.
    ctx.setTransform(1, 0, 0, 1, sx, sy);
    this.pointAtNonce(game, by);

    const fl = this.flash;
    if (fl.left > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = fl.left / fl.duration;
      ctx.fillStyle = fl.color;
      ctx.fillRect(0, 0, WIDTH_PX, this.height);
      ctx.globalAlpha = 1;
    }
  }

  private texture(game: Game, k: number, x: number, y: number): string | null {
    const g = game.grid;
    if (k === COLOR) {
      const i = g.i(x, y);
      const color = g.color[i]!;
      const body = g.body[i]!;
      const same = (nx: number, ny: number) =>
        g.kindAt(nx, ny) === COLOR && g.inside(nx, ny) && g.color[g.i(nx, ny)] === color && g.body[g.i(nx, ny)] === body;
      const mask = (same(x, y - 1) ? 1 : 0) | (same(x + 1, y) ? 2 : 0) | (same(x, y + 1) ? 4 : 0) | (same(x - 1, y) ? 8 : 0);
      return `block${color}_${mask}`;
    }
    if (k === ROCK) return `rock${Math.min(g.hits[g.i(x, y)]!, 2)}`;
    if (k === STEEL) return 'steel';
    if (k === STONE) return 'stone';
    if (k === BOMB) {
      // Lit, it blinks, and faster as the fuse burns down.
      const fuse = g.hits[g.i(x, y)]!;
      if (!fuse) return 'bomb0';
      return `bomb${(game.tick >> (fuse > 30 ? 3 : 1)) & 1 ? 2 : 1}`;
    }
    if (k === FEE) return `fee${(game.tick >> 3) % 6 === 0 ? 1 : 0}`;
    if (k === HEADER) return 'header';
    if (k === NONCE) {
      const f = (game.tick >> 2) % 8;
      return `nonce${f < 3 ? f + 1 : 0}`;
    }
    return null;
  }

  /** Text that rises from where something happened and fades. */
  private floatText(text: string, bits: { x: number; y: number }[], color = GOLD): void {
    const x = (bits.reduce((s, b) => s + b.x, 0) / bits.length) * TILE + TILE / 2;
    const y = (bits.reduce((s, b) => s + b.y, 0) / bits.length) * TILE + TILE / 2;
    this.floats.push({ text: this.text(text, color, 'outline'), x: Math.round(x), y: Math.round(y), age: 0 });
  }

  /** A pulsing halo on the nonce in view, and stars twinkling around it. */
  private shine(game: Game, at: [number, number] | null): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    if (at) {
      const wave = Math.sin((this.now / 900) * Math.PI * 2);
      ctx.globalAlpha = 0.6 + 0.3 * wave;
      this.putScaled(this.tex('glow'), at[0], at[1], 1 + 0.1 * wave);
      ctx.globalAlpha = 1;
      if (game.tick - this.starAt >= 9 && this.stars.length < MAX_STARS) {
        this.starAt = game.tick;
        // Somewhere on the ring around the nonce, never on top of it.
        const angle = Math.random() * Math.PI * 2;
        const r = 9 + Math.random() * 5;
        this.stars.push({ x: Math.round(at[0] + Math.cos(angle) * r), y: Math.round(at[1] + Math.sin(angle) * r), age: 0 });
      }
    }
    for (const s of this.stars) this.putScaled(this.tex('star'), s.x, s.y, s.age < STAR_MS ? s.age / STAR_MS : 2 - s.age / STAR_MS);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Labels the line each level starts at, so the player can see where levels are. */
  private labelLevels(first: number): void {
    let n = 0;
    for (let k = Math.max(1, layerAt(first)); n < 2; k++) {
      const y = headerY(k);
      if (y > first + this.rows + 1) break;
      if (y < first) continue;
      this.put(this.text(`LEVEL ${k}`, GOLD, 'bare'), WIDTH_PX / 2, y * TILE + TILE / 2);
      n++;
    }
  }

  /** A blinking ! over the bot, and a dotted line from what's about to fall down to it. */
  private warn(game: Game, row: number | null, x: number, y: number, by: number): void {
    if (row === null) return;
    if (!this.warned) {
      this.warned = true;
      this.session.onHint('loose');
    }
    if (((game.tick >> 2) & 3) === 0) return;
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255, 77, 121, 0.8)';
    for (let dy = (row + 1) * TILE + 2; dy < by - 12; dy += 4) ctx.fillRect(x + 7, dy, 2, 2);
    this.put(this.tex('warn'), x + 8, y - 2 - ((game.tick >> 3) & 1), 0.5, 1);
  }

  /** An arrow at the edge of the view toward the nonce, with how far it is. */
  private pointAtNonce(game: Game, botY: number): void {
    const found = game.nonce();
    const height = this.height - this.insetBottom;
    const top = this.viewY + this.insetTop;
    if (!found || (found[1] * TILE >= top && found[1] * TILE + TILE <= this.viewY + height)) return;
    const below = found[1] * TILE > top;
    const bob = (game.tick >> 3) & 1;
    const x = Math.min(Math.max(found[0] * TILE + 8, 6), WIDTH_PX - 6);
    const ay = below ? height - 4 - bob : this.insetTop + 4 + bob;
    const arrow = this.tex('arrow');
    if (below) this.put(arrow, x, ay);
    else {
      // Pointing up: the arrow upside down.
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(Math.round(x - arrow.width / 2), Math.round(ay + arrow.height / 2));
      ctx.scale(1, -1);
      ctx.drawImage(arrow, 0, 0);
      ctx.restore();
    }
    const label = this.text(`${Math.abs(Math.round(found[1] - botY / TILE))}m`, GOLD, 'plate');
    this.put(label, Math.min(Math.max(x, 14), WIDTH_PX - 14), below ? height - 14 : this.insetTop + 14);
  }

  /** "62K" over the nonce, while it is in the open: what mining it pays now. Otherwise the arrow points to it. */
  private price(game: Game, at: [number, number] | null): void {
    const open = at && at[1] - 8 >= this.viewY + this.insetTop && at[1] + 8 <= this.viewY + this.height - this.insetBottom;
    if (!this.showPrice || !at || !open) return;
    const n = game.nonceReward;
    const text = n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : `${Math.round(n / 1000)}K`;
    this.put(this.text(text, GOLD, 'plate'), Math.round(at[0]), Math.round(at[1]) - 10, 0.5, 1);
  }

  private effects(events: GameEvent[]): void {
    for (const e of events) {
      if (e.type === 'drill' || e.type === 'pop' || e.type === 'shatter') {
        for (const b of e.bits) this.explode(e.type === 'pop' ? 7 : 4, b.x * TILE + 8, b.y * TILE + 8, b.kind === COLOR ? PARTICLE_COLORS[b.color]! : '#8fa6d9');
        if (e.type === 'pop') {
          this.shakeView(80 + 40 * e.combo, 0.004 * Math.min(e.combo, 4));
          if (e.combo >= 2) this.floatText(`×${e.combo}`, e.bits);
        }
      } else if (e.type === 'rock') {
        this.explode(e.broken ? 8 : 3, e.x * TILE + 8, e.y * TILE + 8, '#8fa6d9');
      } else if (e.type === 'clang') {
        this.explode(3, e.x * TILE + 8, e.y * TILE + 8, '#eef2fb');
        this.shakeView(60, 0.002);
      } else if (e.type === 'fuse') {
        this.explode(6, e.x * TILE + 12, e.y * TILE + 2, GOLD);
      } else if (e.type === 'blast') {
        for (const b of e.bits) this.explode(6, b.x * TILE + 8, b.y * TILE + 8, b.kind === COLOR ? PARTICLE_COLORS[b.color]! : '#ffc46b');
        this.explode(24, e.x * TILE + 8, e.y * TILE + 8, '#ffffff');
        this.flashView(160, '#ffc46b');
        this.shakeView(320, 0.014);
      } else if (e.type === 'fee') {
        this.explode(8, e.x * TILE + 8, e.y * TILE + 8, '#f7931a');
        this.floatText(`+${e.value >= 1000 ? `${Math.round(e.value / 100) / 10}k` : e.value}`, [e], '#f7931a');
      } else if (e.type === 'nonce') {
        this.explode(40, e.x * TILE + 8, e.y * TILE + 8, GOLD);
        this.flashView(180, GOLD);
      } else if (e.type === 'die') {
        this.shakeView(250, 0.012);
      }
    }
  }
}

/** A square sprite turned `turns` quarter turns clockwise, pixel for pixel. */
function turn(src: HTMLCanvasElement, turns: number): HTMLCanvasElement {
  const n = src.width;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const from = src.getContext('2d')!.getImageData(0, 0, n, n);
  const ctx = c.getContext('2d')!;
  const to = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let [fx, fy] = [x, y];
      // Each quarter turn back: where this pixel came from.
      for (let t = 0; t < turns; t++) [fx, fy] = [fy, n - 1 - fx];
      to.data.set(from.data.subarray((fy * n + fx) * 4, (fy * n + fx) * 4 + 4), (y * n + x) * 4);
    }
  }
  ctx.putImageData(to, 0, 0);
  return c;
}
