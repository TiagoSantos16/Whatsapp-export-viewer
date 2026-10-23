import { findMatches } from "../search/matching";
import { richText } from "./dom";
export function appendHighlighted(
  container: HTMLElement,
  text: string,
  query: string,
  formatted = true,
) {
  container.append(formatted ? richText(text) : document.createTextNode(text));
  if (!query.trim()) return;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) nodes.push(n as Text);
  const matches = findMatches(nodes.map((n) => n.data).join(""), query);
  let offset = 0;
  for (const node of nodes) {
    const value = node.data,
      fragment = document.createDocumentFragment();
    let from = 0;
    for (const hit of matches) {
      const start = Math.max(0, hit.start - offset),
        end = Math.min(value.length, hit.end - offset);
      if (start >= end) continue;
      fragment.append(document.createTextNode(value.slice(from, start)));
      const mark = document.createElement("mark");
      mark.textContent = value.slice(start, end);
      fragment.append(mark);
      from = end;
    }
    fragment.append(document.createTextNode(value.slice(from)));
    offset += value.length;
    node.replaceWith(fragment);
  }
}
