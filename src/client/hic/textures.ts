/**
 * Stockage des textures de cartes. Deux stratégies comparables :
 *  - AtlasStore : pages de 2048² découpées en emplacements de taille fixe (une classe de
 *    taille par niveau). Toutes les cartes d'une page se dessinent en UN appel instancié.
 *  - PerCardStore : une texture par (carte, niveau), un appel de dessin par carte.
 * Les deux appliquent un budget mémoire avec éviction LRU (jamais une texture dessinée dans
 * la frame courante).
 */

export interface Slot {
  card: number;
  level: number;
  tex: WebGLTexture;
  /** position et taille de la capture dans la texture (texels) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** taille de la texture qui contient l'emplacement */
  tw: number;
  th: number;
  page: number;
  /** version de contenu capturée (LiveState.version) ; -1 = jamais remplie */
  version: number;
  lastUsed: number;
}

export interface TextureStore {
  readonly kind: "atlas" | "par carte";
  get(card: number, level: number): Slot | undefined;
  /** Emplacement pour une capture w×h, alloué si besoin. Undefined si budget épuisé. */
  ensure(card: number, level: number, w: number, h: number, frame: number): Slot | undefined;
  readonly bytes: number;
  readonly count: number;
  clear(): void;
}

const key = (card: number, level: number) => card * 4 + level;

export class PerCardStore implements TextureStore {
  readonly kind = "par carte" as const;
  private slots = new Map<number, Slot>();
  bytes = 0;
  constructor(private gl: WebGL2RenderingContext, private alloc: (w: number, h: number) => WebGLTexture, private maxBytes: number) {}
  get count() {
    return this.slots.size;
  }
  get(card: number, level: number) {
    return this.slots.get(key(card, level));
  }
  ensure(card: number, level: number, w: number, h: number, frame: number) {
    const k = key(card, level);
    const s = this.slots.get(k);
    if (s && s.w === w && s.h === h) return s;
    if (s) this.free(k, s);
    const need = w * h * 4;
    while (this.bytes + need > this.maxBytes) {
      let victim: [number, Slot] | undefined;
      for (const e of this.slots) if (e[1].lastUsed < frame && (!victim || e[1].lastUsed < victim[1].lastUsed)) victim = e;
      if (!victim) return undefined;
      this.free(victim[0], victim[1]);
    }
    const slot: Slot = { card, level, tex: this.alloc(w, h), x: 0, y: 0, w, h, tw: w, th: h, page: -1, version: -1, lastUsed: frame };
    this.slots.set(k, slot);
    this.bytes += need;
    return slot;
  }
  private free(k: number, s: Slot) {
    this.gl.deleteTexture(s.tex);
    this.bytes -= s.tw * s.th * 4;
    this.slots.delete(k);
  }
  clear() {
    for (const [k, s] of this.slots) this.free(k, s);
  }
}

interface Page {
  tex: WebGLTexture;
  cw: number; // taille d'un emplacement (avec marge)
  ch: number;
  cols: number;
  capacity: number;
  free: number[];
  used: (Slot | undefined)[];
}

export class AtlasStore implements TextureStore {
  readonly kind = "atlas" as const;
  private slots = new Map<number, Slot>();
  pages: Page[] = [];
  bytes = 0;
  readonly size: number;
  private pad = 2;
  constructor(private gl: WebGL2RenderingContext, private alloc: (w: number, h: number) => WebGLTexture, private maxBytes: number) {
    this.size = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
  }
  get count() {
    return this.slots.size;
  }
  get(card: number, level: number) {
    return this.slots.get(key(card, level));
  }
  ensure(card: number, level: number, w: number, h: number, frame: number) {
    const k = key(card, level);
    const cur = this.slots.get(k);
    if (cur && cur.w === w && cur.h === h) return cur;
    if (cur) this.release(k, cur);
    const cw = w + this.pad;
    const ch = h + this.pad;
    if (cw > this.size || ch > this.size) return undefined;
    let page = this.pages.findIndex((p) => p.cw === cw && p.ch === ch && p.free.length > 0);
    if (page < 0 && this.bytes + this.size * this.size * 4 <= this.maxBytes) page = this.newPage(cw, ch);
    if (page < 0) {
      // éviction LRU parmi les emplacements de même taille non dessinés cette frame
      let victim: Slot | undefined;
      for (const s of this.slots.values()) {
        const p = this.pages[s.page];
        if (p.cw === cw && p.ch === ch && s.lastUsed < frame && (!victim || s.lastUsed < victim.lastUsed)) victim = s;
      }
      if (!victim) return undefined;
      this.release(key(victim.card, victim.level), victim);
      page = victim.page;
    }
    const p = this.pages[page];
    const idx = p.free.pop()!;
    const slot: Slot = {
      card,
      level,
      tex: p.tex,
      x: (idx % p.cols) * cw,
      y: Math.floor(idx / p.cols) * ch,
      w,
      h,
      tw: this.size,
      th: this.size,
      page,
      version: -1,
      lastUsed: frame,
    };
    p.used[idx] = slot;
    this.slots.set(k, slot);
    return slot;
  }
  private newPage(cw: number, ch: number) {
    const cols = Math.floor(this.size / cw);
    const rows = Math.floor(this.size / ch);
    const capacity = cols * rows;
    const free: number[] = [];
    for (let i = capacity - 1; i >= 0; i--) free.push(i);
    this.pages.push({ tex: this.alloc(this.size, this.size), cw, ch, cols, capacity, free, used: new Array(capacity) });
    this.bytes += this.size * this.size * 4;
    return this.pages.length - 1;
  }
  private release(k: number, s: Slot) {
    const p = this.pages[s.page];
    const idx = Math.floor(s.y / p.ch) * p.cols + Math.floor(s.x / p.cw);
    p.used[idx] = undefined;
    p.free.push(idx);
    this.slots.delete(k);
  }
  clear() {
    for (const p of this.pages) this.gl.deleteTexture(p.tex);
    this.pages = [];
    this.slots.clear();
    this.bytes = 0;
  }
}
