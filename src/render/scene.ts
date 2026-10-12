import Phaser from 'phaser';

import { FALL, type Game, type GameEvent, POP, WOBBLE } from '../sim/game';
import { CELL, COLOR, FEE, HEADER, NONCE, ROCK } from '../sim/grid';
import { headerY, layerAt } from '../sim/layers';
import { FALL_TICKS, TICK_HZ, VIEW_ABOVE, WIDTH } from '../sim/rules';
import type { Input } from './input';
import { BG, PARTICLE_COLORS, TILE, makeTextures } from './sprites';

/** Rows in view, and how many of them are above the bot. */
export const MIN_VIEW_ROWS = 13;
const BOT_ROW = VIEW_ABOVE;
const TICK_MS = 1000 / TICK_HZ;

/** Drawing order, back to front. */
const DEPTH = { bg: -1, cells: 0, labels: 1, glow: 2, stars: 3, drill: 4, bot: 5, dropLine: 6, warn: 7, sparks: 8, float: 9, arrow: 10 };

/** What the scene plays: swapped for a new run on restart. */
export interface Session {
  readonly game: Game;
  readonly paused: boolean;
  step(input: number): void;
  /** After each tick with events, and once a frame. */
  onEvents(events: GameEvent[]): void;
  onFrame(): void;
  /** The first time something needs explaining, such as the loose-block warning. */
  onHint(hint: 'loose'): void;
}

const STEP_OFFSET = { left: [-3, 8], right: [TILE + 2, 8], up: [8, -3], down: [8, TILE + 2] } as const;
const STEP_ANGLE = { left: 180, right: 0, up: -90, down: 90 } as const;

export class PlayScene extends Phaser.Scene {
  private cells: Phaser.GameObjects.Image[] = [];
  private botImg!: Phaser.GameObjects.Image;
  private drillImg!: Phaser.GameObjects.Image;
  /** Over the bot while something loose is above it, with a dotted line from it down to the bot. */
  private warnImg!: Phaser.GameObjects.Image;
  private dropLine!: Phaser.GameObjects.Graphics;
  private warned = false;
  private bg!: Phaser.GameObjects.TileSprite;
  /** Points at the nonce when it is off screen. */
  private arrow!: Phaser.GameObjects.Image;
  private arrowText!: Phaser.GameObjects.Text;
  /** "BLOCK n" across each block's top line in view. */
  private labels: Phaser.GameObjects.Text[] = [];
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** The nonce's pulsing halo and the stars that twinkle around it. */
  private glow!: Phaser.GameObjects.Image;
  private stars: Phaser.GameObjects.Image[] = [];
  private starAt = 0;
  private acc = 0;
  private viewY = 0;
  /** Game pixels hidden under the strip and the controls on touch screens. */
  private insetTop = 0;
  private insetBottom = 0;
  /** What the nonce pays, floating over it, where there's no panel to say so. */
  private priceText!: Phaser.GameObjects.Text;
  private showPrice = false;

  constructor(
    private readonly session: Session,
    private readonly keys: Input,
  ) {
    super('play');
  }

  create(): void {
    makeTextures(this);
    const bg = this.textures.createCanvas('bg', 32, 32)!;
    const ctx = bg.getContext();
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#001238';
    ctx.fillRect(0, 31, 32, 1);
    ctx.fillRect(15, 15, 1, 16);
    ctx.fillRect(0, 15, 32, 1);
    ctx.fillRect(31, 0, 1, 15);
    bg.refresh();

    const { width, height } = this.scale;
    this.bg = this.add.tileSprite(0, 0, width, height, 'bg').setOrigin(0).setScrollFactor(0).setDepth(DEPTH.bg);
    // The page can make the playfield taller or shorter: more or fewer rows below the bot.
    this.scale.on('resize', (size: Phaser.Structs.Size) => this.bg.setSize(size.width, size.height));
    for (let i = 0; i < 2; i++) {
      this.labels.push(
        this.add
          .text(0, 0, '', { fontFamily: '"Press Start 2P"', fontSize: '8px', color: '#ffd60a' })
          .setOrigin(0.5)
          .setDepth(DEPTH.labels)
          .setVisible(false),
      );
    }
    this.glow = this.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.glow).setVisible(false);
    for (let i = 0; i < 4; i++) {
      this.stars.push(this.add.image(0, 0, 'star').setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.stars).setVisible(false));
    }
    this.drillImg = this.add.image(0, 0, 'drill').setDepth(DEPTH.drill).setVisible(false);
    this.botImg = this.add.image(0, 0, 'bot').setOrigin(0).setDepth(DEPTH.bot);
    this.dropLine = this.add.graphics().setDepth(DEPTH.dropLine);
    this.warnImg = this.add.image(0, 0, 'warn').setOrigin(0.5, 1).setDepth(DEPTH.warn).setVisible(false);
    this.sparks = this.add.particles(0, 0, 'px', {
      lifespan: { min: 300, max: 650 },
      speed: { min: 25, max: 120 },
      angle: { min: 0, max: 360 },
      gravityY: 380,
      alpha: { start: 1, end: 0 },
      emitting: false,
    });
    this.sparks.setDepth(DEPTH.sparks);
    this.arrow = this.add.image(0, 0, 'arrow').setScrollFactor(0).setDepth(DEPTH.arrow).setVisible(false);
    this.arrowText = this.add
      .text(0, 0, '', { fontFamily: '"Press Start 2P"', fontSize: '8px', color: '#ffd60a', backgroundColor: '#00081c', padding: { x: 2, y: 1 } })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.arrow)
      .setVisible(false);
    this.priceText = this.add
      .text(0, 0, '', { fontFamily: '"Press Start 2P"', fontSize: '8px', color: '#ffd60a', backgroundColor: '#00081c', padding: { x: 2, y: 1 } })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.float)
      .setVisible(false);
    this.cameras.main.setRoundPixels(true);
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

  override update(_time: number, delta: number): void {
    const s = this.session;
    if (!s.paused) {
      this.acc += Math.min(delta, 100);
      while (this.acc >= TICK_MS) {
        this.acc -= TICK_MS;
        s.step(this.keys.sample());
        const events = s.game.events;
        if (events.length) {
          this.effects(events);
          s.onEvents(events);
        }
      }
    }
    this.draw(s.game, s.paused ? 0 : this.acc / TICK_MS);
    s.onFrame();
  }

  /** Rows in view, the last one perhaps partly. */
  private get rows(): number {
    return Math.ceil(this.scale.height / TILE);
  }

  /** Jumps the camera to the bot, for a new run. */
  reset(): void {
    this.acc = 0;
    this.viewY = 0;
  }

  private draw(game: Game, alpha: number): void {
    const g = game.grid;
    const bot = game.bot;

    const moving = bot.action === 'walk' || bot.action === 'fall';
    const p = moving && bot.duration > 0 ? Math.min(1, (bot.duration - bot.timer + alpha) / bot.duration) : 1;
    const bx = (bot.fromX + (bot.x - bot.fromX) * p) * TILE;
    const by = (bot.fromY + (bot.y - bot.fromY) * p) * TILE;

    const target = Math.max(-this.insetTop, by - BOT_ROW * TILE - this.insetTop);
    this.viewY += (target - this.viewY) * 0.18;
    if (Math.abs(target - this.viewY) < 0.5) this.viewY = target;
    const cam = this.cameras.main;
    cam.scrollY = Math.round(this.viewY);
    this.bg.tilePositionY = Math.round(this.viewY / 2);

    const first = Math.floor(this.viewY / TILE) - 1;
    const rows = this.rows;
    while (this.cells.length < WIDTH * (rows + 2)) {
      this.cells.push(this.add.image(0, 0, 'header').setOrigin(0).setDepth(DEPTH.cells).setVisible(false));
    }
    let n = 0;
    let nonceAt: [number, number] | null = null;
    for (let y = first; y < first + rows + 2; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const img = this.cells[n++]!;
        const k = g.kindAt(x, y);
        const key = this.texture(game, k, x, y);
        if (!key) {
          img.setVisible(false);
          continue;
        }
        let dx = 0;
        let dy = 0;
        const body = game.bodies.get(g.bodyAt(x, y));
        img.clearTint();
        if (body?.state === WOBBLE) {
          dx = (game.tick >> 2) & 1 ? 1 : -1;
          if ((game.tick >> 3) & 1) img.setTint(0xffc0c0);
        }
        else if (body?.state === FALL && body.movedAt >= 0) {
          dy = -Math.round((1 - Math.min(1, (game.tick - body.movedAt + alpha) / FALL_TICKS)) * TILE);
        } else if (body?.state === POP && (game.tick >> 1) & 1) img.setTintFill(0xffffff);
        img.setTexture(key).setPosition(x * TILE + dx, y * TILE + dy).setVisible(true);
        if (k === NONCE && !nonceAt) nonceAt = [x * TILE + dx + TILE / 2, y * TILE + dy + TILE / 2];
      }
    }
    for (; n < this.cells.length; n++) this.cells[n]!.setVisible(false);
    this.shine(game, nonceAt);
    this.price(game, nonceAt);

    this.labelBlocks(game, first);
    this.pointAtNonce(game, by);

    const dead = bot.action === 'dead';
    this.botImg
      .setPosition(Math.round(bx), Math.round(by))
      .setFlipX(bot.facing < 0)
      .setAlpha(dead ? ((game.tick >> 3) & 1 ? 0.25 : 0.8) : bot.shield > 0 && (game.tick >> 2) & 1 ? 0.35 : 1);
    if (dead) this.botImg.setTint(0xff4d79);
    else this.botImg.clearTint();
    this.warn(game, dead ? null : this.loose(game, bot.x, bot.y), bx, by);

    if (bot.action === 'drill') {
      const [ox, oy] = STEP_OFFSET[bot.drillDir];
      const jitter = (game.tick >> 1) & 1;
      this.drillImg
        .setPosition(Math.round(bx) + ox + (bot.drillDir === 'up' || bot.drillDir === 'down' ? 0 : jitter), Math.round(by) + oy + (bot.drillDir === 'up' || bot.drillDir === 'down' ? jitter : 0))
        .setAngle(STEP_ANGLE[bot.drillDir])
        .setVisible(true);
    } else this.drillImg.setVisible(false);
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
    if (k === CELL) return `cell${(game.tick >> 4) & 1}`;
    if (k === FEE) return `fee${(game.tick >> 3) % 6 === 0 ? 1 : 0}`;
    if (k === HEADER) return 'header';
    if (k === NONCE) {
      const f = (game.tick >> 2) % 8;
      return `nonce${f < 3 ? f + 1 : 0}`;
    }
    return null;
  }

  /** Text that rises from where something happened and fades. */
  private floatText(text: string, bits: { x: number; y: number }[], color = '#ffd60a'): void {
    const x = (bits.reduce((s, b) => s + b.x, 0) / bits.length) * TILE + TILE / 2;
    const y = (bits.reduce((s, b) => s + b.y, 0) / bits.length) * TILE + TILE / 2;
    const t = this.add
      .text(Math.round(x), Math.round(y), text, { fontFamily: '"Press Start 2P"', fontSize: '8px', color, stroke: '#00081c', strokeThickness: 2 })
      .setOrigin(0.5)
      .setDepth(DEPTH.float);
    this.tweens.add({ targets: t, y: y - 20, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  /** A pulsing halo on the nonce in view, and stars twinkling around it. */
  private shine(game: Game, at: [number, number] | null): void {
    if (!at) {
      this.glow.setVisible(false);
      return;
    }
    const wave = Math.sin((this.time.now / 900) * Math.PI * 2);
    this.glow
      .setPosition(at[0], at[1])
      .setAlpha(0.6 + 0.3 * wave)
      .setScale(1 + 0.1 * wave)
      .setVisible(true);
    if (game.tick - this.starAt < 9) return;
    this.starAt = game.tick;
    const star = this.stars.find((s) => !s.visible);
    if (!star) return;
    // Somewhere on the ring around the nonce, never on top of it.
    const angle = Math.random() * Math.PI * 2;
    const r = 9 + Math.random() * 5;
    star
      .setPosition(Math.round(at[0] + Math.cos(angle) * r), Math.round(at[1] + Math.sin(angle) * r))
      .setScale(0)
      .setVisible(true);
    this.tweens.add({ targets: star, scale: 1, duration: 160, yoyo: true, onComplete: () => star.setVisible(false) });
  }

  /** Labels the line each level starts at, so the player can see where levels are. */
  private labelBlocks(game: Game, first: number): void {
    let n = 0;
    for (let k = Math.max(1, layerAt(first)); n < this.labels.length; k++) {
      const y = headerY(k);
      if (y > first + this.rows + 1) break;
      if (y < first) continue;
      this.labels[n++]!.setText(`LEVEL ${k}`)
        .setPosition((WIDTH * TILE) / 2, y * TILE + TILE / 2)
        .setVisible(true);
    }
    for (; n < this.labels.length; n++) this.labels[n]!.setVisible(false);
  }

  /** The row of anything wobbling or falling above (x, y), before the first resting block. */
  private loose(game: Game, x: number, y: number): number | null {
    const g = game.grid;
    for (let yy = y - 1; yy >= g.top; yy--) {
      const body = game.bodies.get(g.bodyAt(x, yy));
      if (body && body.state !== POP) return yy;
      if (!body && g.kindAt(x, yy) !== 0) return null;
    }
    return null;
  }

  /** A blinking ! over the bot, and a dotted line from what's about to fall down to it. */
  private warn(game: Game, row: number | null, bx: number, by: number): void {
    this.dropLine.clear();
    const on = row !== null && ((game.tick >> 2) & 3) !== 0;
    this.warnImg.setPosition(Math.round(bx) + 8, Math.round(by) - 2 - ((game.tick >> 3) & 1)).setVisible(on);
    if (row === null) return;
    if (!this.warned) {
      this.warned = true;
      this.session.onHint('loose');
    }
    if (!on) return;
    this.dropLine.fillStyle(0xff4d79, 0.8);
    const x = Math.round(bx) + 7;
    for (let y = (row + 1) * TILE + 2; y < by - 12; y += 4) this.dropLine.fillRect(x, y, 2, 2);
  }

  /** An arrow at the edge of the view toward the nonce, with how far it is. */
  private pointAtNonce(game: Game, botY: number): void {
    const found = game.nonce();
    const height = this.scale.height - this.insetBottom;
    const top = this.viewY + this.insetTop;
    if (!found || (found[1] * TILE >= top && found[1] * TILE + TILE <= this.viewY + height)) {
      this.arrow.setVisible(false);
      this.arrowText.setVisible(false);
      return;
    }
    const below = found[1] * TILE > top;
    const bob = (game.tick >> 3) & 1;
    const x = Phaser.Math.Clamp(found[0] * TILE + 8, 6, WIDTH * TILE - 6);
    this.arrow
      .setPosition(x, below ? height - 4 - bob : this.insetTop + 4 + bob)
      .setFlipY(!below)
      .setVisible(true);
    this.arrowText
      .setText(`${Math.abs(Math.round(found[1] - botY / TILE))}m`)
      .setPosition(Phaser.Math.Clamp(x, 14, WIDTH * TILE - 14), below ? height - 14 : this.insetTop + 14)
      .setVisible(true);
  }

  /** "62K" over the nonce, while it is in the open: what mining it pays now. Otherwise the arrow points to it. */
  private price(game: Game, at: [number, number] | null): void {
    const open = at && at[1] - 8 >= this.viewY + this.insetTop && at[1] + 8 <= this.viewY + this.scale.height - this.insetBottom;
    if (!this.showPrice || !at || !open) {
      this.priceText.setVisible(false);
      return;
    }
    const n = game.nonceReward;
    const text = n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : `${Math.round(n / 1000)}K`;
    if (this.priceText.text !== text) this.priceText.setText(text);
    this.priceText.setPosition(Math.round(at[0]), Math.round(at[1]) - 10).setVisible(true);
  }

  private effects(events: GameEvent[]): void {
    for (const e of events) {
      if (e.type === 'drill' || e.type === 'pop' || e.type === 'shatter') {
        for (const b of e.bits) {
          this.sparks.setParticleTint(b.kind === COLOR ? PARTICLE_COLORS[b.color]! : 0x8fa6d9);
          this.sparks.explode(e.type === 'pop' ? 7 : 4, b.x * TILE + 8, b.y * TILE + 8);
        }
        if (e.type === 'pop') {
          this.cameras.main.shake(80 + 40 * e.combo, 0.004 * Math.min(e.combo, 4));
          if (e.combo >= 2) this.floatText(`×${e.combo}`, e.bits);
        }
      } else if (e.type === 'rock') {
        this.sparks.setParticleTint(0x8fa6d9);
        this.sparks.explode(e.broken ? 8 : 3, e.x * TILE + 8, e.y * TILE + 8);
      } else if (e.type === 'cell') {
        this.sparks.setParticleTint(0xffd60a);
        this.sparks.explode(10, e.x * TILE + 8, e.y * TILE + 8);
      } else if (e.type === 'fee') {
        this.sparks.setParticleTint(0xf7931a);
        this.sparks.explode(8, e.x * TILE + 8, e.y * TILE + 8);
        this.floatText(`+${e.value >= 1000 ? `${Math.round(e.value / 100) / 10}k` : e.value}`, [e], '#f7931a');
      } else if (e.type === 'nonce') {
        this.sparks.setParticleTint(0xffd60a);
        this.sparks.explode(40, e.x * TILE + 8, e.y * TILE + 8);
        this.cameras.main.flash(180, 255, 214, 10);
      } else if (e.type === 'die') {
        this.cameras.main.shake(250, 0.012);
      }
    }
  }
}
