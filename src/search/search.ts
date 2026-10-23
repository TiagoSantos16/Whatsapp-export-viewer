import { db } from "../storage/db";
import { normalize } from "../utils/core";
import type { Message } from "../types";
import { visibleText } from "../components/presentation";
export async function search(
  query: string,
  conversationId?: string,
  after?: string,
) {
  const needle = normalize(query.trim());
  if (!needle) return { results: [] as Message[], more: false };
  const d = await db;
  const visible = new Set((await d.getAll("conversations")).map((c) => c.id));
  const results: Message[] = [];
  let key = after;
  let done = false;
  while (results.length < 51 && !done) {
    const tx = d.transaction("messages");
    let c = await tx.store.openCursor(
      key ? IDBKeyRange.lowerBound(key, true) : undefined,
    );
    let processed = 0;
    while (c && processed < 500 && results.length < 51) {
      const m = c.value;
      key = c.key;
      if (
        visible.has(m.conversationId) &&
        (!conversationId || m.conversationId === conversationId) &&
        normalize(visibleText(m.text)).includes(needle)
      )
        results.push(m);
      processed++;
      c = await c.continue();
    }
    done = !c;
    await tx.done;
    if (!done) await new Promise((r) => setTimeout(r, 0));
  }
  const more = results.length > 50;
  return {
    results: results.slice(0, 50),
    more,
    after: results[Math.min(results.length, 50) - 1]?.id,
  };
}
export type ConversationHit = {
  id: string;
  position: number;
  occurrences: number;
};
/** Navigate matches in source order, with one stop per message rather than per occurrence. */
export async function conversationMatches(
  query: string,
  conversationId: string,
  signal: AbortSignal,
) {
  const needle = normalize(query.trim()),
    hits: ConversationHit[] = [];
  if (!needle) return hits;
  const d = await db;
  let after = -1;
  let more = true;
  while (more && !signal.aborted) {
    const tx = d.transaction("messages");
    let c = await tx.store
      .index("position")
      .openCursor(
        IDBKeyRange.bound(
          [conversationId, after],
          [conversationId, Number.MAX_SAFE_INTEGER],
          true,
        ),
      );
    let count = 0;
    while (c && count < 500 && !signal.aborted) {
      const m = c.value;
      after = m.position;
      const text = normalize(visibleText(m.text));
      let occurrences = 0,
        at = 0;
      while ((at = text.indexOf(needle, at)) >= 0) {
        occurrences++;
        at += needle.length;
      }
      if (occurrences)
        hits.push({ id: m.id, position: m.position, occurrences });
      count++;
      c = await c.continue();
    }
    more = !!c;
    await tx.done;
    if (more) await new Promise((r) => setTimeout(r, 0));
  }
  return hits;
}
