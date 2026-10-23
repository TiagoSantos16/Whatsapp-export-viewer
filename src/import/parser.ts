import type { LocalDate, Message, ParseResult } from "../types";
import { limits } from "../utils/core";
const structural = (s: string) =>
  s
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/[\u00a0\u202f]/g, " ");
const header =
  /^\[?(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?\]?\s*(?:-\s*)?(.*)$/i;
function rawOffset(line: string, normalizedOffset: number) {
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    if (count === normalizedOffset) return i;
    if (!/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(line[i]))
      count++;
  }
  return line.length;
}
export function attachmentNames(text: string) {
  const names: string[] = [];
  for (const m of text.matchAll(
    /<\s*(?:attached|anexado|anexo)\s*:\s*([^>]+)>|([^\n<>]+?)\s*\((?:file attached|ficheiro anexado|arquivo anexado|ficheiro em anexo)\)/gi,
  ))
    names.push((m[1] || m[2]).trim());
  return names;
}
export function parse(
  text: string,
  chosen?: "DMY" | "MDY",
  knownAuthors: string[] = [],
): ParseResult {
  const lines = text.replace(/^\ufeff/, "").split(/\r?\n/);
  const endings = [...text.replace(/^\ufeff/, "").matchAll(/\r?\n/g)].map(
    (m) => m[0],
  );
  let evidence: "DMY" | "MDY" | undefined;
  let conflict = false;
  for (const line of lines) {
    const h = structural(line).match(header);
    if (h) {
      const a = +h[1],
        b = +h[2];
      const e =
        a > 12 && b <= 12 ? "DMY" : b > 12 && a <= 12 ? "MDY" : undefined;
      if (e && evidence && e !== evidence) conflict = true;
      if (e) evidence = e;
    }
  }
  const order = chosen || evidence || "DMY";
  const ambiguous = !chosen && (!evidence || conflict);
  const messages: Message[] = [];
  const authors = new Set<string>(knownAuthors);
  const warnings: string[] = [];
  // Match the longest known name so colons inside names do not split the sender.
  for (const line of lines) {
    const h = structural(line).match(header);
    if (h) {
      const body = h[8];
      const sep = body.indexOf(": ");
      if (sep > 0) authors.add(body.slice(0, sep));
    }
  }
  let current: Message | undefined;
  for (let i = 0; i < lines.length; i++) {
    const original = lines[i];
    const normalized = structural(original);
    const h = normalized.match(header);
    let date: LocalDate | undefined;
    if (h) {
      let year = +h[3];
      if (year < 100) year += year < 70 ? 2000 : 1900;
      const day = +(order === "DMY" ? h[1] : h[2]),
        month = +(order === "DMY" ? h[2] : h[1]);
      let hour = +h[4];
      const minute = +h[5],
        second = +(h[6] || 0);
      const ap = h[7]?.toLowerCase().replace(/\./g, "");
      const validHour = ap ? hour >= 1 && hour <= 12 : hour <= 23;
      if (ap) hour = (hour % 12) + (ap === "pm" ? 12 : 0);
      const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      if (
        month >= 1 &&
        month <= 12 &&
        day >= 1 &&
        day <= maxDay &&
        validHour &&
        minute < 60 &&
        second < 60
      ) {
        const key =
          [
            year,
            String(month).padStart(2, "0"),
            String(day).padStart(2, "0"),
          ].join("-") +
          "T" +
          [hour, minute, second]
            .map((x) => String(x).padStart(2, "0"))
            .join(":");
        date = {
          year,
          month,
          day,
          hour,
          minute,
          second,
          precision: h[6] ? "second" : "minute",
          key,
        };
      }
    }
    if (h && date) {
      const body = h[8];
      const author = [...authors]
        .sort((a, b) => b.length - a.length)
        .find((a) => body.startsWith(a + ": "));
      // Locate the body in the original line without stripping its direction marks.
      const prefixLength = normalized.length - body.length;
      const bodyOffset = rawOffset(original, prefixLength);
      const payload = original.slice(bodyOffset);
      const content = author
        ? original.slice(rawOffset(original, prefixLength + author.length + 2))
        : payload;
      current = {
        id: "",
        conversationId: "",
        sourceId: "",
        position: messages.length,
        lineStart: i + 1,
        lineEnd: i + 1,
        temporal: original.slice(0, original.length - payload.length),
        date,
        author,
        originalAuthor: author
          ? original.slice(
              bodyOffset,
              rawOffset(original, prefixLength + author.length),
            )
          : undefined,
        text: content,
        raw: original,
        kind: author ? "message" : "system",
        attachmentNames: [],
        attachmentIds: [],
        warnings: [],
      };
      messages.push(current);
    } else if (current) {
      current.text += (endings[i - 1] || "\n") + original;
      current.raw += (endings[i - 1] || "\n") + original;
      current.lineEnd = i + 1;
      if (h)
        current.warnings.push(
          "Cabeçalho com data inválida conservado no texto.",
        );
    } else if (original.trim()) {
      current = {
        id: "",
        conversationId: "",
        sourceId: "",
        position: messages.length,
        lineStart: i + 1,
        lineEnd: i + 1,
        temporal: "",
        text: original,
        raw: original,
        kind: "unrecognized",
        attachmentNames: [],
        attachmentIds: [],
        warnings: ["Trecho sem cabeçalho temporal reconhecido."],
      };
      messages.push(current);
    }
    if (messages.length > limits.messages)
      throw Error("Limite de mensagens excedido.");
  }
  for (const m of messages) {
    m.attachmentNames = attachmentNames(m.text);
    if (m.warnings.length) warnings.push(...m.warnings);
  }
  if (ambiguous)
    warnings.push("Confirma a ordem das datas; a exportação é ambígua.");
  if (conflict)
    warnings.push("Existem indicações contraditórias de ordem de data.");
  return {
    messages,
    authors: [
      ...new Set(messages.flatMap((m) => (m.author ? [m.author] : []))),
    ],
    warnings: [...new Set(warnings)],
    ambiguous,
    order,
  };
}
