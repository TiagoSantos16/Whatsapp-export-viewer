import { zipSync, strToU8 } from "fflate";
import { hash } from "../../src/utils/core";
import { colorPng } from "./complete";
/** Format-1 fixture using the fields written before presentation and Pages changes. */
export async function legacyBackup() {
  const image = colorPng([80, 140, 90]);
  const original =
    "21/10/2026, 09:00 - Ana: <attached: pasta/legacy.png>\nLegenda antiga.\n21/10/2026, 09:01 - João: Texto final <Esta mensagem foi editada>";
  const date = {
    year: 2026,
    month: 10,
    day: 21,
    hour: 9,
    minute: 0,
    second: 0,
    precision: "minute",
    key: "2026-10-21T09:00:00",
  };
  const base = {
    conversationId: "legacy-conversation",
    sourceId: "legacy-source",
    temporal: "21/10/2026, 09:00 - ",
    kind: "message",
    warnings: [],
  };
  const messages = [
    {
      ...base,
      id: "legacy-m0",
      position: 0,
      lineStart: 1,
      lineEnd: 2,
      date,
      author: "Ana",
      participantId: "ana",
      text: "<attached: pasta/legacy.png>\nLegenda antiga.",
      raw: original.split("\n").slice(0, 2).join("\n"),
      attachmentNames: ["pasta/legacy.png"],
      attachmentIds: ["legacy-attachment"],
    },
    {
      ...base,
      id: "legacy-m1",
      position: 1,
      lineStart: 3,
      lineEnd: 3,
      date: { ...date, minute: 1, key: "2026-10-21T09:01:00" },
      author: "João",
      participantId: "joao",
      text: "Texto final <Esta mensagem foi editada>",
      raw: original.split("\n")[2],
      attachmentNames: [],
      attachmentIds: [],
    },
  ];
  const files: Record<string, Uint8Array> = {
    "conversations.json": strToU8(
      JSON.stringify([
        {
          id: "legacy-conversation",
          name: "Cópia sintética antiga",
          kind: "individual",
          selfId: "joao",
          lastDate: "2026-10-21T09:01:00",
          preview: messages[1].text,
          messageCount: 2,
          read: { id: "legacy-m0", offset: 0 },
        },
      ]),
    ),
    "participants.json": strToU8(
      JSON.stringify([
        { id: "ana", conversationId: "legacy-conversation", name: "Ana" },
        { id: "joao", conversationId: "legacy-conversation", name: "João" },
      ]),
    ),
    "aliases.json": strToU8(
      JSON.stringify([
        {
          id: "alias-ana",
          conversationId: "legacy-conversation",
          original: "Ana",
          participantId: "ana",
        },
        {
          id: "alias-joao",
          conversationId: "legacy-conversation",
          original: "João",
          participantId: "joao",
        },
      ]),
    ),
    "sources.json": strToU8(
      JSON.stringify([
        {
          id: "legacy-source",
          conversationId: "legacy-conversation",
          hash: await hash(original),
          name: "legacy-synthetic.txt",
          text: "",
          status: "complete",
          warnings: [],
          exporterId: "joao",
          created: "2026-10-21T10:00:00.000Z",
        },
      ]),
    ),
    "settings.json": strToU8('{"theme":"system"}'),
    "sources/legacy-source.txt": strToU8(original),
    "messages/legacy-conversation.jsonl": strToU8(
      messages.map((m) => JSON.stringify(m)).join("\n"),
    ),
    "attachments.json": strToU8(
      JSON.stringify([
        {
          id: "legacy-attachment",
          conversationId: "legacy-conversation",
          sourceId: "legacy-source",
          path: "pasta/legacy.png",
          mime: "image/png",
          size: image.length,
          hash: await hash(image),
        },
      ]),
    ),
    "attachments/legacy-attachment.bin": image,
  };
  const entries = await Promise.all(
    Object.entries(files).map(async ([path, data]) => ({
      path,
      size: data.length,
      hash: await hash(data),
    })),
  );
  files["manifest.json"] = strToU8(
    JSON.stringify({
      format: "chat-archive",
      version: 1,
      created: "2026-10-21T10:00:00.000Z",
      entries,
    }),
  );
  return zipSync(files);
}
