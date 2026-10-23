import { describe, expect, it } from "vitest";
import { verifyEntry, validateMetadata } from "../../src/backup/validation";
import { hash } from "../../src/utils/core";
import type { Conversation, Participant, ImportSource } from "../../src/types";
const c: Conversation = {
  id: "c",
  name: "Synthetic",
  kind: "individual",
  selfId: "p",
  lastDate: "",
  preview: "",
  messageCount: 0,
};
const p: Participant = { id: "p", conversationId: "c", name: "Ana" };
const s: ImportSource = {
  id: "s",
  conversationId: "c",
  hash: "a".repeat(64),
  name: "synthetic.txt",
  text: "",
  warnings: [],
  status: "complete",
  exporterId: "p",
  created: "2026-10-21",
};
describe("backup validation", () => {
  it("accepts intact UTF-8 bytes and rejects changed bytes or size", async () => {
    const blob = new Blob(["João\n🌿"]);
    const spec = { size: blob.size, hash: await hash(blob) };
    await expect(verifyEntry(blob, spec)).resolves.toBeUndefined();
    await expect(verifyEntry(new Blob(["Joao\n🌿"]), spec)).rejects.toThrow();
    await expect(verifyEntry(blob, { ...spec, size: 0 })).rejects.toThrow();
  });
  it("validates entity references before publication", () => {
    expect(() => validateMetadata([c], [p], [], [s], [])).not.toThrow();
    expect(() =>
      validateMetadata([{ ...c, selfId: "unknown" }], [p], [], [s], []),
    ).toThrow();
    expect(() =>
      validateMetadata([c], [p], [], [{ ...s, conversationId: "missing" }], []),
    ).toThrow();
    expect(() =>
      validateMetadata([c], [{ ...p, id: "c" }], [], [s], []),
    ).toThrow();
  });
  it("rejects cross-conversation aliases and traversal paths", () => {
    expect(() =>
      validateMetadata(
        [c],
        [p],
        [
          {
            id: "alias",
            conversationId: "absent",
            original: "Ana",
            participantId: "p",
          },
        ],
        [s],
        [],
      ),
    ).toThrow();
    expect(() =>
      validateMetadata(
        [c],
        [p],
        [],
        [s],
        [
          {
            id: "a",
            conversationId: "c",
            sourceId: "s",
            path: "../bad",
            mime: "image/png",
            size: 0,
            hash: "b".repeat(64),
          },
        ],
      ),
    ).toThrow();
  });
});
