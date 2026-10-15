import { RULES_VERSION } from '../sim/rules';

/** One run on the board. */
interface Entry {
  initials: string;
  sats: number;
  level: number;
}

/** A day's board as the Worker sends it; after a score, its rank too. */
interface Board {
  runs: number;
  top: Entry[];
  rank?: number;
  sats?: number;
}

const INITIALS_KEY = 'hash-driller:initials';
const OUT_OF_REACH = 'the leaderboard is out of reach';
/**
 * Where the leaderboard is: this site, or the game's own site for a page
 * with no address to call from, as a copy opened from a file or a data: URL.
 */
const API = location.origin.startsWith('http') ? '' : 'https://drill.botbtc.fun';
const sats = (n: number) => n.toLocaleString('en-US');

function lastInitials(): string {
  try {
    return localStorage.getItem(INITIALS_KEY) ?? '';
  } catch {
    return '';
  }
}

async function call(path: string, init?: RequestInit): Promise<Board> {
  let res: Response;
  try {
    res = await fetch(API + path, init);
  } catch {
    // Offline or blocked: the browser's own words for it mean nothing to a player.
    throw new Error(OUT_OF_REACH);
  }
  const body = (await res.json().catch(() => ({}))) as Board & { error?: string };
  if (!res.ok) throw new Error(body.error ?? OUT_OF_REACH);
  return body;
}

/** The board as a list, the player's own entry marked when it's in it. */
function list(board: Board): string {
  if (!board.top.length) return '<p class="board-note">NO RUNS YET TODAY: BE THE FIRST</p>';
  const rows = board.top
    .map((e, i) => `<li${board.rank === i + 1 ? ' class="me"' : ''}><span>${i + 1}</span><b>${e.initials}</b><span>${sats(e.sats)}</span><span>L${e.level}</span></li>`)
    .join('');
  const own = board.rank && board.rank > board.top.length ? `<p class="board-note">YOU: #${board.rank}, ${sats(board.sats ?? 0)} SATS</p>` : '';
  return `<ol class="board">${rows}</ol>${own}<p class="board-note">${board.runs} RUN${board.runs === 1 ? '' : 'S'} TODAY</p>`;
}

/** The form for a run's initials, for the game over screen. */
export function initialsForm(): string {
  return `<form class="initials">
<label for="initials">YOUR INITIALS</label>
<input id="initials" name="initials" maxlength="3" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done" value="${lastInitials()}" />
<button type="submit">SAVE</button>
</form><div id="board-slot"></div>`;
}

/** Shows today's board in the slot under the form, or wherever `slot` is. */
export async function showBoard(day: number, slot = 'board-slot'): Promise<void> {
  const el = document.getElementById(slot);
  if (!el) return;
  el.innerHTML = '<p class="board-note">LOADING THE LEADERBOARD</p>';
  try {
    const board = await call(`/api/board?day=${day}`);
    el.innerHTML = list(board);
  } catch (e) {
    el.innerHTML = `<p class="board-note">${(e as Error).message.toUpperCase()}</p>`;
  }
}

/** Saves a run under the initials in its form, then shows where it ranks. */
export async function submit(form: HTMLFormElement, day: number, inputs: string): Promise<void> {
  const input = form.elements.namedItem('initials') as HTMLInputElement;
  const initials = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (initials.length !== 3) {
    input.focus();
    form.dataset.note = 'THREE LETTERS OR DIGITS';
    return;
  }
  try {
    localStorage.setItem(INITIALS_KEY, initials);
  } catch {
    // Storage can be blocked; the initials are asked for again next time.
  }
  const button = form.querySelector('button')!;
  button.disabled = true;
  button.textContent = 'SAVING';
  try {
    const board = await call('/api/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ day, rules: RULES_VERSION, initials, inputs }),
    });
    form.outerHTML = `<p class="board-rank">YOU'RE <b>#${board.rank}</b> OF ${board.runs} TODAY</p>`;
    const slot = document.getElementById('board-slot');
    if (slot) slot.innerHTML = list(board);
  } catch (e) {
    button.disabled = false;
    button.textContent = 'TRY AGAIN';
    form.dataset.note = (e as Error).message.toUpperCase();
  }
}
