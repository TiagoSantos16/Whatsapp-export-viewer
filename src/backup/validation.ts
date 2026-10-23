import type {
  Conversation,
  Participant,
  Alias,
  ImportSource,
  Attachment,
} from "../types";
import { hash, safePath } from "../utils/core";

export async function verifyEntry(
  blob: Blob,
  spec: { size: number; hash: string },
) {
  if (
    !Number.isSafeInteger(spec.size) ||
    spec.size < 0 ||
    !/^[a-f0-9]{64}$/.test(spec.hash) ||
    blob.size !== spec.size ||
    (await hash(blob)) !== spec.hash
  )
    throw Error("A integridade da cópia é inválida.");
}

export function validateMetadata(
  convs: Conversation[],
  people: Participant[],
  aliases: Alias[],
  sources: ImportSource[],
  attachments: Omit<Attachment, "blob">[],
) {
  function require(condition: unknown): asserts condition {
    if (!condition) throw Error("Estrutura ou referência inválida na cópia.");
  }
  const lists = [convs, people, aliases, sources, attachments];
  require(lists.every(Array.isArray));
  const ids = new Set<string>();
  for (const list of lists)
    for (const item of list) {
      require(
        item &&
          typeof item.id === "string" &&
          item.id.length > 0 &&
          !ids.has(item.id),
      );
      ids.add(item.id);
    }
  const cs = new Map(convs.map((c) => [c.id, c])),
    ps = new Map(people.map((p) => [p.id, p])),
    ss = new Map(sources.map((s) => [s.id, s]));
  for (const c of convs) {
    require(
      typeof c.name === "string" &&
        ["individual", "group"].includes(c.kind) &&
        Number.isSafeInteger(c.messageCount) &&
        c.messageCount >= 0 &&
        typeof c.lastDate === "string" &&
        typeof c.preview === "string",
    );
    if (c.selfId) require(ps.get(c.selfId)?.conversationId === c.id);
  }
  for (const p of people)
    require(cs.has(p.conversationId) && typeof p.name === "string");
  for (const a of aliases)
    require(
      cs.has(a.conversationId) &&
        typeof a.original === "string" &&
        ps.get(a.participantId)?.conversationId === a.conversationId,
    );
  for (const s of sources) {
    require(
      cs.has(s.conversationId) &&
        typeof s.name === "string" &&
        typeof s.hash === "string" &&
        /^[a-f0-9]{64}$/.test(s.hash) &&
        Array.isArray(s.warnings) &&
        s.warnings.every((w) => typeof w === "string"),
    );
    if (s.exporterId)
      require(ps.get(s.exporterId)?.conversationId === s.conversationId);
  }
  for (const a of attachments) {
    require(
      cs.has(a.conversationId) &&
        ss.get(a.sourceId)?.conversationId === a.conversationId &&
        typeof a.path === "string" &&
        typeof a.mime === "string" &&
        Number.isSafeInteger(a.size) &&
        a.size >= 0 &&
        /^[a-f0-9]{64}$/.test(a.hash),
    );
    safePath(a.path);
  }
}
