import { isTouch } from './hud';

/** Chrome's and Samsung Internet's install prompt, held back to show from our own button. */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const ua = navigator.userAgent;
/** iPadOS asks for the desktop site, so it says Macintosh, but with touch. */
const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const android = /Android/.test(ua);

const SHARE = '<svg class="icon" viewBox="0 0 10 12" aria-label="Share"><path d="M5 0.5 2.5 3M5 0.5 7.5 3M5 0.5V7.5M3 5H1V11.5H9V5H7" fill="none" stroke="currentColor" /></svg>';

/** Already running from the home screen. */
function standalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** How to add it by hand, where the browser has no prompt for it. */
function steps(): string[] {
  if (!ios) return ["Open your browser's menu <b>⋮</b>.", 'Tap <b>Add to Home screen</b> or <b>Install app</b>.'];
  // Apps' own browsers say neither Safari nor which app; only Safari can add it.
  if (!/Safari\//.test(ua)) return ['Open this page in <b>Safari</b>.', `Tap Share ${SHARE}, then <b>Add to Home Screen</b>.`];
  if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return [`Tap Share ${SHARE}.`, 'Tap <b>Add to Home Screen</b>.', 'Tap <b>Add</b>.'];
  return [`Tap Share ${SHARE} in Safari's bar.<br><span class="dim">No Share button? It's under <b>•••</b>.</span>`, 'Scroll down and tap <b>Add to Home Screen</b>.', 'Tap <b>Add</b>.'];
}

/**
 * Offers to add the game to the home screen, where it opens full screen
 * like an app. Android's browsers can do it from our button; on iOS it
 * takes the share sheet, so the button shows how.
 */
export class Install {
  private prompt: InstallPrompt | null = null;
  private added = false;
  private readonly sheet = document.getElementById('sheet')!;

  constructor() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.prompt = e as InstallPrompt;
    });
    window.addEventListener('appinstalled', () => {
      this.added = true;
      this.prompt = null;
    });
    this.sheet.addEventListener('click', (e) => {
      if (e.target === this.sheet || (e.target as Element).closest('[data-act=close]')) this.sheet.hidden = true;
    });
  }

  /** The button for a screen, on phones and tablets that can add it and haven't. */
  button(): string {
    if (this.added || !isTouch() || standalone() || !(ios || android || this.prompt)) return '';
    return '<button class="install" type="button" data-act="install">+ ADD TO HOME SCREEN</button>';
  }

  async ask(): Promise<void> {
    const prompt = this.prompt;
    if (prompt) {
      // A prompt shows once; after that, the steps by hand.
      this.prompt = null;
      await prompt.prompt();
      if ((await prompt.userChoice).outcome === 'accepted') this.added = true;
      return;
    }
    this.sheet.innerHTML = `<div class="sheet-box">
<h2>ADD TO HOME SCREEN</h2>
<p class="how">Play full screen from your home screen,<br>like an app. A new mine every day.</p>
<ol class="how">${steps()
      .map((s) => `<li>${s}</li>`)
      .join('')}</ol>
<button type="button" data-act="close">GOT IT</button>
</div>`;
    this.sheet.hidden = false;
  }
}
