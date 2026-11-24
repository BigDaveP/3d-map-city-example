/**
 * Caméra 2D : (x, y) = point du monde au centre de la vue, zoom = px CSS par unité monde.
 * Hors React : modifiée à chaque frame sans provoquer de rendu.
 */
import { ZOOM_MAX, ZOOM_MIN, type Rect } from "@/lib/world";

export interface CamState {
  x: number;
  y: number;
  zoom: number;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Camera {
  x = 0;
  y = 0;
  zoom = 0.1;
  vw = 1;
  vh = 1;
  version = 0;
  private anim?: { from: CamState; to: CamState; t0: number; dur: number; resolve: () => void };

  setViewport(w: number, h: number) {
    if (w !== this.vw || h !== this.vh) {
      this.vw = Math.max(1, w);
      this.vh = Math.max(1, h);
      this.version++;
    }
  }

  set(c: Partial<CamState>) {
    if (c.x !== undefined) this.x = c.x;
    if (c.y !== undefined) this.y = c.y;
    if (c.zoom !== undefined) this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.zoom));
    this.version++;
  }

  /** Rectangle du monde visible. */
  view(margin = 0): Rect {
    const w = this.vw / this.zoom;
    const h = this.vh / this.zoom;
    return { x: this.x - w / 2 - margin * w, y: this.y - h / 2 - margin * h, w: w * (1 + 2 * margin), h: h * (1 + 2 * margin) };
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.x) * this.zoom + this.vw / 2, (wy - this.y) * this.zoom + this.vh / 2];
  }
  screenToWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.vw / 2) / this.zoom + this.x, (sy - this.vh / 2) / this.zoom + this.y];
  }

  pan(dxScreen: number, dyScreen: number) {
    this.cancel();
    this.set({ x: this.x - dxScreen / this.zoom, y: this.y - dyScreen / this.zoom });
  }

  /** Zoom autour d'un point écran (le point du monde sous le curseur ne bouge pas). */
  zoomAt(sx: number, sy: number, factor: number) {
    this.cancel();
    const [wx, wy] = this.screenToWorld(sx, sy);
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.zoom * factor));
    this.set({ zoom, x: wx - (sx - this.vw / 2) / zoom, y: wy - (sy - this.vh / 2) / zoom });
  }

  fit(r: Rect, pad = 0.04): CamState {
    const zoom = Math.min(this.vw / (r.w * (1 + 2 * pad)), this.vh / (r.h * (1 + 2 * pad)));
    return { x: r.x + r.w / 2, y: r.y + r.h / 2, zoom };
  }

  flyTo(to: Partial<CamState>, dur = 600): Promise<void> {
    this.cancel();
    const target: CamState = { x: to.x ?? this.x, y: to.y ?? this.y, zoom: to.zoom ?? this.zoom };
    if (dur <= 0) {
      this.set(target);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.anim = { from: { x: this.x, y: this.y, zoom: this.zoom }, to: target, t0: performance.now(), dur, resolve };
    });
  }

  cancel() {
    if (this.anim) {
      const r = this.anim.resolve;
      this.anim = undefined;
      r();
    }
  }

  get animating() {
    return !!this.anim;
  }

  /** Avance l'animation ; à appeler une fois par frame. */
  step(now: number) {
    const a = this.anim;
    if (!a) return;
    const t = Math.min(1, (now - a.t0) / a.dur);
    const k = ease(t);
    // interpolation logarithmique du zoom : vitesse perçue constante
    const zoom = Math.exp(Math.log(a.from.zoom) + (Math.log(a.to.zoom) - Math.log(a.from.zoom)) * k);
    this.set({ x: a.from.x + (a.to.x - a.from.x) * k, y: a.from.y + (a.to.y - a.from.y) * k, zoom });
    if (t >= 1) {
      this.anim = undefined;
      a.resolve();
    }
  }
}
