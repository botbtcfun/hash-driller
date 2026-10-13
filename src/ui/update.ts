/**
 * Keeps the game current, installed on a home screen above all. A phone
 * keeps the app suspended and resumes it as it was, old version and all; so
 * whenever the game comes back to the front, this looks for a newer build,
 * and switches to it when nothing is lost: at once if no run is on, else
 * as the next one begins. The build is the game's script, named by its
 * hash, that the page hands the loader.
 */
export class Updater {
  private readonly build = document.querySelector('script[data-main]')?.getAttribute('data-main') ?? null;
  private ready = false;

  /** `idle`: whether switching now loses nothing, as on the start screen. */
  constructor(private readonly idle: () => boolean) {
    // In development there is no build to compare, and Vite reloads by itself.
    if (!this.build) return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.check();
    });
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) void this.check();
    });
    // Left open in front for a long time, it looks now and then too.
    setInterval(() => void this.check(), 15 * 60_000);
  }

  /** Looks for a newer build; switches at once if idle, or marks it for the next run. */
  async check(): Promise<void> {
    if (!this.build || this.ready) return;
    try {
      const res = await fetch('/', { cache: 'no-store' });
      const latest = /data-main="([^"]+)"/.exec(await res.text())?.[1];
      if (!latest || latest === this.build) return;
      this.ready = true;
      if (this.idle()) location.reload();
    } catch {
      // Offline: the next look will do.
    }
  }

  /** As a run begins: switches to a newer build if one is waiting. Whether it did. */
  apply(): boolean {
    if (!this.ready) return false;
    location.reload();
    return true;
  }
}
