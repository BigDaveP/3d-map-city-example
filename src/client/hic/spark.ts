/** Construction des sparklines WebGL : segments épaissis en triangles, coordonnées monde. */
import { SPARK_N } from "../live";

const FLOATS_PER_VERTEX = 6; // x, y, r, g, b, a

export class SparkBuilder {
  data = new Float32Array(6 * FLOATS_PER_VERTEX * SPARK_N * 64);
  count = 0; // sommets
  private series = new Float32Array(SPARK_N);

  reset() {
    this.count = 0;
  }

  private ensure(extra: number) {
    const need = (this.count + extra) * FLOATS_PER_VERTEX;
    if (need <= this.data.length) return;
    const next = new Float32Array(Math.max(need, this.data.length * 2));
    next.set(this.data.subarray(0, this.count * FLOATS_PER_VERTEX));
    this.data = next;
  }

  /**
   * Ajoute la sparkline `values[0..n)` dans la zone monde (x, y, w, h).
   * Même normalisation que le SVG du mode DOM (0..max), épaisseur en px écran.
   */
  add(values: Float32Array, n: number, x: number, y: number, w: number, h: number, zoom: number, thicknessPx: number, rgba: [number, number, number, number], pad = (2 / 46) * h) {
    if (n < 2) return;
    this.ensure((n - 1) * 6);
    let max = 1;
    for (let i = 0; i < n; i++) max = Math.max(max, values[i]);
    const half = thicknessPx / zoom / 2;
    const [r, g, b, a] = rgba;
    const d = this.data;
    let o = this.count * FLOATS_PER_VERTEX;
    const px = (i: number) => x + (i / (SPARK_N - 1)) * w;
    const py = (i: number) => y + h - pad - (values[i] / max) * (h - 2 * pad);
    for (let i = 0; i < n - 1; i++) {
      const x0 = px(i), y0 = py(i), x1 = px(i + 1), y1 = py(i + 1);
      let nx = -(y1 - y0), ny = x1 - x0;
      const len = Math.hypot(nx, ny) || 1;
      nx = (nx / len) * half;
      ny = (ny / len) * half;
      const v = [x0 + nx, y0 + ny, x0 - nx, y0 - ny, x1 + nx, y1 + ny, x1 + nx, y1 + ny, x0 - nx, y0 - ny, x1 - nx, y1 - ny];
      for (let k = 0; k < 12; k += 2) {
        d[o++] = v[k];
        d[o++] = v[k + 1];
        d[o++] = r * a;
        d[o++] = g * a;
        d[o++] = b * a;
        d[o++] = a;
      }
    }
    this.count += (n - 1) * 6;
  }

  addSeries(get: (out: Float32Array) => number, x: number, y: number, w: number, h: number, zoom: number, thicknessPx: number, rgba: [number, number, number, number], pad?: number) {
    const n = get(this.series);
    this.add(this.series, n, x, y, w, h, zoom, thicknessPx, rgba, pad);
  }

  view() {
    return this.data.subarray(0, this.count * FLOATS_PER_VERTEX);
  }
}
