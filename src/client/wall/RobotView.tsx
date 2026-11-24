"use client";
/**
 * « Voir ce que voit un robot » : texte et arbre d'accessibilité (approximé) extraits du DOM.
 * Chrome n'expose pas l'arbre d'accessibilité réel au JavaScript ; on reconstruit rôles et
 * noms accessibles à partir des balises et attributs ARIA, comme le ferait un lecteur simple.
 */
import { useEffect, useState } from "react";

const IMPLICIT: Record<string, string> = {
  MAIN: "main", ASIDE: "complementary", HEADER: "banner", NAV: "navigation", ARTICLE: "article", SECTION: "region",
  H1: "heading", H2: "heading", H3: "heading", TABLE: "table", TR: "row", TH: "rowheader", TD: "cell", UL: "list", OL: "list",
  LI: "listitem", BUTTON: "button", TEXTAREA: "textbox", SELECT: "combobox", A: "link", BLOCKQUOTE: "blockquote", CANVAS: "canvas",
};

function hidden(el: Element): boolean {
  if (el.getAttribute("aria-hidden") === "true") return true;
  const st = getComputedStyle(el);
  return st.display === "none" || st.visibility === "hidden";
}

function name(el: Element): string {
  const l = el.getAttribute("aria-label");
  if (l) return l;
  if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.text ?? "";
  if (el instanceof HTMLTextAreaElement) return el.placeholder;
  return (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
}

export function accessibilityTree(root: Element, max = 4000): { tree: string; text: string; nodes: number } {
  const lines: string[] = [];
  let nodes = 0;
  const walk = (el: Element, depth: number) => {
    if (nodes > max || el.closest(".robot") || hidden(el)) return;
    const role = el.getAttribute("role") ?? IMPLICIT[el.tagName];
    let d = depth;
    if (role) {
      nodes++;
      const extra = el instanceof HTMLTextAreaElement && el.value ? ` = "${el.value.slice(0, 40)}"` : "";
      const drawable = el.hasAttribute("drawable") ? " [drawable]" : "";
      lines.push(`${"  ".repeat(depth)}${role} "${name(el)}"${extra}${drawable}`);
      d++;
      if (["button", "heading", "cell", "rowheader", "listitem", "textbox", "combobox"].includes(role)) return;
    }
    for (const c of Array.from(el.children)) walk(c, d);
  };
  walk(root, 0);
  const text: string[] = [];
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && !n.parentElement.closest(".robot,script,style,[aria-hidden=true]") && n.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  while (tw.nextNode() && text.length < max) text.push(tw.currentNode.textContent!.trim());
  return { tree: lines.join("\n"), text: text.join(" · "), nodes };
}

export function RobotView({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"tree" | "text">("tree");
  const [snap, setSnap] = useState(() => ({ tree: "", text: "", nodes: 0 }));
  useEffect(() => {
    const read = () => setSnap(accessibilityTree(document.querySelector(".app") ?? document.body));
    read();
    const t = setInterval(read, 2000);
    return () => clearInterval(t);
  }, []);
  return (
    <section className="robot" aria-label="Ce que voit un robot">
      <header>
        <strong>Ce que voit un robot ({snap.nodes} nœuds)</strong>
        <div className="tabs">
          <button type="button" aria-pressed={tab === "tree"} onClick={() => setTab("tree")}>
            Arbre d&apos;accessibilité
          </button>
          <button type="button" aria-pressed={tab === "text"} onClick={() => setTab("text")}>
            Texte
          </button>
          <button type="button" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
      </header>
      <pre>{tab === "tree" ? snap.tree : snap.text}</pre>
    </section>
  );
}
