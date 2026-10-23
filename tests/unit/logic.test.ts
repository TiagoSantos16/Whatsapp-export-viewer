import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse, attachmentNames } from "../../src/import/parser";
import {
  normalize,
  matchPath,
  safePath,
  hash,
  messageSide,
} from "../../src/utils/core";
import { merge } from "../../src/import/merge";
const fixture = (name: string) =>
  readFileSync(new URL("../fixtures/" + name, import.meta.url), "utf8");
describe("parser", () => {
  it("retains the exact original sender separately from structural recognition", () => {
    const p = parse("21/10/2026, 18:00 - Ana\u00a0Silva: Olá");
    expect(p.messages[0].author).toBe("Ana Silva");
    expect(p.messages[0].originalAuthor).toBe("Ana\u00a0Silva");
  });
  it("uses the longest explicitly known sender and preserves Unicode payload", () => {
    const p = parse(
      "\u200e21/10/2026, 18:00 - Ana: Trabalho: \u200fOlá\r\nOutra linha",
      "DMY",
      ["Ana: Trabalho"],
    );
    expect(p.messages[0].author).toBe("Ana: Trabalho");
    expect(p.messages[0].text).toBe("\u200fOlá\r\nOutra linha");
  });
  it("preserves Android, multiline, author and source lines", () => {
    const p = parse(fixture("android.txt"));
    expect(p.messages).toHaveLength(4);
    expect(p.messages[1].text).toContain("\nEsta mensagem");
    expect(p.messages[1].lineEnd).toBe(3);
    expect(p.messages[0].date?.key).toBe("2026-10-21T18:42:00");
  });
  it("handles iPhone, 12h English, Unicode structure and orphan content", () => {
    const p = parse(fixture("iphone.txt"));
    expect(p.order).toBe("MDY");
    expect(p.messages).toHaveLength(5);
    expect(p.messages[0].kind).toBe("unrecognized");
    expect(p.messages[1].date?.hour).toBe(18);
    expect(p.messages[1].author).toBe("+351 900 000 000");
    expect(p.messages[3].kind).toBe("system");
  });
  it("asks ambiguous dates and parses explicit order deterministically", () => {
    expect(parse("01/02/26, 12:00 - Ana: x").ambiguous).toBe(true);
    expect(
      parse("01/02/26, 12:00 - Ana: x", "MDY").messages[0].date?.month,
    ).toBe(1);
  });
  it.each([
    "21.10.26, 6:00 AM - Ana: x",
    "21-10-2026, 06:00 - Ana: x",
    "[21/10/2026, 6:00:00\u202fAM] Ana: x",
  ])("supports %s", (s) => {
    expect(parse(s).messages[0].date?.hour).toBe(6);
  });
  it("keeps invalid headers, HTML and Unicode content as data", () => {
    const p = parse(
      "\ufeff21/10/2026, 18:00 - Ana: <script>x</script>\u200f\r\n31/02/2026, 18:00 - not valid\r\nhello",
    );
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].text).toContain("\u200f");
    expect(p.messages[0].text).toContain("31/02");
  });
  it("does not split arbitrary colons in messages", () => {
    expect(
      parse("21/10/2026, 18:00 - Ana: URL: https://example.com").messages[0]
        .text,
    ).toBe("URL: https://example.com");
  });
  it("preserves legitimate repetitions and equal timestamps", () => {
    const p = parse(
      "21/10/2026, 18:00 - Ana: Sim\n21/10/2026, 18:00 - Ana: Sim",
    );
    expect(p.messages).toHaveLength(2);
    expect(merge(p.messages, p.messages).additions).toHaveLength(2);
  });
  it("recognizes attachments in both languages", () => {
    expect(
      attachmentNames(
        "a.png (file attached)\n<anexado: pasta/b.pdf>\nc.mp3 (ficheiro anexado)",
      ),
    ).toEqual(["a.png", "pasta/b.pdf", "c.mp3"]);
  });
});
describe("conservative merge", () => {
  it("does not erase case or accent differences when matching", () => {
    const a = parse(
      "21/10/2026, 18:00 - Ana: avó\n21/10/2026, 18:01 - Ana: Sim\n21/10/2026, 18:02 - Ana: Fim",
    ).messages;
    const b = parse(
      "21/10/2026, 18:00 - Ana: avô\n21/10/2026, 18:01 - Ana: sim\n21/10/2026, 18:02 - Ana: Fim",
    ).messages;
    expect(merge(a, b).additions).toHaveLength(3);
  });
  it("preserves both internal orders across backward timestamps", () => {
    const a = parse(
      "21/10/2026, 19:00 - Ana: a\n21/10/2026, 18:00 - Ana: b",
    ).messages.map((m, i) => ({ ...m, id: "a" + i }));
    const b = parse(
      "21/10/2026, 17:00 - Ana: c\n21/10/2026, 16:00 - Ana: d",
    ).messages.map((m, i) => ({ ...m, id: "b" + i }));
    const result = merge(a, b).combined.map((m) => m.id);
    expect(result.indexOf("a0")).toBeLessThan(result.indexOf("a1"));
    expect(result.indexOf("b0")).toBeLessThan(result.indexOf("b1"));
  });
  it("anchors unique overlapping runs", () => {
    const a = parse(fixture("android.txt")).messages.map((m, i) => ({
      ...m,
      id: "old" + i,
    }));
    const b = parse(fixture("overlap.txt")).messages;
    const r = merge(a, b);
    expect(r.matches.size).toBe(3);
    expect(r.additions).toHaveLength(1);
    expect(r.combined).toHaveLength(5);
  });
  it("supports minute/second precision but rejects different explicit seconds", () => {
    const a = parse(fixture("android.txt")).messages;
    const b = a.map((m) => ({
      ...m,
      date: m.date ? { ...m.date, precision: "second" as const } : undefined,
    }));
    expect(merge(a, b).matches.size).toBe(4);
  });
});
describe("paths, search and integrity", () => {
  it("aligns only the explicitly selected identity and keeps system notices centered", () => {
    expect(messageSide({ kind: "message", participantId: "a" }, "a")).toBe(
      "self",
    );
    expect(messageSide({ kind: "message", participantId: "b" }, "a")).toBe(
      "other",
    );
    expect(messageSide({ kind: "message", participantId: "a" })).toBe("other");
    expect(messageSide({ kind: "system", participantId: "a" }, "a")).toBe(
      "system",
    );
  });
  it("prefers exact paths and rejects ambiguous basenames", () => {
    expect(matchPath("a.png", ["p/a.png", "q/a.png"])).toBeUndefined();
    expect(matchPath("p/a.png", ["p/a.png", "q/a.png"])).toBe("p/a.png");
    expect(matchPath("a.png", ["p/a.png"])).toBe("p/a.png");
    expect(() => safePath("../a")).toThrow();
  });
  it("normalizes accents without mutating original data", () =>
    expect(normalize("AÇÃO João")).toBe("acao joao"));
  it("detects identical files and changed bytes", async () => {
    expect(await hash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await hash("abc")).not.toBe(await hash("abd"));
  });
  it("parses 50 000 generated messages without truncation", () => {
    const text = Array.from(
      { length: 50000 },
      (_, i) => `21/10/2026, 18:00 - ${i % 2 ? "Ana" : "João"}: Mensagem ${i}`,
    ).join("\n");
    const p = parse(text);
    expect(p.messages).toHaveLength(50000);
    expect(p.messages.at(-1)?.position).toBe(49999);
  });
});
