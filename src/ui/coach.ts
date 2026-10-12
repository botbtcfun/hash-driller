import { LESSONS, type Lesson } from '../sim/tutorial';
import { isTouch } from './hud';

/** What the coach says in each lesson. */
function say(lesson: Lesson): string {
  switch (lesson) {
    case 'dig':
      return isTouch() ? '<kbd>↓</kbd> on the d-pad digs down.<br>Dig through the blocks under you.' : '<kbd>↓</kbd> digs down.<br>Dig through the blocks under you.';
    case 'cell':
      return 'Your power drains as you go.<br><kbd>→</kbd> digs sideways: get the <b>⚡</b> cell.';
    case 'fee':
      return 'Orange coins are fees: the <b>#</b> pays them out.<br>Go <kbd>←</kbd> and grab the coin.';
    case 'loose':
      return '<em>LOOK OUT!</em> A red <em>!</em> means the block<br>above you came loose. Dig it with <kbd>↑</kbd>!';
    case 'level':
      return 'Phew. Now <kbd>↓</kbd> dig down,<br>through the <b>LEVEL 1</b> line.';
    case 'nonce':
      return "There's level 1's golden <b>#</b>. Every level has one:<br>touch it to mine the level. Go <kbd>→</kbd>!";
    default:
      return 'Mined! The <b>#</b> paid the level<br>and the fee you picked up.';
  }
}

/**
 * The coach's card over the top of the shaft, during the tutorial: what to
 * do now, with the key to press pulsing while the mine waits for it.
 */
export class Coach {
  private el: HTMLElement | null = null;
  private lesson: Lesson | null = null;

  constructor(private readonly onSkip: () => void) {}

  show(lesson: Lesson | null, waiting: boolean): void {
    if (!lesson || lesson === 'done') {
      this.el?.remove();
      this.el = null;
      this.lesson = null;
      return;
    }
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'coach';
      this.el.addEventListener('click', (e) => {
        if ((e.target as Element).closest('.skip')) this.onSkip();
      });
      document.getElementById('banner')!.prepend(this.el);
    }
    this.el.classList.toggle('waiting', waiting);
    if (lesson === this.lesson) return;
    this.lesson = lesson;
    const n = LESSONS.indexOf(lesson) + 1;
    this.el.innerHTML = `<p class="coach-top"><span>${n ? `TUTORIAL ${n}/${LESSONS.length}` : 'TUTORIAL'}</span><button class="skip" type="button">SKIP ›</button></p><p>${say(lesson)}</p>`;
    // Each new lesson slides in again.
    this.el.classList.remove('new');
    void this.el.offsetWidth;
    this.el.classList.add('new');
  }
}
