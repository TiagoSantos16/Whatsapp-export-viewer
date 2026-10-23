export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
) {
  const n = document.createElement(tag);
  n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}
export function button(text: string, action: () => void, className = "") {
  const b = el("button", className, text);
  b.type = "button";
  b.onclick = action;
  return b;
}
export function field(label: string, input: HTMLElement) {
  const l = el("label", "field");
  input.setAttribute("aria-label", label);
  l.append(el("span", "", label), input);
  return l;
}
export function select(options: [string, string][], value = "") {
  const s = el("select");
  for (const [v, t] of options) {
    const o = el("option", "", t);
    o.value = v;
    s.append(o);
  }
  s.value = value;
  return s;
}
export function input(type = "text", value = "") {
  const i = el("input");
  i.type = type;
  i.value = value;
  return i;
}
export function icon(
  name:
    | "back"
    | "settings"
    | "archive"
    | "menu"
    | "calendar"
    | "up"
    | "down"
    | "close"
    | "file"
    | "image"
    | "audio"
    | "video",
) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute(
    "d",
    {
      back: "M15 5 8 12l7 7",
      settings:
        "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z",
      archive: "M4 8h16v13H4zM3 3h18v5H3zM9 12h6",
      menu: "M12 5h.01M12 12h.01M12 19h.01",
      calendar: "M4 5h16v16H4zM4 10h16M8 3v4M16 3v4",
      up: "m6 15 6-6 6 6",
      down: "m6 9 6 6 6-6",
      close: "m6 6 12 12M6 18 18 6",
      file: "M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6",
      image: "M3 4h18v16H3zM3 16l6-6 5 5 3-3 4 4M16 8h.01",
      audio:
        "M9 18V5l11-2v13M9 8l11-2M9 18c0 3-6 4-6 1s6-4 6-1M20 16c0 3-6 4-6 1s6-4 6-1",
      video: "M3 6h12v12H3zM15 10l6-4v12l-6-4",
    }[name],
  );
  svg.append(path);
  return svg;
}
export function richText(text: string) {
  const fragment = document.createDocumentFragment();
  const pattern =
    /(https?:\/\/[^\s<>]+)|```([\s\S]+?)```|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;
  let from = 0;
  for (const m of text.matchAll(pattern)) {
    fragment.append(document.createTextNode(text.slice(from, m.index)));
    if (m[1]) {
      const a = el("a", "", m[1]);
      a.href = m[1];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      fragment.append(a);
    } else {
      const tag = m[2] ? "code" : m[3] ? "strong" : m[4] ? "em" : "s";
      fragment.append(el(tag, "", m[2] || m[3] || m[4] || m[5]));
    }
    from = m.index! + m[0].length;
  }
  fragment.append(document.createTextNode(text.slice(from)));
  return fragment;
}
