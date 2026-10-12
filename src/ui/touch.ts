import type { Input } from '../render/input';
import { DOWN, LEFT, RIGHT, UP } from '../sim/game';

const DIRS = LEFT | RIGHT | UP | DOWN;
const BY_NAME: Record<string, number> = { left: LEFT, right: RIGHT, up: UP, down: DOWN };
/** How long a thumb holds the d-pad's centre to pick it up, and how far it may wander meanwhile. */
const LIFT_MS = 500;
const SLOP_PX = 10;
/** Room kept between the d-pad and the buttons. */
const GAP_PX = 8;
/** A control this close to the floor rests on it: the playfield shows nothing under it. */
const REST_PX = 64;
const PLACE_KEY = 'hash-driller:pad:';

/** A box in CSS pixels from the top left of the screen. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where the d-pad sits: in one of the room's areas, and how far across and down it, from 0 to 1. */
export interface Place {
  area: number;
  x: number;
  y: number;
}

/** Where the controls may go on this screen, worked out by the layout. */
export interface Room {
  /** Portrait and landscape each remember their own place for the d-pad. */
  key: string;
  /** The d-pad goes anywhere inside one of these. */
  areas: Box[];
  /** Where it goes until it's moved. */
  home: Place;
  /** Bottom corners for the pause and sound buttons, best first: they take the first the d-pad leaves clear. */
  corners: { x: number; y: number; side: 'left' | 'right' }[];
  /** The line the controls rest on, clear of the browser's bar. */
  floor: number;
}

/**
 * The on-screen controls: a d-pad a thumb can slide across, and pause and
 * sound buttons. Hold the d-pad's centre and it lifts, to be dragged anywhere
 * the room allows. It stays where it's dropped, also next visit, and the
 * buttons move to whichever corner it leaves clear.
 */
export class TouchControls {
  private readonly layer = document.getElementById('pad')!;
  private readonly dpad = document.getElementById('dpad')!;
  private readonly buttons = this.layer.querySelector<HTMLElement>('.actions')!;
  private readonly keys = [...this.dpad.querySelectorAll<HTMLElement>('[data-dir]')];
  private room: Room | null = null;
  private place: Place | null = null;
  private dpadBox: Box | null = null;
  private buttonsBox: Box | null = null;

  /** onMove: the controls moved, so what they cover changed. */
  constructor(
    private readonly input: Input,
    onPause: () => void,
    private readonly onMove: () => void,
  ) {
    document.getElementById('pause')!.addEventListener('click', onPause);
    this.listen();
  }

  /** Lays the controls out for the screen: the d-pad where it was left in this orientation. */
  arrange(room: Room): void {
    if (!this.place || this.room?.key !== room.key) this.place = this.load(room) ?? room.home;
    this.room = room;
    this.apply();
    // Buttons glide out of the d-pad's way, once they have a place to glide from.
    requestAnimationFrame(() => this.layer.classList.add('settled'));
  }

  /** The top of the highest control resting on the floor: the playfield shows nothing under it. */
  reach(): number {
    const floor = this.room?.floor ?? window.innerHeight;
    const resting = [this.dpadBox, this.buttonsBox].filter((b): b is Box => !!b && floor - b.bottom < REST_PX);
    return Math.min(floor, ...resting.map((b) => b.top));
  }

  private listen(): void {
    const dpad = this.dpad;
    let pointer: number | null = null;
    let hold = 0;
    let lifted = false;
    let from = [0, 0];
    let grab = [0, 0];

    const set = (bits: number) => {
      this.input.touch(DIRS, bits);
      this.keys.forEach((k) => k.classList.toggle('on', BY_NAME[k.dataset.dir!] === bits));
    };
    const stopHolding = () => {
      clearTimeout(hold);
      hold = 0;
      dpad.classList.remove('holding');
    };
    const lift = () => {
      stopHolding();
      lifted = true;
      set(0);
      dpad.classList.add('lifted');
      // The d-pad keeps the spot under the thumb where it was picked up.
      const b = this.dpadBox!;
      grab = [from[0]! - (b.left + b.right) / 2, from[1]! - (b.top + b.bottom) / 2];
      navigator.vibrate?.(20);
    };

    dpad.addEventListener('pointerdown', (e) => {
      if (pointer !== null) return;
      e.preventDefault();
      pointer = e.pointerId;
      dpad.setPointerCapture(e.pointerId);
      const bits = this.bitsAt(e);
      set(bits);
      navigator.vibrate?.(8);
      // Pressed in the centre: held still there, it lifts.
      if (!bits) {
        from = [e.clientX, e.clientY];
        dpad.classList.add('holding');
        hold = window.setTimeout(lift, LIFT_MS);
      }
    });
    dpad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointer) return;
      if (lifted) {
        this.place = this.nearest(e.clientX - grab[0]!, e.clientY - grab[1]!);
        this.apply();
        this.onMove();
        return;
      }
      const bits = this.bitsAt(e);
      if (hold && (bits || Math.hypot(e.clientX - from[0]!, e.clientY - from[1]!) > SLOP_PX)) stopHolding();
      set(bits);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      stopHolding();
      if (lifted) {
        lifted = false;
        dpad.classList.remove('lifted');
        this.save();
      }
      set(0);
    };
    dpad.addEventListener('pointerup', end);
    dpad.addEventListener('pointercancel', end);
    dpad.addEventListener('lostpointercapture', end);
    dpad.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** The direction under a thumb: the centre square is none, otherwise the stronger axis wins. */
  private bitsAt(e: PointerEvent): number {
    const r = this.dpad.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.max(Math.abs(dx), Math.abs(dy)) < r.width / 6) return 0;
    return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? LEFT : RIGHT) : dy < 0 ? UP : DOWN;
  }

  /** Puts the d-pad at its place, and the buttons in the first corner it leaves clear. */
  private apply(): void {
    const room = this.room!;
    const { area, x, y } = this.place!;
    const a = room.areas[area]!;
    const w = this.dpad.offsetWidth;
    const h = this.dpad.offsetHeight;
    const left = a.left + (a.right - a.left - w) * x;
    const top = a.top + (a.bottom - a.top - h) * y;
    const dpad = { left, top, right: left + w, bottom: top + h };
    this.dpadBox = dpad;
    this.put(this.dpad, dpad);

    const bw = this.buttons.offsetWidth;
    const bh = this.buttons.offsetHeight;
    const spots = room.corners.map(({ x: cx, y: cy, side }) => {
      const l = side === 'right' ? cx - bw : cx;
      return { left: l, top: cy - bh, right: l + bw, bottom: cy };
    });
    const clash = (s: Box) => overlap(s, { left: dpad.left - GAP_PX, top: dpad.top - GAP_PX, right: dpad.right + GAP_PX, bottom: dpad.bottom + GAP_PX });
    const spot = spots.find((s) => clash(s) === 0) ?? spots.reduce((best, s) => (clash(s) < clash(best) ? s : best));
    this.buttonsBox = spot;
    this.put(this.buttons, spot);
  }

  /** The place in the room nearest to having the d-pad's centre at (cx, cy). */
  private nearest(cx: number, cy: number): Place {
    const w = this.dpad.offsetWidth;
    const h = this.dpad.offsetHeight;
    let best = this.place!;
    let far = Infinity;
    this.room!.areas.forEach((a, area) => {
      const spanX = a.right - a.left - w;
      const spanY = a.bottom - a.top - h;
      // The first area always takes it; the others only if it fits.
      if (area > 0 && (spanX < 0 || spanY < 0)) return;
      const x = spanX > 0 ? clamp01((cx - w / 2 - a.left) / spanX) : 0.5;
      const y = spanY > 0 ? clamp01((cy - h / 2 - a.top) / spanY) : 1;
      const d = Math.hypot(a.left + spanX * x + w / 2 - cx, a.top + spanY * y + h / 2 - cy);
      if (d < far) {
        far = d;
        best = { area, x, y };
      }
    });
    return best;
  }

  private put(el: HTMLElement, box: Box): void {
    const origin = this.layer.getBoundingClientRect();
    el.style.left = `${Math.round(box.left - origin.left)}px`;
    el.style.top = `${Math.round(box.top - origin.top)}px`;
  }

  private load(room: Room): Place | null {
    try {
      const p = JSON.parse(localStorage.getItem(PLACE_KEY + room.key) ?? 'null') as Place | null;
      const ok = (v: unknown) => typeof v === 'number' && v >= 0 && v <= 1;
      if (p && Number.isInteger(p.area) && room.areas[p.area] && ok(p.x) && ok(p.y)) return p;
    } catch {
      // Unreadable or blocked storage: the d-pad starts at home.
    }
    return null;
  }

  private save(): void {
    try {
      localStorage.setItem(PLACE_KEY + this.room!.key, JSON.stringify(this.place));
    } catch {
      // Storage can be blocked; the place then lasts for this visit.
    }
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The area two boxes share. */
function overlap(a: Box, b: Box): number {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}
