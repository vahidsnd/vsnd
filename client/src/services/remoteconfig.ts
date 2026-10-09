import { mergeRemoteConfig, setRemoteConfig, type RemoteConfig } from '@nb/shared';
import { serverHttp, store } from './platform.ts';

/**
 * Remote config on the client: the last fetched config is applied immediately from the cache
 * (works offline / in the APK without a server), then refreshed from the server in the background.
 */
export function initRemoteConfig(online: boolean): Promise<void> {
  const cached = store.get<Partial<RemoteConfig> | null>('rconfig', null);
  if (cached) setRemoteConfig(mergeRemoteConfig(cached));
  if (!online || !serverHttp()) return Promise.resolve();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 5000);
  return fetch(serverHttp() + '/api/config', { signal: ctrl.signal })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { config?: RemoteConfig } | null) => {
      if (!j?.config) return;
      setRemoteConfig(mergeRemoteConfig(j.config));
      store.set('rconfig', j.config);
    })
    .catch(() => { /* keep cached */ })
    .finally(() => clearTimeout(to));
}
