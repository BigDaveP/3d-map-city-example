/**
 * Planificateur de recaptures.
 *
 * Candidats = cartes montées dans le canvas, visibles, au niveau courant, dont la texture
 * manque ou est périmée (version capturée < version du contenu). Les cartes hors écran ne
 * sont jamais candidates : leur dirty flag reste levé jusqu'à leur retour à l'écran.
 *
 * Priorité (plus petit = plus urgent) :
 *   0  carte qui a le focus (saisie en cours) — ignore le budget
 *   1  rapprochée, texture manquante      2  rapprochée, texture périmée
 *   3  intermédiaire, texture manquante   4  intermédiaire, texture périmée
 * À priorité égale : la plus ancienne donnée non affichée d'abord (pas de famine).
 *
 * Budget par frame : nombre de captures ET millisecondes (le premier atteint arrête la file).
 */
import type { Level } from "@/lib/world";

export interface Candidate {
  card: number;
  prio: number;
  since: number;
}

/** Tas binaire minimal (prio, puis ancienneté). */
export class BinaryHeap {
  private a: Candidate[] = [];
  get size() {
    return this.a.length;
  }
  clear() {
    this.a.length = 0;
  }
  private less(i: number, j: number) {
    const x = this.a[i];
    const y = this.a[j];
    return x.prio < y.prio || (x.prio === y.prio && x.since < y.since);
  }
  push(c: Candidate) {
    const a = this.a;
    a.push(c);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): Candidate | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(l, m)) m = l;
        if (r < a.length && this.less(r, m)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

export interface ScheduleInput {
  /** niveau de la carte (une carte épinglée est rapprochée même au zoom intermédiaire) */
  levelOf(card: number): Level;
  /** cartes visibles ET montées au bon niveau */
  candidates: Iterable<number>;
  focused: number;
  /** -1 si la texture manque, sinon version capturée */
  textureVersion(card: number, level: Level): number;
  contentVersion(card: number): number;
  since(card: number): number;
  maxCaptures: number;
  maxMs: number;
  /** effectue la capture ; renvoie false si elle a échoué */
  capture(card: number): boolean;
}

export interface ScheduleResult {
  captured: number;
  ms: number;
  remaining: number;
  forced: number;
}

export class RecaptureScheduler {
  private heap = new BinaryHeap();

  run(i: ScheduleInput): ScheduleResult {
    const heap = this.heap;
    heap.clear();
    for (const card of i.candidates) {
      const level = i.levelOf(card);
      const tv = i.textureVersion(card, level);
      const missing = tv < 0;
      const stale = !missing && tv < i.contentVersion(card);
      if (!missing && !stale) continue;
      const base = level === 2 ? 1 : 3;
      const prio = card === i.focused ? 0 : base + (missing ? 0 : 1);
      heap.push({ card, prio, since: i.since(card) });
    }
    const t0 = performance.now();
    let captured = 0;
    let forced = 0;
    for (;;) {
      const c = heap.size ? heap.pop()! : undefined;
      if (!c) break;
      const over = captured >= i.maxCaptures || performance.now() - t0 >= i.maxMs;
      if (over && c.prio !== 0) {
        heap.push(c);
        break;
      }
      if (i.capture(c.card)) {
        captured++;
        if (over) forced++;
      }
    }
    return { captured, ms: performance.now() - t0, remaining: heap.size, forced };
  }
}
