/**
 * A run's inputs, one mask per tick, run-length encoded as base-36
 * `mask.count` pairs joined by commas. With the mine, this is the whole run.
 */
export class InputLog {
  private runs: [mask: number, count: number][] = [];
  ticks = 0;

  push(mask: number): void {
    const last = this.runs[this.runs.length - 1];
    if (last && last[0] === mask) last[1]++;
    else this.runs.push([mask, 1]);
    this.ticks++;
  }

  encode(): string {
    return this.runs.map(([m, n]) => `${m.toString(36)}.${n.toString(36)}`).join(',');
  }

  static decode(s: string): Uint8Array {
    const runs = s ? s.split(',').map((r) => r.split('.').map((v) => parseInt(v, 36)) as [number, number]) : [];
    if (runs.some(([m, n]) => !(m >= 0 && m < 32 && n > 0))) throw new Error('bad input log');
    const out = new Uint8Array(runs.reduce((sum, [, n]) => sum + n, 0));
    let i = 0;
    for (const [m, n] of runs) out.fill(m, i, (i += n));
    return out;
  }
}
