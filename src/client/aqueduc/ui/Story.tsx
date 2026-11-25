"use client";
/**
 * Récit du scénario de bris, à gauche, seulement pendant le scénario (budget d'interface) : les cinq
 * étapes, le texte de l'étape en cours, le chiffre qui compte à ce moment (adresses en basse pression
 * avant l'isolation, sans eau après), précédent / suivant, « Explorer librement » et, au rapport,
 * l'export vidéo de la séquence. Tout y est simulé, et le récit le dit.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MlMap } from "maplibre-gl";
import { VIDEO_CREDITS } from "@/lib/aqueduc/city";
import { scenarioSteps, type ScenarioStep, type StepId } from "@/lib/aqueduc/scenario";
import { useSimDay, useTerritoire } from "../../territoire/useTerritoire";
import { canRecord, download, recordMap } from "../video";
import { clockTime, num } from "../format";
import type { NetIndex } from "../net";
import { exploreFreely, goToStep, nextStep, prevStep, replayForVideo, startScenario } from "../scenarioController";
import { valveLabel } from "../scene/cut";
import { useImpactTotals } from "../scene/SectorMark";
import { useAq } from "../useAq";

export const VIDEO_MS = 10_000;
const plural = (n: number, one: string, many: string) => `${num(n)} ${n > 1 ? many : one}`;

function duration(ms: number) {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

/** Le chiffre de l'étape (R8b) : calculé depuis le flux, ou depuis le plan du serveur au rapport. */
function StepFigure({ net, step, steps }: { net: NetIndex; step: StepId; steps: ScenarioStep[] }) {
  const closed = useAq((s) => s.scenario.valvesClosed);
  const mode = useTerritoire((s) => s.mode);
  const timeOf = (id: StepId) => steps.find((s) => s.id === id)!.at;
  const live = useImpactTotals(net);
  const plan = net.data.scenario;
  const valves = plan.valves.map((v) => valveLabel(net, v)).join(" et ");
  const where = mode === "hic" ? "dans la coupe sous la rue" : "dans la fiche de l'incident";
  let text: string;
  let tone: "bad" | "warn" | "good" = "warn";
  if (step === "rapport") {
    text = `À ${clockTime(timeOf("isolation"))}, vannes ouvertes : ${plural(plan.impact.lowPressure, "adresse", "adresses")} en basse pression. Vannes ${valves} fermées : ${plural(plan.impact.withoutWater, "adresse", "adresses")} sans eau pendant ${duration(timeOf("retablissement") - timeOf("isolation"))}.`;
    tone = "good";
  } else if (live.dry > 0) {
    text = step === "isolation" ? `Vannes fermées : ${plural(live.dry, "adresse", "adresses")} sans eau ; le reste du secteur retrouve sa pression.` : `${plural(live.dry, "adresse", "adresses")} sans eau`;
    tone = "bad";
  } else if (live.low > 0) {
    text = `${plural(live.low, "adresse", "adresses")} en basse pression${step === "isolation" && !closed ? `. Fermez ${valves} ${where}.` : ""}`;
  } else {
    text = step === "detection" ? "Lecture des capteurs…" : "Pression normale partout";
    tone = "good";
  }
  return (
    <p className="aq-story-fig" data-tone={tone} role="status">
      {text}
    </p>
  );
}

/**
 * Export de la séquence : les étapes rejouées en 10 s pendant l'enregistrement du canvas. L'état vit
 * dans le récit (toujours monté pendant le scénario) : la relecture change d'étape pendant
 * l'enregistrement.
 */
function useVideoExport(map: MlMap) {
  const [state, setState] = useState<{ busy: boolean; msg: string }>({ busy: false, msg: "" });
  const url = useRef("");
  const [supported, setSupported] = useState(true);
  // le navigateur est interrogé après le montage (rien à lire côté serveur)
  useEffect(() => setSupported(canRecord()), []);
  useEffect(() => () => void (url.current && URL.revokeObjectURL(url.current)), []);
  const run = async () => {
    if (!canRecord()) return setState({ busy: false, msg: "Votre navigateur ne sait pas enregistrer la carte." });
    setState({ busy: true, msg: "Enregistrement de la séquence (10 s)…" });
    const stop = replayForVideo();
    try {
      const r = await recordMap(map, VIDEO_CREDITS, VIDEO_MS);
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = r.url;
      setState({ busy: false, msg: `Vidéo enregistrée : scenario-bris.webm, ${num(r.size / 1e6, 1)} Mo, ${num(r.ms / 1000, 1)} s.` });
      download(r.url, "scenario-bris.webm");
    } catch (e) {
      setState({ busy: false, msg: `La vidéo n'a pas pu être enregistrée (${(e as Error).message}).` });
    } finally {
      stop();
      goToStep("rapport");
    }
  };
  return { ...state, supported, run };
}

function ExportVideo({ video }: { video: ReturnType<typeof useVideoExport> }) {
  const mode = useTerritoire((s) => s.mode);
  return (
    <div className="aq-story-export">
      <button type="button" className="aq-btn aq-pri" disabled={video.busy || !video.supported} onClick={video.run}>
        {video.busy ? "Enregistrement…" : "Exporter la vidéo"}
      </button>
      <p className="aq-note" role="status">
        {video.msg ||
          (!video.supported
            ? "Export indisponible : ce navigateur ne prend pas en charge l'enregistrement de la carte (MediaRecorder et canvas.captureStream)."
            : mode === "hic"
            ? "10 s : les étapes rejouées, avec les inscriptions de la scène et un bandeau de crédits."
            : "10 s : en mode classique, la vidéo ne contient que la carte et un bandeau de crédits (les étiquettes DOM n'y sont pas).")}
      </p>
    </div>
  );
}

export function Story({ map, net }: { map: MlMap; net: NetIndex }) {
  const active = useAq((s) => s.scenario.active);
  const step = useAq((s) => s.scenario.step);
  const heading = useRef<HTMLHeadingElement>(null);
  const video = useVideoExport(map);
  // étapes de la journée simulée, où le scénario se joue
  const day = useSimDay();
  const steps = useMemo(() => scenarioSteps(day), [day]);
  // le récit apparaît : le focus y va (clavier, lecteur d'écran)
  useEffect(() => {
    if (active) heading.current?.focus();
  }, [active]);
  if (!active) return null;
  const k = steps.findIndex((s) => s.id === step);
  const last = k === steps.length - 1;
  return (
    <aside className="aq-story aq-panel" aria-label="Scénario de bris guidé (simulation)" data-testid="story">
      <span className="aq-h3">Scénario simulé · 5 étapes</span>
      <h2 ref={heading} tabIndex={-1}>
        Une conduite de 1920 cède sous la rue des Forges
      </h2>
      <ol className="aq-story-steps">
        {steps.map((s, i) => {
          const [time, name] = s.title.split(" · ");
          return (
            <li key={s.id} data-state={i < k ? "done" : i === k ? "now" : undefined}>
              <button type="button" aria-current={i === k ? "step" : undefined} disabled={video.busy} onClick={() => goToStep(s.id)}>
                <span className="aq-story-n" aria-hidden="true">
                  {i < k ? "✓" : i + 1}
                </span>
                <span>
                  <b>{name}</b> <span className="aq-num">{time}</span>
                </span>
              </button>
              {i === k && (
                <div className="aq-story-body">
                  <p>{s.text}</p>
                  <StepFigure net={net} step={s.id} steps={steps} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="aq-btns aq-story-nav">
        <button type="button" className="aq-btn" disabled={k === 0 || video.busy} onClick={() => prevStep()}>
          Précédent
        </button>
        {last ? (
          <button type="button" className="aq-btn" disabled={video.busy} onClick={() => startScenario()}>
            Rejouer le scénario
          </button>
        ) : (
          <button type="button" className="aq-btn aq-pri" disabled={video.busy} onClick={() => nextStep()}>
            Étape suivante
          </button>
        )}
        <button type="button" className="aq-btn aq-story-exit" disabled={video.busy} onClick={() => exploreFreely()}>
          Explorer librement
        </button>
      </div>
      {(last || video.busy) && <ExportVideo video={video} />}
      <p className="aq-note">Capteurs, vannes, pressions et adresses : simulation. Tracé des conduites : Ville de Trois-Rivières.</p>
    </aside>
  );
}
