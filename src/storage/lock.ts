/** Use a shared lock so tabs take turns writing to the archive. */
export async function withArchiveLock<T>(task: () => Promise<T>): Promise<T> {
  if (navigator.locks)
    return await navigator.locks.request("chat-archive-storage", () => task());
  return task();
}
