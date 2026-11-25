/**
 * Boucle de frame unique : avance la caméra, applique le lot de données (un seul rendu React),
 * puis appelle le mode de rendu actif. Le temps de travail JS d'une frame = rAF + commit React
 * (microtâche) + éventuel handler `paint` du canvas.
 */
import type { Camera } from "../camera";
import type { Metrics } from "../hic3d/metrics";
import type { DataStore } from "../store";

export type FrameFn = (now: number) => void;

export class FrameLoop {
  private fns = new Set<FrameFn>();
  private raf = 0;
  private work = 0;
  frame = 0;
  constructor(private ds: DataStore, private camera: Camera, private metrics: Metrics) {}

  add(fn: FrameFn) {
    this.fns.add(fn);
    return () => {
      this.fns.delete(fn);
    };
  }

  /** Travail effectué hors du rAF (handler `paint`). */
  addWork(ms: number) {
    this.work += ms;
  }

  start() {
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      if (this.frame > 0) this.metrics.frameEnd(this.work);
      this.work = 0;
      this.frame++;
      const t0 = performance.now();
      this.metrics.frameStart(now);
      this.camera.step(now);
      this.ds.flush();
      for (const fn of this.fns) fn(now);
      const t1 = performance.now();
      this.work += t1 - t0;
      // le commit React déclenché par flush() s'exécute en microtâche avant le rendu :
      // cette microtâche, mise en file après, mesure sa durée.
      queueMicrotask(() => (this.work += performance.now() - t1));
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }
}
