import type { Game, GameEvent } from '../sim/game';
import { POWER_MAX } from '../sim/rules';

const $ = (id: string) => document.getElementById(id)!;
/** On a touch screen, say tap, not press. */
export const isTouch = () => document.body.classList.contains('touch');
const sats = (n: number) => n.toLocaleString('en-US');

/** The side panel, the banners and the overlay. */
export class Hud {
  private shown = '';

  update(game: Game): void {
    const power = Math.ceil((game.power * 100) / POWER_MAX);
    const goal = this.goal(game);
    const state = [goal, game.layer, game.depth, game.sats, power, game.lives, game.chain, game.pending, game.difficulty, game.mined, game.missed].join();
    if (state === this.shown) return;
    this.shown = state;
    $('goal').innerHTML = goal;
    $('level').textContent = game.layer ? `${game.layer}` : '-';
    // The strip, on touch screens.
    $('s-sats').textContent = sats(game.sats);
    $('s-fees').textContent = game.pending ? `+${sats(game.pending)} IN FEES` : 'NO FEES YET';
    $('s-level').textContent = `LEVEL ${game.layer || '-'}`;
    $('s-chain').textContent = game.chain ? `CHAIN ×${game.chain}` : 'NO CHAIN';
    const lives = $('s-lives');
    if (lives.childElementCount !== Math.max(0, game.lives)) lives.replaceChildren(...Array.from({ length: Math.max(0, game.lives) }, () => document.createElement('i')));
    const strip = $('s-power');
    strip.style.width = `${power}%`;
    strip.classList.toggle('low', power <= 25);
    $('depth').textContent = `${game.depth} m`;
    $('sats').textContent = sats(game.sats);
    const bar = $('power');
    bar.style.width = `${power}%`;
    bar.classList.toggle('low', power <= 25);
    $('lives').textContent = `${Math.max(0, game.lives)}`;
    $('chain').textContent = game.chain ? `×${game.chain}` : '-';
    $('fees').textContent = sats(game.pending);
    $('next').textContent = sats(game.nonceReward);
    $('diff').textContent = (game.difficulty / 1000).toFixed(2);
    $('mined').textContent = `${game.mined}/${game.mined + game.missed}`;
  }

  events(events: GameEvent[], game: Game): void {
    for (const e of events) {
      if (e.type === 'nonce') {
        const parts = `${sats(e.subsidy)}${e.fees ? ` + ${sats(e.fees)} FEES` : ''}${e.chain > 1 ? ` ×${e.chain}` : ''}`;
        this.toast(`LEVEL ${e.layer} MINED!<br><b>+${sats(e.reward)} SATS</b><br>${parts}`);
      } else if (e.type === 'missed') {
        const lost = [e.fees ? `${sats(e.fees)} IN FEES LOST` : '', e.chain ? `CHAIN ×${e.chain} BROKEN` : ''].filter(Boolean).join('<br>');
        this.toast(`LEVEL ${e.layer} MISSED${lost ? `<br>${lost}` : ''}`);
      } else if (e.type === 'layer') {
        this.toast(`LEVEL ${e.layer}<br>FIND ITS GOLDEN <b>#</b>`);
        if (e.halving) this.toast('<b>HALVING!</b><br>REWARD AND POWER CELLS HALVED');
      } else if (e.type === 'die') {
        this.toast(e.cause === 'power' ? 'POWER OUT' : 'CRUSHED');
      }
    }
  }

  /** The one thing to do now, with how far the nonce is. */
  private goal(game: Game): string {
    const n = game.nonce();
    let where = '';
    if (n) {
      const dy = n[1] - game.bot.y;
      const dx = n[0] - game.bot.x;
      where = dy > 0 ? ` ↓ ${dy} m` : dy < 0 ? ` ↑ ${-dy} m` : dx ? ` ${dx < 0 ? '←' : '→'} ${Math.abs(dx)}` : '';
    }
    const level = Math.max(1, game.layer);
    if (game.layer >= 1 && game.blockMined) return `<span class="done">LEVEL ${level} MINED ✓</span><br>Grab fees, dig on to LEVEL ${level + 1}`;
    return `GOAL: grab the golden <b>#</b> on LEVEL ${level}${where && ` <b>${where}</b>`} · it pays <b>${sats(game.nonceReward)}</b>`;
  }

  /** The sound buttons, in the panel and among the touch controls. */
  sound(on: boolean): void {
    $('sound').textContent = on ? 'SOUND ON' : 'SOUND OFF';
    for (const id of ['sound', 'sound-pad']) $(id).setAttribute('aria-pressed', String(on));
  }

  /** A banner that fades by itself; `long` keeps it up for reading a hint. */
  toast(html: string, long = false): void {
    const el = document.createElement('div');
    el.className = long ? 'toast long' : 'toast';
    el.innerHTML = html;
    el.addEventListener('animationend', () => el.remove());
    const banner = $('banner');
    banner.append(el);
    // At most three at once: the oldest go first.
    while (banner.children.length > 3) banner.firstElementChild!.remove();
  }

  overlay(html: string | null): void {
    const el = $('overlay');
    el.hidden = html === null;
    el.innerHTML = html ?? '';
  }

  gameOver(game: Game): void {
    this.overlay(
      `<h2>GAME OVER</h2><p><span class="coin">${sats(game.sats)} SATS</span><br>${game.mined} OF ${game.mined + game.missed} LEVELS MINED<br>LONGEST CHAIN ${game.maxChain} · ${game.depth} m</p><p>${isTouch() ? 'TAP TO PLAY AGAIN' : 'PRESS R OR TAP'}</p>`,
    );
  }
}
