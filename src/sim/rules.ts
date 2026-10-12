/**
 * Every tunable number in the game. Times are in ticks, 60 a second. A change
 * here changes what a run scores, so bump RULES_VERSION with it.
 */
export const RULES_VERSION = 7;
export const TICK_HZ = 60;

// The shaft
export const WIDTH = 9;
/** Rows of air above the field. The bot starts on the field's first row. */
export const FIELD_TOP = 4;
/** The easy rows before block 1's line: short, so block 1 is on screen at the start. */
export const TOPSOIL_ROWS = 8;
export const LAYER_ROWS = 40;
/** Where a layer's nonce can be, in rows below its header. */
export const NONCE_MIN_ROW = 8;
export const NONCE_MAX_ROW = 34;
/** Block 1's nonce sits just below its line, so the first one teaches the goal. */
export const FIRST_NONCE_MIN_ROW = 3;
export const FIRST_NONCE_MAX_ROW = 7;
/** Rows kept in memory: enough for KEEP_ABOVE + GEN_AHEAD and some slack. */
export const WINDOW_ROWS = 64;
/** Rows above the bot kept; higher ones are dropped and can no longer fall. */
export const KEEP_ABOVE = 16;
/**
 * Rows the player sees above the bot. A loose group entirely higher stays
 * put, so nothing starts falling out of sight.
 */
export const VIEW_ABOVE = 4;
/** Rows generated below the bot. */
export const GEN_AHEAD = 28;

// Generation
export const COLORS = 4;
export const TOPSOIL_COLORS = 3;
/** Chance a block copies its left neighbour's colour, then its upper one's. */
export const STICK_LEFT = 0.3;
export const STICK_UP = 0.25;
/** Chance a row holds a transaction fee: about 8 a level, anywhere across it. */
export const FEE_CHANCE = 0.2;
export const TOPSOIL_FEE_CHANCE = 0.25;
/** A block with this many reveals was contested: its layer gets more rock. */
export const CONTESTED_REVEALS = 10;
export const CONTESTED_ROCK = 0.03;

// New blocks, level by level: each level from 2 to 5 brings one, then
// every level has more of each, as the climb in Doodle Jump gets harder.
/** Hard rock: takes a few hits. From ROCK_LEVEL, a share of blocks growing a step a level to a cap. */
export const ROCK_LEVEL = 2;
export const ROCK_BASE = 0.05;
export const ROCK_STEP = 0.01;
export const ROCK_MAX = 0.12;
/** Steel: can't be dug. From STEEL_LEVEL, the chance a row holds a bar of it, 2 to 4 long. */
export const STEEL_LEVEL = 3;
export const STEEL_BASE = 0.12;
export const STEEL_STEP = 0.03;
export const STEEL_MAX = 0.3;
export const STEEL_BAR_MIN = 2;
export const STEEL_BAR_MAX = 4;
/** Loose stone: falls the moment nothing holds it, without a wobble. A share of blocks. */
export const STONE_LEVEL = 4;
export const STONE_BASE = 0.03;
export const STONE_STEP = 0.006;
export const STONE_MAX = 0.07;
/** Bomb: dug, it blasts the 3x3 around it once its fuse burns down. The chance a row holds one. */
export const BOMB_LEVEL = 5;
export const BOMB_BASE = 0.06;
export const BOMB_STEP = 0.015;
export const BOMB_MAX = 0.15;
/** The fuse, in ticks: on the bombs' first level, shorter a level after, to a least. */
export const FUSE_TICKS = 90;
export const FUSE_STEP = 5;
export const MIN_FUSE_TICKS = 60;
/** A bomb caught in another's blast goes off this soon after. */
export const CHAIN_FUSE_TICKS = 12;

// The bot
export const WALK_TICKS = 8;
/** A hop up onto steel walked into, one row up and over. */
export const CLIMB_TICKS = 12;
export const BOT_FALL_TICKS = 4;
export const DRILL_TICKS = 10;
/** A press while the bot is busy is kept this long, then used when it's free. */
export const BUFFER_TICKS = 12;
export const LIVES = 3;
export const DEATH_TICKS = 90;
export const SHIELD_TICKS = 90;

// Blocks
export const WOBBLE_TICKS = 50;
export const MIN_WOBBLE_TICKS = 25;
/** Ticks per row for falling blocks. */
export const FALL_TICKS = 5;
export const POP_TICKS = 18;
/** Same-colour blocks that pop together after a fall. */
export const POP_SIZE = 4;
/** Hits a hard rock takes at difficulty 1. */
export const ROCK_HITS = 3;

// Difficulty, in thousandths: it rises a step every level, to a cap.
// Loose blocks wobble shorter, and hard rock takes more hits.
export const D_ONE = 1000;
export const D_STEP = 125;
export const D_MAX = 3000;

// The halving
/** Layers between halvings of the nonce reward. */
export const HALVING_LAYERS = 4;

// Score, in sats
/** Paid for a layer's nonce, halving like Bitcoin's subsidy, times the chain. */
export const BLOCK_REWARD = 50_000;
/** The most a chain of mined blocks multiplies the reward. */
export const MAX_CHAIN = 8;
/**
 * A fee picked up at layer 1, growing by FEE_GROWTH percent a layer while the
 * subsidy halves: deep down, fees are most of the reward, as in Bitcoin.
 */
export const FEE_SATS = 4000;
export const FEE_GROWTH = 15;
/** Small change for digging and combos; mining is where the sats are. */
export const DRILL_SATS = 1;
export const POP_SATS = 10;
