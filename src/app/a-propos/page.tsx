import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "@/client/territoire/home/home.css";
import { BrandMark, EnvIcon, UiIcon } from "@/client/territoire/shell/EnvIcon";
import { ATTRIBUTIONS, DEMO_CONSTANTS, NON_OFFICIAL, REALITY, SOURCES, TRY_IT } from "@/lib/territoire/about";
import { ENVS, type EnvId } from "@/lib/territoire/envs";

export const metadata: Metadata = {
  title: "À propos · Territoire · Trois-Rivières (démo non officielle)",
  description: "Démo non officielle : sources et licences des données ouvertes, ce qui est réel et ce qui est simulé, constantes de la journée de démo.",
};

export const viewport: Viewport = { themeColor: "#ffffff" };

/** Heure « HH:MM » d'une constante en « 10 h 00 » ; les autres valeurs telles quelles. */
const hour = (v: string) => (/^\d\d:\d\d$/.test(v) ? `${Number(v.slice(0, 2))} h ${v.slice(3)}` : v);

/** « À propos » (spec 5.1) : page ordinaire rendue par le serveur, sans JavaScript nécessaire. */
export default function AboutPage() {
  return (
    <div className="tr-home tr-about-page">
      <header className="aq-bar tr-home-bar">
        <Link href="/" className="tr-brand" aria-label="Territoire · Trois-Rivières : vue d'ensemble">
          <BrandMark />
          <span className="tr-brand-name">
            Territoire <span className="tr-brand-city">· Trois-Rivières</span>
          </span>
          <span className="tr-badge">Démo</span>
        </Link>
        <span className="aq-spacer" />
        <Link href="/" className="tr-back">
          <UiIcon name="arrow-left" />
          Vue d&apos;ensemble
        </Link>
      </header>
      <main className="tr-home-main tr-prose">
        <h1>À propos de la démo</h1>
        <p className="tr-home-lede">
          Un outil de gestion du territoire imaginé pour Trois-Rivières, pour montrer ce que permet HTML-in-Canvas : les services de la ville
          sur la même carte 3D, des alertes et une journée simulée. Données ouvertes réelles, complétées par des simulations clairement
          marquées.
        </p>
        <p className="tr-callout" role="note">
          <strong>{NON_OFFICIAL}</strong>
        </p>

        <section aria-labelledby="sources">
          <h2 id="sources">Sources et licences</h2>
          <div className="tr-table-wrap">
            <table className="tr-table">
              <thead>
                <tr>
                  <th scope="col">Jeu de données</th>
                  <th scope="col">Éditeur</th>
                  <th scope="col">Licence</th>
                  <th scope="col">Lien</th>
                </tr>
              </thead>
              <tbody>
                {SOURCES.map((s) => (
                  <tr key={s.dataset}>
                    <th scope="row">
                      {s.dataset}
                      <small>{s.use}</small>
                    </th>
                    <td>{s.publisher}</td>
                    <td>
                      <a href={s.licenceHref} rel="noreferrer">
                        {s.licence}
                      </a>
                    </td>
                    <td>
                      <a href={s.href} rel="noreferrer">
                        {s.linkLabel}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Attributions affichées dans la démo</h3>
          <ul className="tr-attrib-list">
            {ATTRIBUTIONS.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <p className="tr-muted">
            Les jeux ouverts sont prétraités une fois par script et versionnés (fichiers <code>SOURCE.md</code> du dépôt) ; seule la météo est
            lue en direct, par le serveur, avec un cache de 30 minutes. Aucun logo, gabarit ni texte d&apos;une ville n&apos;est repris.
          </p>
        </section>

        <section aria-labelledby="reel">
          <h2 id="reel">Réel et simulé, environnement par environnement</h2>
          <div className="tr-table-wrap">
            <table className="tr-table">
              <thead>
                <tr>
                  <th scope="col">Environnement</th>
                  <th scope="col">Réel</th>
                  <th scope="col">Simulé</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(ENVS) as EnvId[]).map((id) => (
                  <tr key={id} data-env={id}>
                    <th scope="row">
                      <span className="tr-env-name">
                        <EnvIcon env={id} size={15} />
                        {ENVS[id].title}
                      </span>
                      {ENVS[id].lot !== 1 && <span className="tr-soon">À venir</span>}
                    </th>
                    <td>{REALITY[id].real}</td>
                    <td>{REALITY[id].simulated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="journee">
          <h2 id="journee">La journée simulée et ses constantes</h2>
          <p>
            Une seule horloge simulée pour toute la ville, à l&apos;heure locale de Trois-Rivières. On arrive sur « maintenant » ; la frise de
            24 h des vues 3D permet d&apos;avancer, de reculer et d&apos;accélérer. Si vous ne décidez rien, la direction (simulée) décide à
            l&apos;heure prévue et les équipes de nuit (simulées) font le travail : la ville reste cohérente à toute heure. Ces heures sont des
            constantes de la démo.
          </p>
          <dl className="tr-consts">
            {DEMO_CONSTANTS.map((c) => (
              <div key={c.label}>
                <dt>{hour(c.value)}</dt>
                <dd>{c.label}</dd>
              </div>
            ))}
          </dl>
          <p className="tr-muted">
            Avec la décision par défaut de 10 h, les alertes « critique à midi » et « décision tardive à 15 h » du déneigement ne paraissent
            que si personne n&apos;a décidé ; elles restent dans le modèle. La décision d&apos;interdiction n&apos;est jamais refusée : après
            15 h, la démo prévient que les résidents auront moins de temps pour déplacer leur véhicule, et la nuit, une décision change tout
            de suite les feux de la nuit en cours.
          </p>
        </section>

        <section aria-labelledby="hic">
          <h2 id="hic">Ce que montre HTML-in-Canvas</h2>
          <p>
            HTML-in-Canvas dessine de vrais éléments HTML (étiquettes de capteurs, marquages de secteurs, coupe sous la rue) dans la scène
            WebGL : ils suivent la perspective, passent derrière les bâtiments et restent cliquables et accessibles. Sans l&apos;API, la démo
            passe en mode classique (marqueurs DOM au-dessus de la carte) et propose une vidéo de la version HTML-in-Canvas.
          </p>
          <p>
            Les mesures comparées des deux modes (images par seconde, temps JavaScript, captures) sont sur le{" "}
            <Link href="/bench">banc de mesures</Link>. Elles ont été prises sans GPU (SwiftShader).
          </p>
          <h3>À essayer</h3>
          <ul>
            {TRY_IT.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="credits">
          <h2 id="credits">Interface et crédits</h2>
          <p>
            L&apos;interface a été revue avec la méthode{" "}
            <a href="https://github.com/heydamir/unslop" rel="noreferrer">
              unslop
            </a>{" "}
            de Damir Sokolovsky (licence{" "}
            <a href="https://creativecommons.org/licenses/by/4.0/deed.fr" rel="noreferrer">
              CC BY 4.0
            </a>
            ). Les vignettes de l&apos;accueil sont de vraies captures de la scène 3D, produites par un script.
          </p>
          <p>
            Les icônes de la météo reprennent des tracés de{" "}
            <a href="https://lucide.dev" rel="noreferrer">
              Lucide
            </a>{" "}
            (licence{" "}
            <a href="https://github.com/lucide-icons/lucide/blob/main/LICENSE" rel="noreferrer">
              ISC
            </a>
            , © Lucide Contributors, et © Cole Bemis pour les parties issues de Feather). Elles suivent les codes d&apos;icônes publiés par
            Environnement et Changement climatique Canada.
          </p>
        </section>
      </main>
      <footer className="tr-home-foot">
        <p>
          Démo non officielle · données ouvertes CC-BY 4.0 · <Link href="/">Vue d&apos;ensemble</Link>
        </p>
      </footer>
    </div>
  );
}
