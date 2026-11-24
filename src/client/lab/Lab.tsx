"use client";
/**
 * Étape 3 : une carte, de bout en bout. Montage React par portail dans le canvas, upload dans
 * `paint`, vérification des pixels, géométrie pour le clic et la saisie, recapture quand les
 * données ou la saisie changent.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Card } from "../wall/cards/Card";
import { CARD_CSS, SPARK_ZONE } from "../wall/cards/zones";
import { createDataStore } from "../store";
import { Sources } from "../sources";
import { Programs, INSTANCE_FLOATS } from "../hic/gl";
import { HicSurface, probeGeometryUnit } from "../hic/surface";
import { SparkBuilder } from "../hic/spark";

const CARD = 0; // succursale 0, indicateur « ventes »

interface Report {
  api: string;
  unit: string;
  paints: number;
  uploads: number;
  lastUploadMs: number;
  verify: string;
  texels: string;
  changed: number;
  focus: string;
  error: string;
  zoom: number;
}

export default function Lab() {
  const ds = useMemo(() => createDataStore(250), []);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    if (!canvas) return;
    const sources = new Sources(ds, 250);
    sources.start(10);
    void sources.loadPersisted();
    let surface: HicSurface;
    try {
      surface = new HicSurface(canvas);
    } catch (e) {
      setReport((r) => ({ ...(r as Report), error: (e as Error).message }));
      return;
    }
    const gl = surface.gl;
    const prog = new Programs(gl);
    const spark = new SparkBuilder();
    const rep: Report = { api: surface.api.detail, unit: probeGeometryUnit(), paints: 0, uploads: 0, lastUploadMs: 0, verify: "—", texels: "", changed: 0, focus: "", error: "", zoom: 1 };
    let tex: WebGLTexture | null = null;
    let texW = 0;
    let texH = 0;
    let dirty = true;
    let raf = 0;
    const inst = new Float32Array(INSTANCE_FLOATS);
    const camOrigin = { x: 40, y: 40 }; // position écran du coin de la carte

    const el = () => canvas.querySelector<HTMLElement>(`[data-card="${CARD}"]`);

    const unsub = ds.live.onChange(() => {
      if (ds.live.dirtySince[CARD]) dirty = true;
    });

    const draw = () => {
      const z = zoomRef.current;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.03, 0.04, 0.06, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!tex) return;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const vw = canvas.clientWidth;
      const vh = canvas.clientHeight;
      // caméra : le monde = px CSS de la carte ; coin de la carte en camOrigin à l'écran
      const cx = vw / 2 / z - camOrigin.x / z;
      const cy = vh / 2 / z - camOrigin.y / z;
      const css = CARD_CSS[2];
      inst.set([0, 0, css.w, css.h, 0, 0, css.w / texW, css.h / texH, 1, 1, 1, 1]);
      gl.useProgram(prog.tex);
      prog.setCamera(prog.tex, cx, cy, z, vw, vh);
      gl.bindVertexArray(prog.quadVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, prog.instBuf);
      gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(prog.loc(prog.tex, "u_tex"), 0);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 1);
      // sparkline WebGL par-dessus la texture (jamais dans le HTML capturé)
      const zn = SPARK_ZONE[2];
      spark.reset();
      spark.addSeries((out) => ds.live.sparkSeries(0, out), zn.x, zn.y, zn.w, zn.h, z, 1.5, [0.345, 0.651, 1, 1]);
      gl.useProgram(prog.line);
      prog.setCamera(prog.line, cx, cy, z, vw, vh);
      gl.bindVertexArray(prog.lineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, prog.lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, spark.view(), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, spark.count);
      gl.bindVertexArray(null);
    };

    const onPaint = (e: Event) => {
      rep.paints++;
      const changed = (e as Event & { changedElements?: Element[] }).changedElements;
      const card = el();
      if (!card) return;
      if (changed && Array.from(changed).includes(card)) {
        rep.changed++;
        dirty = true;
      }
      if (dirty) {
        const [w, h] = surface.texelSize(card);
        if (!tex || w !== texW || h !== texH) {
          if (tex) gl.deleteTexture(tex);
          tex = surface.allocTexture(w, h);
          texW = w;
          texH = h;
        }
        const t0 = performance.now();
        const r = surface.upload(card, tex, 0, 0);
        rep.lastUploadMs = performance.now() - t0;
        if (!r.ok) rep.error = r.error ?? "";
        else {
          rep.uploads++;
          ds.live.dirtySince[CARD] = 0;
          dirty = false;
          if (rep.uploads === 1 || rep.uploads % 20 === 0) {
            const v = surface.verify(tex, 0, 0, w, h);
            rep.verify = `${v.ok ? "OK" : "VIDE"} ${JSON.stringify(v.samples[0])}`;
          }
        }
        rep.texels = `${w}×${h} (échelle ${surface.scale.toFixed(2)})`;
      }
      draw();
    };
    canvas.addEventListener("paint", onPaint);

    const frame = () => {
      raf = requestAnimationFrame(frame);
      surface.resize();
      ds.flush();
      const card = el();
      if (card) surface.setGeometry(card, new DOMMatrix().translate(camOrigin.x, camOrigin.y).scale(zoomRef.current));
      surface.requestPaint();
    };
    raf = requestAnimationFrame(frame);
    const ui = setInterval(() => {
      rep.focus = document.activeElement?.closest("[data-card]") ? (document.activeElement as HTMLElement).tagName.toLowerCase() : "—";
      rep.zoom = zoomRef.current;
      setReport({ ...rep });
    }, 250);
    (window as unknown as Record<string, unknown>).__lab = { rep, surface, ds };
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(ui);
      unsub();
      canvas.removeEventListener("paint", onPaint);
      sources.stop();
    };
  }, [canvas, ds]);

  return (
    <div className="lab-grid">
      <div className="lab-stage">
        <canvas ref={setCanvas} className="lab-canvas" data-testid="lab-canvas" />
        {/* hydratation : la carte n'existe qu'après montage, insérée par portail dans le canvas */}
        {canvas && createPortal(<Card ds={ds} card={CARD} level={2} drawable />, canvas)}
      </div>
      <aside className="lab-report" data-testid="lab-report">
        <div role="group" aria-label="Zoom">
          {[0.4, 1, 1.5].map((z) => (
            <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)}>
              {Math.round(z * 100)} %
            </button>
          ))}
        </div>
        {report && (
          <dl>
            <dt>API</dt>
            <dd>{report.api}</dd>
            <dt>Unité de canvasTransform</dt>
            <dd data-testid="unit">{report.unit}</dd>
            <dt>Évènements paint</dt>
            <dd>{report.paints}</dd>
            <dt>Captures (uploads)</dt>
            <dd data-testid="uploads">{report.uploads}</dd>
            <dt>Dernière capture</dt>
            <dd>{report.lastUploadMs.toFixed(2)} ms</dd>
            <dt>Texture</dt>
            <dd>{report.texels}</dd>
            <dt>Vérification readPixels</dt>
            <dd data-testid="verify">{report.verify}</dd>
            <dt>Paint avec la carte dans changedElements</dt>
            <dd>{report.changed}</dd>
            <dt>Focus dans la carte</dt>
            <dd data-testid="focus">{report.focus}</dd>
            <dt>Erreur</dt>
            <dd data-testid="error">{report.error || "—"}</dd>
          </dl>
        )}
      </aside>
    </div>
  );
}
