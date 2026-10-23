import { normalize } from "../utils/core";
export type Match = { start: number; end: number };
/** Keep original grapheme boundaries when case and accent folding change offsets. */
export function findMatches(text: string, query: string): Match[] {
  const needle = normalize(query.trim());
  if (!needle) return [];
  const starts: number[] = [],
    ends: number[] = [];
  let folded = "";
  for (const { segment, index } of new Intl.Segmenter("pt", {
    granularity: "grapheme",
  }).segment(text)) {
    const value = normalize(segment);
    folded += value;
    for (let i = 0; i < value.length; i++) {
      starts.push(index);
      ends.push(index + segment.length);
    }
  }
  const matches: Match[] = [];
  let at = 0;
  while ((at = folded.indexOf(needle, at)) >= 0) {
    matches.push({ start: starts[at], end: ends[at + needle.length - 1] });
    at += needle.length;
  }
  return matches;
}
export function snippet(text: string, query: string, radius = 65) {
  const hit = findMatches(text, query)[0];
  const start = Math.max(0, (hit?.start || 0) - radius),
    end = Math.min(text.length, (hit?.end || 0) + radius);
  const segments = new Intl.Segmenter("pt", {
    granularity: "grapheme",
  }).segment(text);
  const left = segments.containing(start)?.index || 0;
  const last = segments.containing(Math.max(0, end - 1));
  const right = last ? last.index + last.segment.length : 0;
  return {
    text: text.slice(left, right),
    leading: left > 0,
    trailing: right < text.length,
  };
}
