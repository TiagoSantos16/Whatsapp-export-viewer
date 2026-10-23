import type { Message } from "../types";
import { normalize } from "../utils/core";

export function matchSource(
  existing: Message[],
  incoming: Message[],
  sourceId: string,
) {
  const lines = new Map<number, Set<Message>>();
  for (const m of existing) {
    const refs = [
      { sourceId: m.sourceId, lineStart: m.lineStart },
      ...(m.sourceRefs || []),
    ];
    for (const ref of refs)
      if (ref.sourceId === sourceId) {
        const set = lines.get(ref.lineStart) || new Set<Message>();
        set.add(m);
        lines.set(ref.lineStart, set);
      }
  }
  const matches = new Map<number, Message>();
  incoming.forEach((m, i) => {
    const found = lines.get(m.lineStart);
    if (found?.size === 1) matches.set(i, [...found][0]);
  });
  return matches;
}

function signature(m: Message) {
  return JSON.stringify([
    m.participantId || normalize(m.author || ""),
    m.date?.key.slice(0, 16),
    m.text.normalize("NFC").replace(/\r\n/g, "\n").replace(/\n+$/g, ""),
  ]);
}
function compatible(a: Message, b: Message) {
  return !(
    a.date?.precision === "second" &&
    b.date?.precision === "second" &&
    a.date.key !== b.date.key
  );
}
// Keep each source in file order, even when its timestamps go backwards.
function interleave(a: Message[], b: Message[]) {
  const out: Message[] = [];
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    if (a[i].date && b[j].date && b[j].date!.key < a[i].date!.key)
      out.push(b[j++]);
    else out.push(a[i++]);
  }
  return out.concat(a.slice(i), b.slice(j));
}
/** Match overlaps only through unique runs of at least three compatible messages. */
export function merge(existing: Message[], incoming: Message[]) {
  const matches = new Map<number, Message>();
  if (!existing.length)
    return {
      combined: [...incoming],
      additions: [...incoming],
      matches,
      ambiguous: 0,
    };
  const a = existing.map(signature),
    b = incoming.map(signature);
  const triples = new Map<string, number[]>(),
    occurrences = new Map<string, number>();
  for (let i = 0; i < a.length - 2; i++) {
    const key = JSON.stringify(a.slice(i, i + 3));
    const old = triples.get(key);
    triples.set(key, old ? [-1, -1] : [i]);
  }
  for (let i = 0; i < b.length - 2; i++) {
    const key = JSON.stringify(b.slice(i, i + 3));
    occurrences.set(key, (occurrences.get(key) || 0) + 1);
  }
  let last = -1;
  for (let i = 0; i < b.length - 2; i++) {
    const key = JSON.stringify(b.slice(i, i + 3)),
      found = triples.get(key);
    if (
      found?.length === 1 &&
      occurrences.get(key) === 1 &&
      found[0] >= last &&
      [0, 1, 2].every((n) =>
        compatible(existing[found[0] + n], incoming[i + n]),
      )
    ) {
      for (let n = 0; n < 3; n++) matches.set(i + n, existing[found[0] + n]);
      last = found[0];
    }
  }
  const positions = new Map(existing.map((m, i) => [m, i]));
  let previous = -1;
  const ordered = () => [...matches].sort((x, y) => x[0] - y[0]);
  for (const [index, m] of ordered()) {
    const at = positions.get(m)!;
    if (at <= previous) matches.delete(index);
    else previous = at;
  }
  const signatures = new Set(a),
    additions = incoming.filter((_, i) => !matches.has(i));
  const ambiguous = incoming.filter(
    (_, i) => !matches.has(i) && signatures.has(b[i]),
  ).length;
  let combined: Message[] = [],
    oldStart = 0,
    newStart = 0;
  for (const [index, m] of ordered()) {
    const at = positions.get(m)!;
    for (const item of interleave(
      existing.slice(oldStart, at),
      incoming.slice(newStart, index),
    ))
      combined.push(item);
    combined.push(m);
    oldStart = at + 1;
    newStart = index + 1;
  }
  combined = combined.concat(
    interleave(existing.slice(oldStart), incoming.slice(newStart)),
  );
  return { combined, additions, matches, ambiguous };
}
