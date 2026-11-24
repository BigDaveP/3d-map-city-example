/** Instrumentation commune aux deux modes. Échantillons bruts conservés pendant une phase de banc. */

class Ring {
  private buf: Float64Array;
  private i = 0;
  n = 0;
  constructor(size: number) {
    this.buf = new Float64Array(size);
  }
  push(v: number) {
    this.buf[this.i] = v;
    this.i = (this.i + 1) % this.buf.length;
    if (this.n < this.buf.length) this.n++;
  }
  values(): number[] {
    return Array.from(this.buf.subarray(0, this.n));
  }
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

export interface MetricsSnapshot {
  fps: number;
  frameP50: number;
  frameP95: number;
  workP50: number;
  workP95: number;
  capturesPerFrame: number;
  captureMs: number;
  captureTotal: number;
  queue: number;
  latP50: number;
  latP95: number;
  latSamples: number;
  gpuMB: number;
  heapMB: number;
  domNodes: number;
  mounted: number;
}

interface Phase {
  name: string;
  t0: number;
  frames: number[];
  work: number[];
  captures: number[];
  captureMs: number[];
  latency: number[];
  queue: number[];
  gpuMax: number;
  heapMax: number;
  domMax: number;
  mountedMax: number;
}

export class Metrics {
  private frames = new Ring(240);
  private work = new Ring(240);
  private capFrames = new Ring(120);
  private capMs = new Ring(300);
  private lat = new Ring(600);
  private lastFrame = 0;
  captureTotal = 0;
  queue = 0;
  gpuBytes = 0;
  mounted = 0;
  private domNodes = 0;
  private domSampledAt = 0;
  private phase?: Phase;
  private frameCaptures = 0;
  private pending = 0;

  /** Travail JS accumulé hors d'une boucle maîtrisée (couches MapLibre, handler paint). */
  addWork(ms: number) {
    this.pending += ms;
  }
  pendingWork() {
    const p = this.pending;
    this.pending = 0;
    return p;
  }

  /** Début de frame (rAF). */
  frameStart(now: number) {
    if (this.lastFrame) {
      const dt = now - this.lastFrame;
      // on ignore les trous (onglet masqué, point d'arrêt)
      if (dt < 1000) {
        this.frames.push(dt);
        this.phase?.frames.push(dt);
      }
    }
    this.lastFrame = now;
    if (now - this.domSampledAt > 1000) {
      this.domSampledAt = now;
      this.domNodes = document.getElementsByTagName("*").length;
    }
  }

  /** Fin de frame : temps de travail JS mesuré par le mode de rendu. */
  frameEnd(workMs: number) {
    this.work.push(workMs);
    this.capFrames.push(this.frameCaptures);
    if (this.phase) {
      this.phase.work.push(workMs);
      this.phase.captures.push(this.frameCaptures);
      this.phase.queue.push(this.queue);
      this.phase.gpuMax = Math.max(this.phase.gpuMax, this.gpuBytes);
      this.phase.heapMax = Math.max(this.phase.heapMax, heap());
      this.phase.domMax = Math.max(this.phase.domMax, this.domNodes);
      this.phase.mountedMax = Math.max(this.phase.mountedMax, this.mounted);
    }
    this.frameCaptures = 0;
  }

  capture(ms: number) {
    this.frameCaptures++;
    this.captureTotal++;
    this.capMs.push(ms);
    this.phase?.captureMs.push(ms);
  }

  latency(ms: number) {
    this.lat.push(ms);
    this.phase?.latency.push(ms);
  }

  snapshot(): MetricsSnapshot {
    const f = this.frames.values();
    const w = this.work.values();
    const l = this.lat.values();
    const fm = mean(f);
    return {
      fps: fm ? 1000 / fm : 0,
      frameP50: percentile(f, 50),
      frameP95: percentile(f, 95),
      workP50: percentile(w, 50),
      workP95: percentile(w, 95),
      capturesPerFrame: mean(this.capFrames.values()),
      captureMs: mean(this.capMs.values()),
      captureTotal: this.captureTotal,
      queue: this.queue,
      latP50: percentile(l, 50),
      latP95: percentile(l, 95),
      latSamples: l.length,
      gpuMB: this.gpuBytes / 1048576,
      heapMB: heap() / 1048576,
      domNodes: this.domNodes,
      mounted: this.mounted,
    };
  }

  beginPhase(name: string) {
    this.phase = { name, t0: performance.now(), frames: [], work: [], captures: [], captureMs: [], latency: [], queue: [], gpuMax: 0, heapMax: 0, domMax: 0, mountedMax: 0 };
  }

  endPhase() {
    const p = this.phase;
    this.phase = undefined;
    if (!p) return null;
    const fm = mean(p.frames);
    return {
      phase: p.name,
      durationMs: performance.now() - p.t0,
      frames: p.frames.length,
      fps: fm ? 1000 / fm : 0,
      frameP50: percentile(p.frames, 50),
      frameP95: percentile(p.frames, 95),
      workP50: percentile(p.work, 50),
      workP95: percentile(p.work, 95),
      capturesTotal: p.captureMs.length,
      capturesPerFrame: mean(p.captures),
      captureMsAvg: mean(p.captureMs),
      queueMax: Math.max(0, ...p.queue),
      latP50: percentile(p.latency, 50),
      latP95: percentile(p.latency, 95),
      latSamples: p.latency.length,
      gpuMB: p.gpuMax / 1048576,
      heapMB: p.heapMax / 1048576,
      domNodes: p.domMax,
      mounted: p.mountedMax,
    };
  }
}

function heap(): number {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? m.usedJSHeapSize : 0;
}

export type PhaseSummary = NonNullable<ReturnType<Metrics["endPhase"]>>;
