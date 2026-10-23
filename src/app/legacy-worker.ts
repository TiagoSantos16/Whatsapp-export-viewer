/** Inspect only our old script route. Do not sweep registrations or caches on this origin. */
export async function updateLegacyWorker() {
  if (!("serviceWorker" in navigator)) return;
  const base = new URL(import.meta.env.BASE_URL, location.origin);
  const url = new URL("sw.js", base).href;
  const legacy = (await navigator.serviceWorker.getRegistrations()).find(
    (r) =>
      r.scope === base.href &&
      (r.active?.scriptURL === url || r.waiting?.scriptURL === url),
  );
  if (!legacy) return;
  const response = await fetch(url, { cache: "no-store" });
  if (
    response.ok &&
    (await response.text()).startsWith(
      "/* Chat Archive legacy shell transition v1.",
    )
  )
    await legacy.update();
}
