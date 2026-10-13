import type { Game, GameEvent } from '../sim/game';
import { icon } from '../render/sprites';
import { BOMB_LEVEL, ROCK_LEVEL, STEEL_LEVEL, STONE_LEVEL } from '../sim/rules';

const $ = (id: string) => document.getElementById(id)!;
/** On a touch screen, say tap, not press. */
export const isTouch = () => document.body.classList.contains('touch');
const sats = (n: number) => n.toLocaleString('en-US');

/** What levels 2 to 5 each bring: the block, its name and how it works, announced as the level starts. */
const NEW_BLOCKS: Record<number, [sprite: Parameters<typeof icon>[0], name: string, rule: string]> = {
  [ROCK_LEVEL]: ['rock', 'HARD ROCK', 'TAKES A FEW HITS TO BREAK'],
  [STEEL_LEVEL]: ['steel', 'STEEL', "CAN'T BE DUG: WALK INTO IT<br>TO CLIMB IT, OR GO AROUND"],
  [STONE_LEVEL]: ['stone', 'LOOSE STONE', 'DROPS THE MOMENT NOTHING<br>HOLDS IT, WITH NO WARNING'],
  [BOMB_LEVEL]: ['bomb', 'BOMB', 'DIG IT AND RUN: IT BLASTS<br>ALL AROUND IT, STEEL TOO'],
};

/** The side panel, the banners and the overlay. */
export class Hud {
  private shown = '';

  update(game: Game): void {
    const goal = this.goal(game);
    const state = [goal, game.layer, game.depth, game.sats, game.lives, game.chain, game.pending, game.difficulty, game.mined, game.missed].join();
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
    $('depth').textContent = `${game.depth} m`;
    $('sats').textContent = sats(game.sats);
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
        const fresh = NEW_BLOCKS[e.layer];
        if (fresh) this.toast(`<b>NEW:</b> ${icon(fresh[0], '')} ${fresh[1]}<br>${fresh[2]}`, 'new');
        if (e.halving) this.toast('<b>HALVING!</b><br>THE BLOCK REWARD HALVED');
      } else if (e.type === 'die') {
        this.toast(e.cause === 'blast' ? 'BLOWN UP' : 'CRUSHED');
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

  /**
   * A banner that fades by itself. A `long` one stays up for reading a hint,
   * and a `new` one, for a new kind of block, longer still.
   */
  toast(html: string, kind: boolean | 'new' = false): void {
    const el = document.createElement('div');
    el.className = kind === 'new' ? 'toast new' : kind ? 'toast long' : 'toast';
    el.innerHTML = html;
    el.addEventListener('animationend', () => el.remove());
    const banner = $('banner');
    banner.append(el);
    // At most three at once: the oldest go first. The tutorial's coach stays.
    const toasts = banner.querySelectorAll('.toast');
    for (let i = 0; i < toasts.length - 3; i++) toasts[i]!.remove();
  }

  overlay(html: string | null): void {
    const el = $('overlay');
    el.hidden = html === null;
    el.innerHTML = html ?? '';
  }

  /** The last screen of a run; `more` goes under the score, such as the leaderboard. */
  gameOver(game: Game, more = ''): void {
    this.overlay(
      `<h2>GAME OVER</h2><p><span class="coin">${sats(game.sats)} SATS</span><br>${game.mined} OF ${game.mined + game.missed} LEVELS MINED<br>LONGEST CHAIN ${game.maxChain} · ${game.depth} m</p>${more}<p>${isTouch() ? 'TAP TO PLAY AGAIN' : 'PRESS ENTER TO PLAY AGAIN'}</p>`,
    );
  }
}
