import { describe, it, expect } from "vitest";
import { presentMessage, visibleText } from "../../src/components/presentation";
import { findMatches, snippet } from "../../src/search/matching";
import { deploymentPaths } from "../../config/paths";
describe("derived message presentation", () => {
  it.each([
    "Esta mensagem foi editada",
    "This message was edited",
    "This message has been edited",
  ])("renders trailing %s without mutating original", (marker) => {
    const text = `Texto final <${marker}>\r\n`;
    const p = presentMessage(text);
    expect(p.text).toBe("Texto final");
    expect(p.edited).toBe(true);
    expect(text).toBe(`Texto final <${marker}>\r\n`);
  });
  it("handles marker-only edits without inventing text", () =>
    expect(presentMessage("<Esta mensagem foi editada>").editOnly).toBe(true));
  it.each([
    "<Ficheiro não revelado>",
    "<Media omitted>",
    "<Imagem omitida>",
    "<Video omitted>",
    "<Áudio omitido>",
    "<Document omitted>",
  ])("recognizes an omitted marker %s", (text) => {
    const p = presentMessage(text + "\nLegenda");
    expect(p.text).toBe("Legenda");
    expect(p.omissions).toHaveLength(1);
  });
  it("keeps quoted, unknown and ordinary HTML-like content", () => {
    for (const text of [
      "Texto <coisa desconhecida>",
      "<script>alert(1)</script>",
      'Disse "<Esta mensagem foi editada>"',
      "> <Esta mensagem foi editada>",
      "A frase <Ficheiro não revelado> faz parte do texto.",
    ])
      expect(presentMessage(text).text).toBe(text);
  });
  it("keeps deletion perspective without replacing words", () => {
    expect(presentMessage("<You deleted this message>").deletion).toBe(
      "You deleted this message",
    );
    expect(
      presentMessage("Ana escreveu: You deleted this message").deletion,
    ).toBeUndefined();
  });
  it("removes only known attachment syntax and preserves captions", () => {
    const p = presentMessage("<attached: pasta/z.png>\nLegenda");
    expect(p.text).toBe("Legenda");
    expect(p.attachmentNames).toEqual(["pasta/z.png"]);
    expect(visibleText("<Imagem omitida>")).toBe("Imagem não incluída");
  });
});
describe("Unicode search offsets", () => {
  it("keeps complete emoji and combining marks at both snippet boundaries", () => {
    const emoji = "a" + "x".repeat(64) + "😀";
    expect(snippet(emoji, "a").text).toBe(emoji);
    const accent = "a" + "x".repeat(64) + "e\u0301";
    expect(snippet(accent, "a").text).toBe(accent);
    const left = "😀" + "x".repeat(64) + "a";
    expect(snippet(left, "a").text).toBe(left);
  });
  it("maps decomposed accents and emoji to exact original ranges", () => {
    const text = "🌿 cafe\u0301 e AÇÃO";
    const hits = findMatches(text, "cafe");
    expect(text.slice(hits[0].start, hits[0].end)).toBe("cafe\u0301");
    const action = findMatches(text, "acao")[0];
    expect(text.slice(action.start, action.end)).toBe("AÇÃO");
  });
  it("centers a snippet on a match far into a long message", () => {
    const text = "antes ".repeat(500) + "agulha" + " depois".repeat(300);
    const excerpt = snippet(text, "agulha");
    expect(excerpt.text).toContain("agulha");
    expect(excerpt.leading && excerpt.trailing).toBe(true);
    expect(excerpt.text.length).toBeLessThan(150);
  });
});
it("supports root and repository deployment paths", () => {
  expect(deploymentPaths("/")).toEqual({ base: "/", app: "/app/" });
  expect(deploymentPaths("/repositorio/")).toEqual({
    base: "/repositorio/",
    app: "/repositorio/app/",
  });
  expect(() => deploymentPaths("https://other.test")).toThrow();
});
