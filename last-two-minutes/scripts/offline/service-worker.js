/* global buildManifest, self, caches, crypto, fetch, Response, URL */
const scope = new URL(self.registration.scope);
const prefix = `xyz-offline:${scope.href}:`;
const current = prefix + buildManifest.version;
const metadataPath = new URL('__xyz_offline_metadata__', scope).href;
const canonical = (path) =>
  new URL(path.split('/').map(encodeURIComponent).join('/'), scope).href;
const resources = new Map(
  buildManifest.resources.map((entry) => [canonical(entry.path), entry]),
);
const hex = (bytes) =>
  Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
const notify = async (message) => {
  for (const client of await self.clients.matchAll({
    includeUncontrolled: true,
  }))
    if (client.url.startsWith(scope.href)) client.postMessage(message);
};
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Never mutate a cache still owned by an active/waiting worker.
      if (await caches.has(current)) {
        const existing = await caches.open(current);
        if (await existing.match(metadataPath)) return;
        await caches.delete(current);
      }
      const cache = await caches.open(current);
      try {
        for (const [url, entry] of resources) {
          const response = await fetch(url, {
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
          });
          if (
            !response.ok ||
            response.type === 'opaque' ||
            /\b(?:private|no-store)\b/i.test(
              response.headers.get('cache-control') ?? '',
            )
          )
            throw new Error(
              `Uncacheable public deployment resource: ${entry.path} (${response.status})`,
            );
          const mime = response.headers.get('content-type') ?? '';
          if (
            /\.[cm]?js$/.test(entry.path) &&
            !/^(?:text|application)\/(?:javascript|ecmascript)/i.test(mime)
          )
            throw new Error(
              `Incorrect module/worker/worklet MIME: ${entry.path}`,
            );
          if (entry.path.endsWith('.html') && !/^text\/html/i.test(mime))
            throw new Error(`Incorrect HTML MIME: ${entry.path}`);
          if (entry.path.endsWith('.css') && !/^text\/css/i.test(mime))
            throw new Error(`Incorrect stylesheet MIME: ${entry.path}`);
          const bytes = await response.clone().arrayBuffer();
          if (
            bytes.byteLength !== entry.bytes ||
            hex(await crypto.subtle.digest('SHA-256', bytes)) !== entry.sha256
          )
            throw new Error(`Deployment checksum mismatch: ${entry.path}`);
          await cache.put(url, response);
        }
        await cache.put(
          metadataPath,
          new Response(
            JSON.stringify({ ...buildManifest, installed: Date.now() }),
            { headers: { 'Content-Type': 'application/json' } },
          ),
        );
        await notify({
          type: 'xyz-offline',
          state: 'installed',
          version: buildManifest.version,
        });
        // No skipWaiting: existing pages must finish with their original version.
      } catch (error) {
        await caches.delete(current);
        await notify({
          type: 'xyz-offline',
          state: 'error',
          error: String(error),
        });
        throw error;
      }
    })(),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const versions = [];
      for (const name of await caches.keys()) {
        if (!name.startsWith(prefix) || name === current) continue;
        const metadata = await (await caches.open(name)).match(metadataPath);
        if (metadata)
          versions.push({ name, installed: (await metadata.json()).installed });
        else await caches.delete(name);
      }
      versions.sort((a, b) => b.installed - a.installed);
      // Retain the last complete generation for rollback/redeployment. Failed
      // installation never activates and never deletes the previous generation.
      for (const entry of versions.slice(1)) await caches.delete(entry.name);
      await self.clients.claim();
      await notify({
        type: 'xyz-offline',
        state: 'ready',
        version: buildManifest.version,
      });
    })(),
  );
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== scope.origin || !url.href.startsWith(scope.href)) return;
  // No runtime content caching, query/private endpoints or network gameplay.
  if (url.search) {
    if (event.request.mode !== 'navigate') return;
    url.search = '';
  }
  if (url.pathname.endsWith('/')) url.pathname += 'index.html';
  const entry = resources.get(url.href);
  if (!entry) return;
  event.respondWith(
    (async () => {
      const response = await (await caches.open(current)).match(url.href);
      return (
        response ??
        new Response(`Offline resource missing: ${entry.path}`, {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        })
      );
    })(),
  );
});
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'xyz-offline-status') return;
  event.ports[0]?.postMessage({
    version: buildManifest.version,
    state: 'ready',
  });
});
