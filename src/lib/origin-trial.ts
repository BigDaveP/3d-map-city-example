/** Méta Origin Trial (HTML-in-Canvas) : rendue par le layout seulement si le jeton est défini. */
export function originTrialMeta(env: NodeJS.ProcessEnv): { httpEquiv: "origin-trial"; content: string } | null {
  const token = env.HIC_ORIGIN_TRIAL_TOKEN?.trim();
  return token ? { httpEquiv: "origin-trial", content: token } : null;
}
