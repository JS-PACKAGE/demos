/* global document, navigator, window, caches, URL */
const panel = document.createElement('section');
panel.setAttribute('aria-label', 'Offline deployment');
const status = document.createElement('p');
status.setAttribute('role', 'status');
status.setAttribute('aria-live', 'polite');
const update = document.createElement('button');
update.textContent = 'Check offline update';
const remove = document.createElement('button');
remove.textContent = 'Remove offline installation';
panel.append(status, update, remove);
document.body.append(panel);
let registration;
const show = (text) => {
  status.textContent = text;
};
const fail = (error) =>
  show(
    `Offline installation failed; any previous complete version is retained. ${error}`,
  );
const waiting = () =>
  show(
    'Offline update verified. Close all game tabs and reopen to activate it without mixing versions.',
  );
if (!window.isSecureContext || !('serviceWorker' in navigator)) {
  show(
    'Offline installation unavailable: HTTPS or localhost and native Service Workers are required.',
  );
  update.disabled = remove.disabled = true;
} else {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'xyz-offline') return;
    if (event.data.state === 'error') fail(event.data.error);
    else if (event.data.state === 'ready')
      show(`Offline ready: ${event.data.version.slice(0, 12)}.`);
    else if (
      event.data.state === 'installed' &&
      navigator.serviceWorker.controller
    )
      waiting();
  });
  try {
    show('Verifying public offline resources…');
    registration = await navigator.serviceWorker.register(
      new URL('./offline-worker.js', import.meta.url),
      { type: 'module', scope: './', updateViaCache: 'none' },
    );
    const watch = (worker) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'redundant')
          fail(
            'Candidate worker became redundant. Check HTTP, CSP, MIME and resource checksums.',
          );
        else if (worker.state === 'installed' && registration.waiting)
          waiting();
        else if (worker.state === 'activated')
          show(
            'Offline ready. Public game assets are available without a network connection.',
          );
      });
    };
    watch(registration.installing);
    registration.addEventListener('updatefound', () =>
      watch(registration.installing),
    );
    if (registration.waiting) waiting();
    else if (registration.active)
      show(
        'Offline ready. Public game assets are available without a network connection.',
      );
  } catch (error) {
    fail(error);
  }
  update.addEventListener('click', async () => {
    try {
      if (!registration)
        throw new Error(
          'No registration is available; reload to retry installation.',
        );
      show('Checking offline update…');
      await registration.update();
      if (registration.waiting) waiting();
      else if (!registration.installing) show('Offline version is current.');
    } catch (error) {
      fail(error);
    }
  });
  remove.addEventListener('click', async () => {
    try {
      if (!registration)
        throw new Error('No offline registration is available.');
      await registration.unregister();
      const prefix = `xyz-offline:${registration.scope}:`;
      for (const name of await caches.keys())
        if (name.startsWith(prefix)) await caches.delete(name);
      show(
        'Offline installation removed. Close this tab before navigating offline. Game saves were not changed.',
      );
      update.disabled = remove.disabled = true;
    } catch (error) {
      fail(error);
    }
  });
}
