import { DOWN, JUMP, LEFT, RIGHT, UP } from '../sim/game';

const KEYS: Record<string, number> = {
  ArrowLeft: LEFT,
  KeyA: LEFT,
  ArrowRight: RIGHT,
  KeyD: RIGHT,
  ArrowUp: UP,
  KeyW: UP,
  ArrowDown: DOWN,
  KeyS: DOWN,
  Space: JUMP,
  KeyZ: JUMP,
  KeyX: JUMP,
};

/**
 * Turns keys into one input mask per tick. A key pressed and released between
 * two ticks still counts for the next one, so quick taps are never lost.
 */
export class Input {
  private held = 0;
  private tapped = 0;
  private codes = new Map<string, number>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      const bit = KEYS[e.code];
      if (!bit || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      this.codes.set(e.code, bit);
      this.held |= bit;
      this.tapped |= bit;
    });
    target.addEventListener('keyup', (e) => {
      if (!this.codes.delete(e.code)) return;
      this.held = 0;
      for (const bit of this.codes.values()) this.held |= bit;
    });
    target.addEventListener('blur', () => this.reset());
  }

  /** This tick's mask. */
  sample(): number {
    const mask = this.held | this.tapped;
    this.tapped = 0;
    return mask;
  }

  reset(): void {
    this.codes.clear();
    this.held = 0;
    this.tapped = 0;
  }
}
