import type { Input } from '../render/input';
import { DOWN, LEFT, RIGHT, UP } from '../sim/game';

const DIRS = LEFT | RIGHT | UP | DOWN;
const BY_NAME: Record<string, number> = { left: LEFT, right: RIGHT, up: UP, down: DOWN };

/** The on-screen controls: a d-pad a thumb can slide across, and a pause button. */
export function touchControls(input: Input, onPause: () => void): void {
  const dpad = document.getElementById('dpad')!;
  const keys = [...dpad.querySelectorAll<HTMLElement>('[data-dir]')];
  hold(
    dpad,
    DIRS,
    (e) => {
      const r = dpad.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      // A small dead zone in the middle; otherwise the stronger axis wins.
      if (Math.hypot(dx, dy) < r.width * 0.12) return 0;
      return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? LEFT : RIGHT) : dy < 0 ? UP : DOWN;
    },
    (bits) => keys.forEach((k) => k.classList.toggle('on', BY_NAME[k.dataset.dir!] === bits)),
  );
  document.getElementById('pause')!.addEventListener('click', onPause);

  function hold(el: HTMLElement, group: number, bitsAt: (e: PointerEvent) => number, show: (bits: number) => void): void {
    let pointer: number | null = null;
    const set = (bits: number) => {
      input.touch(group, bits);
      show(bits);
    };
    el.addEventListener('pointerdown', (e) => {
      if (pointer !== null) return;
      e.preventDefault();
      pointer = e.pointerId;
      el.setPointerCapture(e.pointerId);
      set(bitsAt(e));
      navigator.vibrate?.(8);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId === pointer) set(bitsAt(e));
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      set(0);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
