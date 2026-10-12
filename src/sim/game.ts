import { BOMB, COLOR, EMPTY, FEE, GROUND, Grid, HEADER, NONCE, ROCK, STEEL, STONE, WALL, isItem, parseRow } from './grid';
import { Mine, headerY } from './layers';
import { isqrt } from './rng';
import * as R from './rules';

const W = R.WIDTH;

/** Input bits: one mask per tick. */
export const LEFT = 1;
export const RIGHT = 2;
export const UP = 4;
export const DOWN = 8;

/** What a moving body is doing. */
export const WOBBLE = 1;
export const FALL = 2;
export const POP = 3;

/** Blocks moving as one: wobbling before a fall, falling, or about to pop. */
export interface Body {
  state: typeof WOBBLE | typeof FALL | typeof POP;
  timer: number;
  /** The tick it last moved down a row, for drawing it between rows. */
  movedAt: number;
  /** The combo level of the pop that set it moving: 0 when the bot did. */
  combo: number;
}

export type Dir = 'left' | 'right' | 'up' | 'down';
export type BotAction = 'idle' | 'walk' | 'climb' | 'hop' | 'fall' | 'drill' | 'dead';

export interface Bot {
  x: number;
  y: number;
  /** Where the current move started, for drawing. */
  fromX: number;
  fromY: number;
  facing: -1 | 1;
  action: BotAction;
  /** Ticks left in the current action, and its whole length. */
  timer: number;
  duration: number;
  drillDir: Dir;
  /** Ticks of protection left after a respawn. */
  shield: number;
}

/** A block that went away, for effects. */
export interface Bit {
  x: number;
  y: number;
  kind: number;
  color: number;
}

export type GameEvent =
  | { type: 'drill'; bits: Bit[] }
  | { type: 'rock'; x: number; y: number; broken: boolean }
  /** Steel dug at, to no effect. */
  | { type: 'clang'; x: number; y: number }
  /** A hop up onto steel. */
  | { type: 'climb' }
  /** A jump, with ↑ where it's open. */
  | { type: 'hop' }
  /** A bomb lit, by digging it or by another's blast. */
  | { type: 'fuse'; x: number; y: number }
  /** A bomb going off: what it blew away, and where. */
  | { type: 'blast'; x: number; y: number; bits: Bit[] }
  | { type: 'wobble' }
  | { type: 'land' }
  | { type: 'pop'; bits: Bit[]; combo: number; sats: number }
  | { type: 'shatter'; bits: Bit[] }
  | { type: 'die'; cause: 'crush' | 'blast' }
  | { type: 'respawn' }
  | { type: 'layer'; layer: number; difficulty: number; halving: boolean }
  /** A layer's nonce found: the block is mined, its fees paid out, and the chain grows. */
  | { type: 'nonce'; layer: number; x: number; y: number; reward: number; subsidy: number; fees: number; chain: number }
  /** A layer left behind without its nonce: orphaned, its fees lost, and the chain broken. */
  | { type: 'missed'; layer: number; chain: number; fees: number }
  /** A fee picked up: `pending` is all the next nonce will pay out in fees. */
  | { type: 'fee'; x: number; y: number; value: number; pending: number }
  | { type: 'over' };

const STEP: Record<Dir, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

/**
 * One run. Everything is integer arithmetic on a fixed tick, and nothing reads
 * the clock or Math.random, so the same mine and inputs give the same run on
 * any device.
 */
export class Game {
  readonly grid = new Grid();
  readonly bodies = new Map<number, Body>();
  readonly bot: Bot;
  tick = 0;
  lives = R.LIVES;
  sats = 0;
  /** The highest combo level popping right now. */
  combo = 0;
  maxCombo = 0;
  /** Thousandths: 1000 is difficulty 1. It rises with every level. */
  difficulty = R.D_ONE;
  /** The deepest layer whose header the bot has reached. */
  layer = 0;
  /** Nonces found, and layers left without theirs. */
  mined = 0;
  missed = 0;
  /** Blocks mined in a row: the reward's multiplier, shown as the chain. */
  chain = 0;
  /** Fees picked up since the last nonce: the next one pays them out, a miss loses them. */
  pending = 0;
  maxChain = 0;
  over = false;
  /** What happened this tick, for drawing and sound. */
  events: GameEvent[] = [];

  private nextBody = 1;
  private dirty = true;
  /** The last fresh press made while the bot was busy, and its age in ticks. */
  private buffer = 0;
  private bufferAge = R.BUFFER_TICKS;
  /** Last tick's input, to tell a fresh press from a key still held. */
  private lastInput = 0;
  /** The deepest row the bot has been on: it never gets more than a row above it. */
  private deepest = 0;
  /** ↑ pressed with something coming down: the bot waits, drill up, to hit it as it arrives. */
  braced = false;
  /** Until this tick, what's right above the bot rests on its drill instead of falling on it. */
  private propUntil = -1;
  private deathTimer = 0;
  private minedLayers = new Set<number>();
  /** Cells that landed this tick, as y * WIDTH + x, with their bodies' combo levels. */
  private landed: [p: number, combo: number][] = [];
  /** The highest combo level among the pops that loosened blocks since the last settle. */
  private cause = 0;
  /** Resting groups from the last settle: a group id per cell, and each group's cells. */
  private groupOf = new Int32Array(W * R.WINDOW_ROWS);
  private groups: number[][] = [];

  constructor(
    readonly mine: Mine | null,
    startX = Math.floor(W / 2),
    startY = R.FIELD_TOP - 1,
  ) {
    this.deepest = startY;
    this.bot = {
      x: startX,
      y: startY,
      fromX: startX,
      fromY: startY,
      facing: 1,
      action: 'idle',
      timer: 0,
      duration: 0,
      drillDir: 'down',
      shield: 0,
    };
    this.scroll();
    this.settle();
  }

  /**
   * A game on a fixed grid, for tests: rows as parseRow reads them, with '@'
   * the bot, on an empty cell. The last row rests on the ground.
   */
  static fromRows(rows: string[]): Game {
    const game = new Game(null, 0, 0);
    for (const [y, line] of rows.entries()) {
      const x = line.indexOf('@');
      if (x >= 0) {
        game.bot.x = game.bot.fromX = x;
        game.bot.y = game.bot.fromY = game.deepest = y;
      }
      game.grid.push(parseRow(line));
    }
    game.settle();
    return game;
  }

  /** Advances one tick with this tick's input mask. */
  step(input: number): void {
    this.events = [];
    if (this.over) return;
    this.tick++;
    this.updateBot(input);
    if (this.dirty) this.settle();
    this.updateBodies();
    if (this.tick % R.FALL_TICKS === 0) this.fallStep();
    this.burnFuses();
    if (this.dirty) this.settle();
    if (this.landed.length) this.popLanded();
    this.combo = 0;
    for (const b of this.bodies.values()) if (b.state === POP) this.combo = Math.max(this.combo, b.combo);
    this.scroll();
  }

  /** Depth in metres: rows below the surface. */
  get depth(): number {
    return Math.max(0, this.bot.y - (R.FIELD_TOP - 1));
  }

  get halvings(): number {
    return halvingsAt(this.layer);
  }

  /** Whether the block the bot is in has been mined. */
  get blockMined(): boolean {
    return this.minedLayers.has(this.layer);
  }

  /**
   * The nonce to go for: the current block's, until it's mined, then the next
   * block's. Null while it isn't generated yet.
   */
  nonce(): [x: number, y: number] | null {
    const target = (this.layer >= 1 && !this.blockMined ? this.layer : this.layer + 1) & 0xff;
    const g = this.grid;
    for (let y = g.top; y < g.bottom; y++) {
      for (let x = 0; x < W; x++) {
        const i = g.i(x, y);
        if (g.kind[i] === NONCE && g.color[i] === target) return [x, y];
      }
    }
    return null;
  }

  /** What the next nonce found pays: the block reward times the chain it would make. */
  get nonceReward(): number {
    return ((R.BLOCK_REWARD >> this.halvings) + this.pending) * Math.min(this.chain + 1, R.MAX_CHAIN);
  }

  /** What a fee is worth at the bot's layer: FEE_SATS, compounding FEE_GROWTH percent a layer. */
  get feeValue(): number {
    let v = R.FEE_SATS;
    for (let k = 1; k < this.layer; k++) v = Math.floor((v * (100 + R.FEE_GROWTH)) / 100);
    return v;
  }

  /** An FNV-1a hash of the whole state, for determinism checks. */
  hash(): number {
    let h = 2166136261;
    const mix = (v: number) => {
      h = Math.imul(h ^ (v & 0xff), 16777619);
      h = Math.imul(h ^ ((v >>> 8) & 0xff), 16777619);
      h = Math.imul(h ^ ((v >>> 16) & 0xff), 16777619);
      h = Math.imul(h ^ (v >>> 24), 16777619);
    };
    const g = this.grid;
    mix(g.top);
    mix(g.bottom);
    for (let y = g.top; y < g.bottom; y++) {
      for (let x = 0; x < W; x++) {
        const i = g.i(x, y);
        mix(g.kind[i]! | (g.color[i]! << 8) | (g.hits[i]! << 16));
        mix(g.body[i]!);
      }
    }
    for (const [id, b] of this.bodies) {
      mix(id);
      mix(b.state);
      mix(b.timer);
    }
    const bot = this.bot;
    for (const v of [bot.x, bot.y, bot.facing, bot.timer, bot.shield, this.buffer, this.bufferAge, this.lastInput, this.deepest, +this.braced, this.propUntil, this.lives, this.sats, this.combo, this.chain, this.pending, this.difficulty, this.layer, this.tick]) mix(v);
    return h >>> 0;
  }

  // The bot

  private updateBot(input: number): void {
    const bot = this.bot;
    const fresh = input & ~this.lastInput;
    this.lastInput = input;
    if (bot.action === 'dead') {
      if (--this.deathTimer <= 0) this.respawn();
      return;
    }
    if (bot.shield > 0) bot.shield--;
    if (bot.timer > 0 && --bot.timer > 0) {
      this.remember(input, fresh);
      return;
    }
    const jumped = bot.action === 'hop';
    bot.action = 'idle';
    bot.fromX = bot.x;
    bot.fromY = bot.y;

    // At the top of a jump, ← or → lands on the ledge that side, before gravity takes the bot back down.
    if (jumped && this.land(input)) return;

    if (this.grid.kindAt(bot.x, bot.y + 1) === EMPTY) {
      this.remember(input, fresh);
      this.botMove(0, 1, 'fall', R.BOT_FALL_TICKS);
      return;
    }

    // A press kept from while busy counts as fresh, even with the key still held.
    let up = fresh & UP;
    if (this.bufferAge < R.BUFFER_TICKS) {
      up |= this.buffer & UP;
      if (!input) input = this.buffer;
    }
    this.buffer = 0;
    this.bufferAge = R.BUFFER_TICKS;

    const lr = (input & LEFT ? -1 : 0) + (input & RIGHT ? 1 : 0);
    if (lr !== 0) bot.facing = lr < 0 ? -1 : 1;

    // Braced: hit what's coming the moment it's right above. Moving or digging down lets go.
    if (this.braced) {
      if (input & (DOWN | LEFT | RIGHT) || !this.coming(bot.x, bot.y)) this.braced = false;
      else {
        if (this.moving(bot.x, bot.y - 1)) {
          this.braced = false;
          this.drill('up');
        }
        return;
      }
    }

    if (input & DOWN) this.drill('down');
    else if (input & UP) {
      // ↑ digs up what's above. A piece coming down takes a fresh press a hit, so
      // holding ↑ is no shield. Where it's open, ↑ braces for what's coming, or
      // else a fresh ↑ jumps.
      if (this.moving(bot.x, bot.y - 1)) {
        if (up & UP) this.drill('up');
      } else if (this.free(bot.x, bot.y - 1) && this.coming(bot.x, bot.y)) this.braced = true;
      else if (up & UP && this.canHop()) this.hop();
      else this.drill('up');
    } else if (lr !== 0) this.walk(lr);
  }

  /** A piece wobbling or falling at (x, y). */
  private moving(x: number, y: number): boolean {
    const body = this.bodies.get(this.grid.bodyAt(x, y));
    return !!body && body.state !== POP;
  }



  /** Never more than a row above the deepest point: a jump is a step up, never a way back up. */
  private canHop(): boolean {
    const { x, y } = this.bot;
    return y >= this.deepest && this.free(x, y - 1) && !this.coming(x, y);
  }

  private hop(): void {
    const { x, y } = this.bot;
    if (isItem(this.grid.kindAt(x, y - 1))) this.take(x, y - 1);
    this.botMove(0, -1, 'hop', R.HOP_TICKS);
    this.events.push({ type: 'hop' });
  }

  /** Lands a jump on the ledge to the side ← or → points to, held or pressed during it. Whether it did. */
  private land(input: number): boolean {
    const bot = this.bot;
    let steer = input;
    if (!(steer & (LEFT | RIGHT)) && this.bufferAge < R.BUFFER_TICKS) steer = this.buffer;
    const lr = (steer & LEFT ? -1 : 0) + (steer & RIGHT ? 1 : 0);
    if (!lr || !this.free(bot.x + lr, bot.y)) return false;
    this.buffer = 0;
    this.bufferAge = R.BUFFER_TICKS;
    bot.facing = lr < 0 ? -1 : 1;
    if (isItem(this.grid.kindAt(bot.x + lr, bot.y))) this.take(bot.x + lr, bot.y);
    this.botMove(lr, 0, 'walk', R.WALK_TICKS);
    return true;
  }

  /** Something loose or falling above (x, y), before the first block at rest. */
  private coming(x: number, y: number): boolean {
    const g = this.grid;
    for (let yy = y - 1; yy >= g.top; yy--) {
      const body = this.bodies.get(g.bodyAt(x, yy));
      if (body && body.state !== POP) return true;
      if (!body && g.kindAt(x, yy) !== EMPTY) return false;
    }
    return false;
  }

  /**
   * Keeps a fresh press made while the bot is busy, so a quick tap is not
   * lost. Only fresh ones: a key still held from the press that started the
   * move must not move the bot again once it's let go.
   */
  private remember(input: number, fresh: number): void {
    if (fresh) {
      this.buffer = input;
      this.bufferAge = 0;
    } else if (this.bufferAge < R.BUFFER_TICKS) this.bufferAge++;
  }

  private botMove(dx: number, dy: number, action: BotAction, ticks: number): void {
    const bot = this.bot;
    bot.fromX = bot.x;
    bot.fromY = bot.y;
    bot.x += dx;
    bot.y += dy;
    bot.action = action;
    bot.timer = bot.duration = ticks;
    this.deepest = Math.max(this.deepest, bot.y);
    if (this.mine) while (bot.y >= headerY(this.layer + 1)) this.reachLayer(this.layer + 1);
  }

  /**
   * Steps sideways, picking up an item there, or digs the block in the way.
   * Steel can't be dug, so the bot climbs onto it instead, where there is
   * room, and as a jump, never more than a row above the deepest point.
   */
  private walk(dx: number): void {
    const { x, y } = this.bot;
    const g = this.grid;
    const tx = x + dx;
    let k = g.kindAt(tx, y);
    if (isItem(k) && g.bodyAt(tx, y) === 0) {
      this.take(tx, y);
      k = EMPTY;
    }
    if (k === EMPTY) this.botMove(dx, 0, 'walk', R.WALK_TICKS);
    else if (k === STEEL && y >= this.deepest && this.free(x, y - 1) && this.free(tx, y - 1)) {
      if (isItem(g.kindAt(tx, y - 1))) this.take(tx, y - 1);
      this.botMove(dx, -1, 'climb', R.CLIMB_TICKS);
      this.events.push({ type: 'climb' });
    } else if (k !== WALL && k !== GROUND) this.drill(dx < 0 ? 'left' : 'right');
  }

  /** Room for the bot: empty, or an item at rest it would pick up. */
  private free(x: number, y: number): boolean {
    const k = this.grid.kindAt(x, y);
    return k === EMPTY || (isItem(k) && this.grid.bodyAt(x, y) === 0);
  }

  private drill(dir: Dir): void {
    const bot = this.bot;
    const g = this.grid;
    bot.action = 'drill';
    bot.drillDir = dir;
    bot.timer = bot.duration = R.DRILL_TICKS;
    const [dx, dy] = STEP[dir];
    const x = bot.x + dx;
    const y = bot.y + dy;
    const k = g.kindAt(x, y);
    if (k === EMPTY || k === WALL || k === GROUND) return;
    const b = g.bodyAt(x, y);
    // Wobbling and falling pieces can be dug, so a quick ↑ saves the bot. Popping ones are going anyway.
    if (b !== 0 && this.bodies.get(b)?.state === POP) return;
    // A hit on a piece coming down holds up whatever is right above for a moment.
    if (b !== 0 && dir === 'up') this.propUntil = this.tick + R.PROP_TICKS;

    if (k === COLOR || k === STONE) {
      const bits = k === COLOR ? this.component(x, y) : [{ x, y, kind: STONE, color: 0 }];
      for (const bit of bits) g.clear(bit.x, bit.y);
      this.sats += R.DRILL_SATS * bits.length;
      this.events.push({ type: 'drill', bits });
    } else if (k === ROCK) {
      const i = g.i(x, y);
      g.hits[i]!++;
      const broken = g.hits[i]! >= this.rockHits;
      if (broken) g.clear(x, y);
      this.events.push({ type: 'rock', x, y, broken });
      if (!broken) return;
    } else if (k === STEEL) {
      // Steel holds, unless it's the only way on.
      this.events.push({ type: 'clang', x, y });
      if (!this.trapped()) return;
      g.clear(x, y);
    } else if (k === BOMB) {
      const i = g.i(x, y);
      if (g.hits[i] === 0) {
        g.hits[i] = this.fuseTicks;
        this.events.push({ type: 'fuse', x, y });
      }
      return;
    } else if (isItem(k)) {
      this.take(x, y);
    } else if (k === HEADER) {
      g.clear(x, y);
      this.events.push({ type: 'drill', bits: [{ x, y, kind: HEADER, color: 0 }] });
    }
    this.dirty = true;
  }

  /**
   * No way on but through steel: every cell the bot can get to along its
   * row, walking or digging, has steel under it.
   */
  private trapped(): boolean {
    const { x, y } = this.bot;
    const g = this.grid;
    for (const dir of [-1, 1]) {
      for (let cx = x; cx >= 0 && cx < W; cx += dir) {
        if (cx !== x && g.kindAt(cx, y) === STEEL) break;
        if (g.kindAt(cx, y + 1) !== STEEL) return false;
      }
    }
    return true;
  }

  /** Picks up a fee or a nonce. */
  private take(x: number, y: number): void {
    const g = this.grid;
    const i = g.i(x, y);
    if (g.kind[i] === NONCE) {
      // The colour byte holds the layer's low byte; the layer is the latest one with it.
      const layer = this.layer - ((this.layer - g.color[i]!) & 0xff);
      const reward = this.nonceReward;
      const fees = this.pending;
      this.sats += reward;
      this.pending = 0;
      this.chain++;
      this.maxChain = Math.max(this.maxChain, this.chain);
      this.mined++;
      this.minedLayers.add(layer);
      this.events.push({ type: 'nonce', layer, x, y, reward, subsidy: R.BLOCK_REWARD >> this.halvings, fees, chain: this.chain });
    } else {
      const value = this.feeValue;
      this.pending += value;
      this.events.push({ type: 'fee', x, y, value, pending: this.pending });
    }
    g.clear(x, y);
    this.dirty = true;
  }

  private reachLayer(k: number): void {
    const left = k - 1;
    if (left >= 1 && !this.minedLayers.has(left)) {
      // Missed: the block is orphaned with its fees, its nonce turns to rock, and the chain breaks.
      const chain = this.chain;
      const fees = this.pending;
      this.chain = 0;
      this.pending = 0;
      this.missed++;
      const g = this.grid;
      for (let y = g.top; y < g.bottom; y++) {
        for (let x = 0; x < W; x++) {
          const i = g.i(x, y);
          if (g.kind[i] === NONCE && g.color[i] === (left & 0xff)) g.kind[i] = ROCK;
        }
      }
      this.events.push({ type: 'missed', layer: left, chain, fees });
    }
    this.layer = k;
    this.difficulty = Math.min(R.D_ONE + (k - 1) * R.D_STEP, R.D_MAX);
    const halving = k > 1 && (k - 1) % R.HALVING_LAYERS === 0;
    this.events.push({ type: 'layer', layer: k, difficulty: this.difficulty, halving });
  }

  private die(cause: 'crush' | 'blast'): void {
    const bot = this.bot;
    bot.action = 'dead';
    bot.timer = 0;
    bot.fromX = bot.x;
    bot.fromY = bot.y;
    this.lives--;
    this.deathTimer = R.DEATH_TICKS;
    this.events.push({ type: 'die', cause });
  }

  private respawn(): void {
    if (this.lives <= 0) {
      this.over = true;
      this.events.push({ type: 'over' });
      return;
    }
    const bot = this.bot;
    // Clear the bot's cell and the two above it, so it doesn't respawn buried.
    for (let y = bot.y; y >= bot.y - 2; y--) if (this.grid.inside(bot.x, y)) this.grid.clear(bot.x, y);
    bot.action = 'idle';
    bot.shield = R.SHIELD_TICKS;
    this.dirty = true;
    this.events.push({ type: 'respawn' });
  }

  /** Burns every lit bomb's fuse down a tick, and sets off those burnt out. */
  private burnFuses(): void {
    const g = this.grid;
    const due: [number, number][] = [];
    for (let y = g.top; y < g.bottom; y++) {
      for (let x = 0; x < W; x++) {
        const i = g.i(x, y);
        if (g.kind[i] === BOMB && g.hits[i]! > 0 && --g.hits[i]! === 0) due.push([x, y]);
      }
    }
    for (const [x, y] of due) this.blast(x, y);
  }

  /**
   * A bomb going off: everything in the 3x3 around it goes, steel too, but
   * the level line holds, and fees and nonces are left to fall. Other bombs
   * in it go off soon after, and the bot in it is lost, shield or not.
   */
  private blast(cx: number, cy: number): void {
    const g = this.grid;
    const bits: Bit[] = [];
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        if (!g.inside(x, y)) continue;
        const i = g.i(x, y);
        const k = g.kind[i]!;
        if (k === BOMB && (x !== cx || y !== cy)) {
          if (g.hits[i] === 0 || g.hits[i]! > R.CHAIN_FUSE_TICKS) {
            g.hits[i] = R.CHAIN_FUSE_TICKS;
            this.events.push({ type: 'fuse', x, y });
          }
          continue;
        }
        if (k === EMPTY || k === HEADER || isItem(k)) continue;
        bits.push({ x, y, kind: k, color: g.color[i]! });
        g.clear(x, y);
      }
    }
    this.events.push({ type: 'blast', x: cx, y: cy, bits });
    this.dirty = true;
    const bot = this.bot;
    if (bot.action !== 'dead' && Math.abs(bot.x - cx) <= 1 && Math.abs(bot.y - cy) <= 1) this.die('blast');
  }

  // Blocks

  /**
   * Finds resting groups, works out which are held up, and sets the rest
   * moving. A group is held up by ground, a popping block, or a held-up block
   * of another group. Never by the bot, and never by a moving block. Header
   * tiles and steel are anchored: the line marks a layer's top, steel is
   * girders, and neither ever falls.
   */
  private settle(): void {
    this.dirty = false;
    const g = this.grid;

    const alive = new Set<number>();
    for (let y = g.top; y < g.bottom; y++) for (let x = 0; x < W; x++) alive.add(g.body[g.i(x, y)]!);
    for (const id of [...this.bodies.keys()]) if (!alive.has(id)) this.bodies.delete(id);

    this.groupOf.fill(-1);
    const groups: number[][] = [];
    for (let y = g.top; y < g.bottom; y++) {
      for (let x = 0; x < W; x++) {
        const i = g.i(x, y);
        if (g.kind[i] === EMPTY || g.body[i] !== 0 || this.groupOf[i] !== -1) continue;
        groups.push(this.label(x, y, groups.length));
      }
    }

    // Held from the start: header tiles, steel, and groups cut by the window's
    // top, which may go on above it. What comes loose out of sight falls like
    // the rest, so nothing is left hanging up there, a nonce least of all.
    const held = new Uint8Array(groups.length);
    groups.forEach((cells, id) => {
      const cut = g.top > 0 && cells.some((p) => Math.floor(p / W) === g.top);
      const p = cells[0]!;
      const x = p % W;
      const k = g.kindAt(x, (p - x) / W);
      if (cut || k === HEADER || k === STEEL) held[id] = 1;
    });
    for (let changed = true; changed; ) {
      changed = false;
      for (let id = groups.length - 1; id >= 0; id--) {
        if (held[id]) continue;
        for (const p of groups[id]!) {
          const x = p % W;
          if (this.restsOn(x, (p - x) / W + 1, id, held)) {
            held[id] = 1;
            changed = true;
            break;
          }
        }
      }
    }

    // Loose groups start moving, lowest first, so a group resting on another
    // moving body can join its motion.
    const loose = groups
      .map((cells, id) => ({ id, cells, low: Math.max(...cells) }))
      .filter((l) => !held[l.id])
      .sort((a, b) => b.low - a.low);
    let wobbled = false;
    for (const { cells } of loose) {
      // A loose stone gives no warning: it drops at once.
      let state: Body['state'] = cells.length === 1 && g.kindAt(cells[0]! % W, Math.floor(cells[0]! / W)) === STONE ? FALL : WOBBLE;
      let timer = this.wobbleTicks;
      let combo = this.cause;
      for (const p of cells) {
        const x = p % W;
        const b = this.bodies.get(g.bodyAt(x, (p - x) / W + 1));
        if (!b) continue;
        if (b.state === FALL) state = FALL;
        else if (b.state === WOBBLE) timer = Math.min(timer, b.timer);
        combo = Math.max(combo, b.combo);
      }
      const id = this.nextBody++;
      this.bodies.set(id, { state, timer: state === FALL ? 0 : timer, movedAt: -1, combo });
      for (const p of cells) {
        const x = p % W;
        g.body[g.i(x, (p - x) / W)] = id;
      }
      if (state === WOBBLE) wobbled = true;
    }
    if (wobbled) this.events.push({ type: 'wobble' });
    this.groups = groups;
    this.cause = 0;
  }

  /** Labels the resting group at (x, y) and returns its cells. */
  private label(x: number, y: number, id: number): number[] {
    const g = this.grid;
    const i0 = g.i(x, y);
    this.groupOf[i0] = id;
    if (g.kind[i0] !== COLOR) return [y * W + x];
    const color = g.color[i0];
    const cells: number[] = [];
    const stack = [y * W + x];
    while (stack.length) {
      const p = stack.pop()!;
      cells.push(p);
      const px = p % W;
      const py = (p - px) / W;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = px + dx;
        const ny = py + dy;
        if (!g.inside(nx, ny)) continue;
        const n = g.i(nx, ny);
        if (this.groupOf[n] !== -1 || g.kind[n] !== COLOR || g.color[n] !== color || g.body[n] !== 0) continue;
        this.groupOf[n] = id;
        stack.push(ny * W + nx);
      }
    }
    return cells;
  }

  private restsOn(x: number, y: number, self: number, held: Uint8Array): boolean {
    const g = this.grid;
    if (y >= g.bottom) return true;
    if (y < g.top) return false;
    const i = g.i(x, y);
    if (g.kind[i] === EMPTY) return false;
    const b = g.body[i]!;
    if (b !== 0) return this.bodies.get(b)?.state === POP;
    const other = this.groupOf[i]!;
    return other !== self && held[other] === 1;
  }

  /** The block at (x, y) and everything that drills with it: its colour group within the same body. */
  private component(x: number, y: number): Bit[] {
    const g = this.grid;
    const i0 = g.i(x, y);
    const color = g.color[i0]!;
    const body = g.body[i0];
    const seen = new Set<number>([y * W + x]);
    const stack = [y * W + x];
    const bits: Bit[] = [];
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % W;
      const py = (p - px) / W;
      bits.push({ x: px, y: py, kind: COLOR, color });
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = px + dx;
        const ny = py + dy;
        const np = ny * W + nx;
        if (!g.inside(nx, ny) || seen.has(np)) continue;
        const n = g.i(nx, ny);
        if (g.kind[n] !== COLOR || g.color[n] !== color || g.body[n] !== body) continue;
        seen.add(np);
        stack.push(np);
      }
    }
    return bits;
  }

  private updateBodies(): void {
    const g = this.grid;
    for (const [id, b] of this.bodies) {
      if (b.state === WOBBLE) {
        if (--b.timer <= 0) b.state = FALL;
      } else if (b.state === POP && --b.timer <= 0) {
        for (let y = g.top; y < g.bottom; y++) for (let x = 0; x < W; x++) if (g.body[g.i(x, y)] === id) g.clear(x, y);
        this.bodies.delete(id);
        this.cause = Math.max(this.cause, b.combo);
        this.dirty = true;
      }
    }
  }

  /** Moves every falling body down a row, lowest first, or lands it. */
  private fallStep(): void {
    const g = this.grid;
    const falling = new Map<number, number[]>();
    for (let y = g.bottom - 1; y >= g.top; y--) {
      for (let x = 0; x < W; x++) {
        const id = g.body[g.i(x, y)]!;
        if (id === 0 || this.bodies.get(id)?.state !== FALL) continue;
        let cells = falling.get(id);
        if (!cells) falling.set(id, (cells = []));
        cells.push(y * W + x);
      }
    }
    let landed = false;
    for (const [id, cells] of falling) {
      // Held up on the bot's drill: neither falling on nor landing yet.
      if (this.tick <= this.propUntil && this.bot.action !== 'dead' && cells.includes((this.bot.y - 1) * W + this.bot.x)) continue;
      const free = cells.every((p) => {
        const x = p % W;
        const below = (p - x) / W + 1;
        const k = g.kindAt(x, below);
        return k === EMPTY || (k !== GROUND && g.body[g.i(x, below)] === id);
      });
      if (free) {
        // Lowest cells first, so each one moves into an emptied cell.
        for (const p of cells) {
          const x = p % W;
          g.moveDown(x, (p - x) / W);
        }
        this.bodies.get(id)!.movedAt = this.tick;
        this.hitBot(id);
      } else {
        const { combo } = this.bodies.get(id)!;
        for (const p of cells) {
          const x = p % W;
          g.body[g.i(x, (p - x) / W)] = 0;
          this.landed.push([p, combo]);
        }
        this.bodies.delete(id);
        this.dirty = true;
        landed = true;
      }
    }
    if (landed) this.events.push({ type: 'land' });
  }

  /** A falling block reaching the bot crushes it, or shatters on its shield. Items are caught. */
  private hitBot(id: number): void {
    const bot = this.bot;
    const g = this.grid;
    if (bot.action === 'dead' || !g.inside(bot.x, bot.y) || g.body[g.i(bot.x, bot.y)] !== id) return;
    if (isItem(g.kind[g.i(bot.x, bot.y)]!)) this.take(bot.x, bot.y);
    else if (bot.shield > 0) {
      const i = g.i(bot.x, bot.y);
      const bits = [{ x: bot.x, y: bot.y, kind: g.kind[i]!, color: g.color[i]! }];
      g.clear(bot.x, bot.y);
      this.events.push({ type: 'shatter', bits });
      this.dirty = true;
    } else this.die('crush');
  }

  /**
   * Landed same-colour groups of POP_SIZE or more pop. Each pop is one combo
   * level above the highest level among the blocks that landed in it.
   */
  private popLanded(): void {
    const g = this.grid;
    const popping = new Map<number, number>();
    for (const [p, combo] of this.landed) {
      const x = p % W;
      const y = (p - x) / W;
      if (!g.inside(x, y)) continue;
      const i = g.i(x, y);
      if (g.kind[i] !== COLOR || g.body[i] !== 0) continue;
      const id = this.groupOf[i]!;
      if (id < 0 || this.groups[id]!.length < R.POP_SIZE) continue;
      popping.set(id, Math.max(popping.get(id) ?? 0, combo + 1));
    }
    this.landed = [];

    for (const [gid, combo] of popping) {
      const id = this.nextBody++;
      this.bodies.set(id, { state: POP, timer: R.POP_TICKS, movedAt: -1, combo });
      const bits: Bit[] = [];
      for (const p of this.groups[gid]!) {
        const x = p % W;
        const y = (p - x) / W;
        const i = g.i(x, y);
        g.body[i] = id;
        bits.push({ x, y, kind: COLOR, color: g.color[i]! });
      }
      this.maxCombo = Math.max(this.maxCombo, combo);
      const sats = R.POP_SATS * bits.length * combo;
      this.sats += sats;
      this.events.push({ type: 'pop', bits, combo, sats });
    }
  }

  // Difficulty

  private get wobbleTicks(): number {
    return Math.max(R.MIN_WOBBLE_TICKS, Math.floor((R.WOBBLE_TICKS * 1000) / isqrt(this.difficulty * 1000)));
  }

  private get rockHits(): number {
    return R.ROCK_HITS - 1 + Math.floor(this.difficulty / 1000);
  }

  /** Bombs burn shorter, level by level. */
  private get fuseTicks(): number {
    return Math.max(R.MIN_FUSE_TICKS, R.FUSE_TICKS - Math.max(0, this.layer - R.BOMB_LEVEL) * R.FUSE_STEP);
  }

  /** Keeps KEEP_ABOVE rows above the bot and GEN_AHEAD below it. */
  private scroll(): void {
    if (!this.mine) return;
    const g = this.grid;
    while (g.top < this.bot.y - R.KEEP_ABOVE) g.dropTop();
    while (g.bottom < this.bot.y + R.GEN_AHEAD) {
      g.push(this.mine.next());
      this.dirty = true;
    }
  }
}

const NEIGHBOURS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Halvings so far at layer k: one every HALVING_LAYERS layers, from layer 1. */
function halvingsAt(k: number): number {
  return k < 1 ? 0 : Math.floor((k - 1) / R.HALVING_LAYERS);
}
