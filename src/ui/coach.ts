import { icon } from '../render/sprites';
import { LESSONS, type Lesson } from '../sim/tutorial';
import { isTouch } from './hud';

/** What the coach says in each lesson, with the things to look for drawn as in the game. */
function say(lesson: Lesson): string {
  const fee = icon('fee', 'fee coin');
  const nonce = icon('nonce', 'golden #');
  switch (lesson) {
    case 'dig':
      return isTouch() ? '<kbd>↓</kbd> on the d-pad digs down.<br>Dig through the blocks under you.' : '<kbd>↓</kbd> digs down.<br>Dig through the blocks under you.';
    case 'coin':
      return `<kbd>→</kbd> digs sideways. Coins are fees:<br>dig over to the ${fee} and grab it!`;
    case 'fee':
      return `Fees pay out with the level's ${nonce}.<br>Go <kbd>←</kbd> for the other ${fee}!`;
    case 'loose':
      return '<em>LOOK OUT!</em> A red <em>!</em> means the block<br>above you came loose. Dig it with <kbd>↑</kbd>!';
    case 'level':
      return 'Phew. Now <kbd>↓</kbd> dig down,<br>through the <b>LEVEL 1</b> line.';
    case 'nonce':
      return `Every level has one ${nonce}: its goal.<br>Touch it to mine it. Go <kbd>→</kbd>!`;
    default:
      return `Mined! The ${nonce} paid the level<br>and the fee you picked up.`;
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
