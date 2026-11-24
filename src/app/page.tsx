import Link from "next/link";
import { DEMOS } from "@/client/shell/demos";

/** Page provisoire : la démo du réseau d'eau la remplacera. */
export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 24 }}>
      <h1>Démos HTML-in-Canvas</h1>
      <p>Toutes les données de ces démos sont simulées.</p>
      <ul>
        {DEMOS.map((d) => (
          <li key={d.id}>
            <Link href={d.href}>{d.title}</Link> : {d.sentence}
          </li>
        ))}
      </ul>
    </main>
  );
}
