/**
 * État « chaud » hors React, partagé par les deux modes de rendu :
 *  - statut de chaque carte (couleur des tuiles WebGL) ;
 *  - historique des sparklines (jamais dans le HTML capturé) ;
 *  - dirty flags : instant de réception de la plus ancienne donnée HTML non encore affichée.
 */
import { KINDS, type Status } from "@/lib/sim/types";

export const SPARK_N = 40;

export class LiveState {
  readonly cards: number;
  readonly branches: number;
  statuses: Uint8Array;
  statusVersion = 0;
  /** Valeurs de sparkline, en anneau : [branche * SPARK_N + i] */
  spark: Float32Array;
  sparkHead: Uint16Array;
  sparkCount: Uint16Array;
  sparkVersion = 0;
  /** Signature du contenu HTML de chaque carte : change => dirty. */
  sig: string[];
  /** 0 = propre ; sinon performance.now() de réception de la plus ancienne donnée non affichée. */
  dirtySince: Float64Array;
  /**
   * Version du contenu HTML de chaque carte : incrémentée à chaque changement. Une texture
   * mémorise la version capturée ; elle est périmée si version > texture.version (quel que
   * soit son niveau : une texture intermédiaire peut être périmée pendant qu'on regarde la
   * version complète).
   */
  version: Uint32Array;
  /** Nombre de passages à dirty (pour le banc). */
  dirtyMarks = 0;
  private listeners = new Set<() => void>();

  constructor(cardCount: number) {
    this.cards = cardCount;
    this.branches = cardCount / KINDS.length;
    this.statuses = new Uint8Array(cardCount);
    this.spark = new Float32Array(this.branches * SPARK_N);
    this.sparkHead = new Uint16Array(this.branches);
    this.sparkCount = new Uint16Array(this.branches);
    this.sig = new Array(cardCount).fill("");
    this.dirtySince = new Float64Array(cardCount);
    this.version = new Uint32Array(cardCount);
  }

  /** Marque la carte dirty (donnée reçue à `at`, ou interaction). */
  markDirty(card: number, at: number) {
    if (this.dirtySince[card] === 0 || at < this.dirtySince[card]) this.dirtySince[card] = at;
    this.version[card]++;
    this.dirtyMarks++;
  }

  setStatus(card: number, s: Status) {
    if (this.statuses[card] !== s) {
      this.statuses[card] = s;
      this.statusVersion++;
    }
  }

  pushSpark(branch: number, v: number) {
    const head = this.sparkHead[branch];
    this.spark[branch * SPARK_N + head] = v;
    this.sparkHead[branch] = (head + 1) % SPARK_N;
    if (this.sparkCount[branch] < SPARK_N) this.sparkCount[branch]++;
    this.sparkVersion++;
  }

  /** Copie ordonnée (du plus ancien au plus récent) de la sparkline d'une succursale. */
  sparkSeries(branch: number, out: Float32Array = new Float32Array(SPARK_N)): number {
    const count = this.sparkCount[branch];
    const head = this.sparkHead[branch];
    for (let i = 0; i < count; i++) {
      out[i] = this.spark[branch * SPARK_N + ((head - count + i + SPARK_N) % SPARK_N)];
    }
    return count;
  }

  /** Met à jour la signature ; marque dirty si elle change. Renvoie true si changement. */
  updateSig(card: number, sig: string, receivedAt: number): boolean {
    if (this.sig[card] === sig) return false;
    this.sig[card] = sig;
    this.markDirty(card, receivedAt);
    return true;
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    for (const fn of this.listeners) fn();
  }
}
