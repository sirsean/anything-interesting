import type { Env } from './env';
/** Public story URL, shared by scheduled and on-demand Discord messages. */
export function digestClusterTitleLink(env: Env, clusterId: number): string | undefined {
  const base = env.PUBLIC_SITE_URL?.trim();
  if (!base) return undefined;
  return base.replace(/\/+$/, '') + '/cluster/' + clusterId;
}
