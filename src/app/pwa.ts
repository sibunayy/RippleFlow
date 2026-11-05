/**
 * Registers the service worker (production only) and reports when a new version
 * is installed and waiting. `applyUpdate` makes it take over and reloads.
 */
export function registerServiceWorker(onUpdateReady: (apply: () => void) => void): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  // Reload only when the user asked for the update. The first install also fires
  // controllerchange (the worker claims the page), and that must not reload anything.
  let applying = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (applying) location.reload();
  });
  const offer = (reg: ServiceWorkerRegistration) => {
    const waiting = reg.waiting;
    // No controller means this is the first install: nothing to update from.
    if (waiting && navigator.serviceWorker.controller) onUpdateReady(() => {
        applying = true;
        waiting.postMessage("skip-waiting");
      });
  };
  navigator.serviceWorker
    .register("./sw.js")
    .then((reg) => {
      offer(reg);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w?.addEventListener("statechange", () => {
          if (w.state === "installed") offer(reg);
        });
      });
      // Standalone apps rarely cold-start: check for a new version whenever the app comes back to the foreground.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void reg.update().catch(() => {});
      });
    })
    .catch((e) => console.warn("Service worker registration failed:", e));
}
