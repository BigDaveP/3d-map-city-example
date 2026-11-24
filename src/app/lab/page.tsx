import LabShell from "./LabShell";

export const metadata = { title: "Labo — une carte HTML-in-Canvas" };

export default function LabPage() {
  return (
    <main className="lab">
      <p className="sim-banner" role="note">⚠️ Données simulées.</p>
      <h1>Labo : une seule carte HTML-in-Canvas</h1>
      <p className="note">
        Une carte React montée dans un <code>&lt;canvas content=&quot;drawable&quot;&gt;</code> par portail, capturée dans une texture WebGL2 au handler{" "}
        <code>paint</code>, vérifiée par <code>readPixels</code>, avec la sparkline dessinée en WebGL par-dessus et la géométrie de hit testing mise à jour à chaque
        frame.
      </p>
      <LabShell />
    </main>
  );
}
