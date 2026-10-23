import { db, discard, messagesFor } from "../storage/db";
import type {
  Conversation,
  Participant,
  Alias,
  Message,
  Prepared,
  Attachment,
} from "../types";
import { hash, matchPath, mime, uid } from "../utils/core";
import { request } from "./client";
import { merge, matchSource } from "./merge";
import { withArchiveLock } from "../storage/lock";
export type ImportConfig = {
  name: string;
  kind: "individual" | "group";
  self: string;
  exporter: string;
  target: string;
  media: boolean;
  aliases: Record<string, string>;
};
export async function planImport(prepared: Prepared, config: ImportConfig) {
  const old = config.target ? await messagesFor(config.target) : [];
  old.sort((a, b) => a.position - b.position);
  const duplicate = (
    await (await db).getAllFromIndex("imports", "hash", prepared.hash)
  ).find((s) => s.status === "complete");
  if (duplicate)
    return {
      combined: old,
      additions: [],
      matches: matchSource(old, prepared.parsed.messages, duplicate.id),
      ambiguous: 0,
    };
  const mapped = prepared.parsed.messages.map((m) => ({
    ...m,
    participantId: m.author ? config.aliases[m.author] || m.author : undefined,
  }));
  return merge(old, mapped);
}
export async function saveImport(
  p: Prepared,
  c: ImportConfig,
  progress: (s: string) => void,
  signal: AbortSignal,
) {
  return withArchiveLock(() => performImport(p, c, progress, signal));
}
async function performImport(
  p: Prepared,
  c: ImportConfig,
  progress: (s: string) => void,
  signal: AbortSignal,
) {
  const d = await db;
  const duplicate = (await d.getAllFromIndex("imports", "hash", p.hash)).find(
    (x) => x.status === "complete",
  );
  if (duplicate && !c.media) return duplicate.conversationId;
  if (duplicate) c.target = duplicate.conversationId;
  const sourceId = uid(),
    conversationId = c.target || uid();
  let conv: Conversation | undefined = c.target
    ? await d.get("conversations", c.target)
    : undefined;
  if (c.target && !conv) throw Error("Conversa de destino inexistente.");
  const people: Participant[] = [],
    aliases: Alias[] = [];
  const mapping: Record<string, string> = {};
  for (const author of p.parsed.authors) {
    let participantId = c.aliases[author];
    if (!participantId) {
      participantId = uid();
      people.push({ id: participantId, conversationId, name: author });
    }
    mapping[author] = participantId;
    aliases.push({
      id: uid(),
      conversationId,
      original: author,
      participantId,
    });
  }
  const incoming = p.parsed.messages.map((m) => ({
    ...m,
    id: uid(),
    sourceId,
    conversationId,
    participantId: m.author ? mapping[m.author] : undefined,
  }));
  const existing = conv ? await messagesFor(conversationId) : [];
  existing.sort((a, b) => a.position - b.position);
  const merged = merge(existing, incoming);
  if (duplicate) {
    merged.combined = existing;
    merged.additions = [];
    merged.matches = matchSource(existing, incoming, duplicate.id);
    if (merged.matches.size !== incoming.length)
      throw Error(
        "Não foi possível confirmar a que mensagens pertencem as linhas desta origem.",
      );
  }
  const warnings = [...p.parsed.warnings];
  if (merged.ambiguous)
    warnings.push(
      `${merged.ambiguous} correspondências ambíguas conservadas como mensagens separadas.`,
    );
  if (c.target && !merged.matches.size)
    warnings.push(
      "Não foi encontrada uma sequência de mensagens que permita ligar as duas exportações com segurança. Este trecho mantém a referência à origem. A ordenação usa as datas locais quando estão disponíveis.",
    );
  const source = {
    id: sourceId,
    conversationId,
    hash: p.hash,
    name: p.name,
    text: p.text,
    status: "pending" as const,
    warnings,
    exporterId: mapping[c.exporter] || c.exporter || undefined,
    created: new Date().toISOString(),
  };
  await d.put("imports", source);
  try {
    const check = () => {
      if (signal.aborted) throw Error("Importação cancelada.");
    };
    check();
    const stagedAttachments: Attachment[] = [];
    if (duplicate) {
      const keys = await d.getAllKeysFromIndex(
        "attachments",
        "conversation",
        conversationId,
      );
      for (const key of keys) {
        const a = await d.get("attachments", key);
        if (a) stagedAttachments.push({ ...a, blob: new Blob() });
      }
    }
    if (c.media) {
      for (let i = 0; i < p.paths.length; i++) {
        check();
        const path = p.paths[i];
        if (duplicate && stagedAttachments.some((a) => a.path === path))
          continue;
        progress(`Anexos · ${i + 1} de ${p.paths.length}`);
        const blob = await request<Blob>("extract", { path });
        check();
        const attachment: Attachment = {
          id: uid(),
          conversationId,
          sourceId,
          path,
          mime: mime(path),
          size: blob.size,
          blob,
          hash: await hash(blob),
        };
        await d.put("attachments", {
          ...attachment,
          conversationId: `pending:${sourceId}`,
        });
        stagedAttachments.push({ ...attachment, blob: new Blob() });
      }
    }
    const updates = new Map<string, Message>();
    for (let i = 0; i < incoming.length; i++) {
      const m = incoming[i];
      const matched = merged.matches.get(i);
      const ids = m.attachmentNames.flatMap((n) => {
        const path = matchPath(n, p.paths);
        const a = stagedAttachments.find((x) => x.path === path);
        return a ? [a.id] : [];
      });
      if (matched) {
        const safeIds =
          m.attachmentNames.length && (duplicate || m.text === matched.text)
            ? ids
            : [];
        updates.set(matched.id, {
          ...matched,
          sourceRefs: [
            ...(matched.sourceRefs || [
              {
                sourceId: matched.sourceId,
                lineStart: matched.lineStart,
                lineEnd: matched.lineEnd,
              },
            ]),
            { sourceId, lineStart: m.lineStart, lineEnd: m.lineEnd },
          ],
          attachmentIds: [...new Set([...matched.attachmentIds, ...safeIds])],
        });
      } else m.attachmentIds = ids;
    }
    const additions = merged.additions;
    const linked = new Set(
      incoming.flatMap((m, i) =>
        merged.matches.has(i)
          ? updates.get(merged.matches.get(i)!.id)?.attachmentIds || []
          : m.attachmentIds,
      ),
    );
    const unlinked = stagedAttachments.filter(
      (a) => a.sourceId === sourceId && !linked.has(a.id),
    );
    if (unlinked.length)
      warnings.push(
        `${unlinked.length} anexos guardados sem mensagem associada. Não foram colocados no histórico.`,
      );
    for (const name of new Set(incoming.flatMap((m) => m.attachmentNames))) {
      if (
        !matchPath(name, p.paths) &&
        p.paths.filter(
          (path) => path.split("/").pop() === name.split("/").pop(),
        ).length > 1
      )
        warnings.push(
          `Nome de anexo ambíguo: ${name}. Nenhum ficheiro foi escolhido.`,
        );
    }
    for (let i = 0; i < additions.length; i += 250) {
      check();
      progress(
        `Gravação · ${Math.min(i + 250, additions.length)} de ${additions.length}`,
      );
      const tx = d.transaction("messages", "readwrite");
      for (const m of additions.slice(i, i + 250))
        await tx.store.put({ ...m, conversationId: `pending:${sourceId}` });
      await tx.done;
    }
    check();
    const last = merged.combined.at(-1);
    conv = conv || {
      id: conversationId,
      name: c.name,
      kind: c.kind,
      lastDate: "",
      preview: "",
      messageCount: 0,
    };
    conv = {
      ...conv,
      name: c.name,
      kind: c.kind,
      selfId: mapping[c.self] || c.self || conv.selfId,
      lastDate: last?.date?.key || "",
      preview: last?.text || "",
      messageCount: merged.combined.length,
    };
    // Publish the conversation and changes to existing messages in one transaction.
    const tx = d.transaction(
      [
        "conversations",
        "participants",
        "participantAliases",
        "messages",
        "imports",
        "attachments",
      ],
      "readwrite",
    );
    const onAbort = () => tx.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      for (const a of stagedAttachments)
        if (a.sourceId === sourceId) {
          const stored = await tx.objectStore("attachments").get(a.id);
          if (stored)
            await tx
              .objectStore("attachments")
              .put({ ...stored, conversationId });
        }
      for (let i = 0; i < merged.combined.length; i++) {
        const m = merged.combined[i];
        await tx
          .objectStore("messages")
          .put({ ...(updates.get(m.id) || m), position: i });
      }
      for (const person of people)
        await tx.objectStore("participants").put(person);
      for (const alias of aliases)
        await tx.objectStore("participantAliases").put(alias);
      await tx.objectStore("imports").put({ ...source, status: "complete" });
      await tx.objectStore("conversations").put(conv);
      await tx.done;
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* Transaction already aborted. */
      }
      await tx.done.catch(() => {});
      throw e;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    return conversationId;
  } catch (e) {
    await discard(sourceId);
    throw e;
  }
}
