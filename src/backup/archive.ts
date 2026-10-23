import { Zip, ZipPassThrough } from "fflate";
import { db, conversations, messagesFor, discard } from "../storage/db";
import { hash, uid, limits } from "../utils/core";
import { request } from "../import/client";
import { validateMetadata, verifyEntry } from "./validation";
import { withArchiveLock } from "../storage/lock";
import type {
  Conversation,
  Participant,
  Alias,
  ImportSource,
  Message,
  Attachment,
} from "../types";
type Entry = {
  path: string;
  size: number;
  hash: string;
};
type Manifest = {
  format: "chat-archive";
  version: 1;
  created: string;
  entries: Entry[];
};
export async function exportBackup(progress: (s: string) => void) {
  return withArchiveLock(() => performExport(progress));
}
async function performExport(progress: (s: string) => void) {
  const d = await db;
  const parts: Uint8Array[] = [];
  const zip = new Zip((err, data) => {
    if (err) throw err;
    parts.push(data);
  });
  const entries: Entry[] = [];
  let totalBytes = 0;
  async function add(path: string, data: Blob | string) {
    const bytes =
      typeof data === "string"
        ? new TextEncoder().encode(data)
        : new Uint8Array(await data.arrayBuffer());
    totalBytes += bytes.length;
    if (
      bytes.length > limits.entryBytes ||
      totalBytes > limits.totalBytes - 1048576 ||
      entries.length + 2 > limits.entries
    )
      throw Error(
        "O arquivo excede os limites do formato de cópia. Conserva as exportações originais fora da aplicação.",
      );
    entries.push({ path, size: bytes.length, hash: await hash(bytes) });
    const f = new ZipPassThrough(path);
    zip.add(f);
    f.push(bytes, true);
  }
  const convs = await conversations();
  const ids = new Set(convs.map((c) => c.id));
  const sourceKeys = await d.getAllKeysFromIndex(
    "imports",
    "status",
    "complete",
  );
  const sources: ImportSource[] = [];
  for (const id of sourceKeys) {
    const s = await d.get("imports", id);
    if (s && ids.has(s.conversationId)) sources.push({ ...s, text: "" });
  }
  await add("conversations.json", JSON.stringify(convs));
  await add(
    "participants.json",
    JSON.stringify(
      (await d.getAll("participants")).filter((p) => ids.has(p.conversationId)),
    ),
  );
  await add(
    "aliases.json",
    JSON.stringify(
      (await d.getAll("participantAliases")).filter((p) =>
        ids.has(p.conversationId),
      ),
    ),
  );
  await add(
    "sources.json",
    JSON.stringify(sources.map((s) => ({ ...s, text: "" }))),
  );
  await add(
    "settings.json",
    JSON.stringify({ theme: await d.get("settings", "theme") }),
  );
  for (const source of sources) {
    const original = await d.get("imports", source.id);
    if (!original) throw Error("Texto original em falta.");
    await add(`sources/${source.id}.txt`, original.text);
  }
  const attachmentMeta: Omit<Attachment, "blob">[] = [];
  for (const c of convs) {
    progress(`Cópia · ${c.name}`);
    const messages = await messagesFor(c.id);
    messages.sort((a, b) => a.position - b.position);
    await add(
      `messages/${c.id}.jsonl`,
      messages.map((m) => JSON.stringify(m)).join("\n"),
    );
    const keys = await d.getAllKeysFromIndex(
      "attachments",
      "conversation",
      c.id,
    );
    for (const id of keys) {
      const a = await d.get("attachments", id);
      if (!a) continue;
      const { blob, ...meta } = a;
      attachmentMeta.push(meta);
      await add(`attachments/${a.id}.bin`, blob);
    }
  }
  await add("attachments.json", JSON.stringify(attachmentMeta));
  const manifest: Manifest = {
    format: "chat-archive",
    version: 1,
    created: new Date().toISOString(),
    entries,
  };
  const m = new ZipPassThrough("manifest.json");
  zip.add(m);
  m.push(new TextEncoder().encode(JSON.stringify(manifest)), true);
  zip.end();
  const output = new Blob(parts as BlobPart[], { type: "application/zip" });
  if (output.size > limits.inputBytes)
    throw Error("A cópia excede o tamanho máximo suportado pelo restauro.");
  await d.put("settings", manifest.created, "lastBackup");
  return output;
}
export async function restoreBackup(file: File, progress: (s: string) => void) {
  return withArchiveLock(() => performRestore(file, progress));
}
async function performRestore(file: File, progress: (s: string) => void) {
  const d = await db;
  const paths = await request<string[]>("backupInspect", { file });
  if (!paths.includes("manifest.json"))
    throw Error("Esta não é uma cópia Chat Archive.");
  const extract = (path: string) => request<Blob>("extract", { path });
  const manifest = JSON.parse(
    await (await extract("manifest.json")).text(),
  ) as Manifest;
  if (
    manifest.format !== "chat-archive" ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.entries)
  )
    throw Error("Formato ou versão de cópia não suportado.");
  if (
    manifest.entries.length > limits.entries ||
    new Set(manifest.entries.map((e) => e.path)).size !==
      manifest.entries.length
  )
    throw Error("Manifesto inválido.");
  const checked = new Set<string>();
  async function get(path: string) {
    const spec = manifest.entries.find((e) => e.path === path);
    if (!spec || !paths.includes(path))
      throw Error(`Ficheiro em falta: ${path}`);
    const b = await extract(path);
    await verifyEntry(b, spec);
    checked.add(path);
    return b;
  }
  async function json<T>(path: string) {
    return JSON.parse(await (await get(path)).text()) as T;
  }
  const convs = await json<Conversation[]>("conversations.json");
  const people = await json<Participant[]>("participants.json");
  const aliases = await json<Alias[]>("aliases.json");
  const sources = await json<ImportSource[]>("sources.json");
  const attachments =
    await json<Omit<Attachment, "blob">[]>("attachments.json");
  const settings = await json<{
    theme?: string;
  }>("settings.json");
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    throw Error("Definições inválidas na cópia.");
  validateMetadata(convs, people, aliases, sources, attachments);
  const map = new Map<string, string>();
  for (const list of [convs, people, aliases, sources, attachments]) {
    if (!Array.isArray(list)) throw Error("Estrutura de cópia inválida.");
    for (const x of list) {
      if (typeof x.id !== "string" || map.has(x.id))
        throw Error("Identificador inválido ou repetido.");
      map.set(x.id, uid());
    }
  }
  const remap = (id: string) => {
    const mapped = map.get(id);
    if (!mapped) throw Error("Referência inválida na cópia.");
    return mapped;
  };
  const convSet = new Set(convs.map((c) => c.id)),
    personSet = new Set(people.map((p) => p.id)),
    sourceSet = new Set(sources.map((s) => s.id)),
    attachmentSet = new Set(attachments.map((a) => a.id));
  for (const x of [...people, ...aliases, ...sources, ...attachments])
    if (!convSet.has(x.conversationId))
      throw Error("Conversa de referência ausente.");
  for (const a of aliases)
    if (!personSet.has(a.participantId)) throw Error("Alias inválido.");
  const staged: string[] = [];
  try {
    for (const s of sources) {
      const text = await (await get(`sources/${s.id}.txt`)).text();
      const id = remap(s.id);
      await d.put("imports", {
        ...s,
        id,
        conversationId: remap(s.conversationId),
        exporterId: s.exporterId ? remap(s.exporterId) : undefined,
        text,
        status: "pending",
      });
      staged.push(id);
    }
    for (const a of attachments) {
      progress("Restauro · anexos");
      if (!sourceSet.has(a.sourceId)) throw Error("Origem de anexo inválida.");
      const blob = await get(`attachments/${a.id}.bin`);
      if (blob.size !== a.size || (await hash(blob)) !== a.hash)
        throw Error("Anexo corrompido.");
      await d.put("attachments", {
        ...a,
        id: remap(a.id),
        conversationId: remap(a.conversationId),
        sourceId: remap(a.sourceId),
        blob,
      });
    }
    for (const c of convs) {
      progress(`Restauro · ${c.name}`);
      const text = await (await get(`messages/${c.id}.jsonl`)).text();
      const lines = text ? text.split("\n") : [];
      if (lines.length !== c.messageCount || lines.length > limits.messages)
        throw Error("Contagem de mensagens inválida.");
      const seen = new Set<number>();
      for (let i = 0; i < lines.length; i += 250) {
        const tx = d.transaction("messages", "readwrite");
        for (const line of lines.slice(i, i + 250)) {
          const m = JSON.parse(line) as Message;
          if (
            m.conversationId !== c.id ||
            sources.find((s) => s.id === m.sourceId)?.conversationId !== c.id ||
            typeof m.text !== "string" ||
            !Number.isInteger(m.position) ||
            seen.has(m.position) ||
            m.position < 0 ||
            m.position >= lines.length
          )
            throw Error("Mensagem inválida.");
          seen.add(m.position);
          if (
            m.participantId &&
            people.find((p) => p.id === m.participantId)?.conversationId !==
              c.id
          )
            throw Error("Autor inválido.");
          if (
            !Array.isArray(m.attachmentIds) ||
            m.attachmentIds.some(
              (id) =>
                attachments.find((a) => a.id === id)?.conversationId !== c.id,
            )
          )
            throw Error("Referência de anexo inválida.");
          const id = uid();
          if (map.has(m.id)) throw Error("Mensagem repetida.");
          map.set(m.id, id);
          if (
            m.sourceRefs?.some(
              (r) =>
                sources.find((s) => s.id === r.sourceId)?.conversationId !==
                c.id,
            )
          )
            throw Error("Proveniência inválida.");
          await tx.store.put({
            ...m,
            id,
            conversationId: remap(c.id),
            sourceId: remap(m.sourceId),
            sourceRefs: m.sourceRefs?.map((r) => ({
              ...r,
              sourceId: remap(r.sourceId),
            })),
            participantId: m.participantId ? remap(m.participantId) : undefined,
            attachmentIds: m.attachmentIds.map(remap),
          });
        }
        await tx.done;
      }
    }
    // Check unreferenced entries too before publishing any restored conversations.
    for (const entry of manifest.entries)
      if (!checked.has(entry.path)) await get(entry.path);
    const tx = d.transaction(
      [
        "conversations",
        "participants",
        "participantAliases",
        "imports",
        "settings",
      ],
      "readwrite",
    );
    try {
      for (const p of people)
        await tx.objectStore("participants").put({
          ...p,
          id: remap(p.id),
          conversationId: remap(p.conversationId),
        });
      for (const a of aliases)
        await tx.objectStore("participantAliases").put({
          ...a,
          id: remap(a.id),
          conversationId: remap(a.conversationId),
          participantId: remap(a.participantId),
        });
      for (const c of convs)
        await tx.objectStore("conversations").put({
          ...c,
          id: remap(c.id),
          selfId: c.selfId ? remap(c.selfId) : undefined,
          read:
            c.read && map.has(c.read.id)
              ? { ...c.read, id: remap(c.read.id) }
              : undefined,
        });
      for (const id of staged) {
        const s = await tx.objectStore("imports").get(id);
        if (s)
          await tx.objectStore("imports").put({ ...s, status: "complete" });
      }
      if (
        ["light", "dark", "system"].includes(settings.theme || "") &&
        !(await tx.objectStore("settings").get("theme"))
      )
        await tx.objectStore("settings").put(settings.theme, "theme");
      await tx.done;
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* Already aborted. */
      }
      await tx.done.catch(() => {});
      throw e;
    }
  } catch (e) {
    for (const id of staged) await discard(id);
    throw e;
  }
}
