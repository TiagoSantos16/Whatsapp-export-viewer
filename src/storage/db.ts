import { openDB, type DBSchema } from "idb";
import { withArchiveLock } from "./lock";
import type {
  Conversation,
  Participant,
  Alias,
  Message,
  Attachment,
  ImportSource,
} from "../types";
interface Schema extends DBSchema {
  conversations: {
    key: string;
    value: Conversation;
  };
  participants: {
    key: string;
    value: Participant;
    indexes: {
      conversation: string;
    };
  };
  participantAliases: {
    key: string;
    value: Alias;
    indexes: {
      conversation: string;
    };
  };
  messages: {
    key: string;
    value: Message;
    indexes: {
      conversation: string;
      position: [string, number];
      participant: string;
      date: [string, string];
    };
  };
  attachments: {
    key: string;
    value: Attachment;
    indexes: {
      conversation: string;
      source: string;
    };
  };
  imports: {
    key: string;
    value: ImportSource;
    indexes: {
      hash: string;
      conversation: string;
      status: string;
    };
  };
  settings: {
    key: string;
    value: unknown;
  };
}
export const db = openDB<Schema>("chat-archive", 2, {
  upgrade(d, oldVersion, _newVersion, tx) {
    if (oldVersion < 1) {
      d.createObjectStore("conversations", { keyPath: "id" });
      for (const store of ["participants", "participantAliases"] as const) {
        const s = d.createObjectStore(store, { keyPath: "id" });
        s.createIndex("conversation", "conversationId");
      }
      const m = d.createObjectStore("messages", { keyPath: "id" });
      m.createIndex("conversation", "conversationId");
      m.createIndex("position", ["conversationId", "position"]);
      m.createIndex("participant", "participantId");
      m.createIndex("date", ["conversationId", "date.key"]);
      const a = d.createObjectStore("attachments", { keyPath: "id" });
      a.createIndex("conversation", "conversationId");
      a.createIndex("source", "sourceId");
      const i = d.createObjectStore("imports", { keyPath: "id" });
      i.createIndex("hash", "hash");
      i.createIndex("conversation", "conversationId");
      d.createObjectStore("settings");
    }
    if (oldVersion < 2)
      tx.objectStore("imports").createIndex("status", "status");
  },
});
export async function cleanup() {
  return withArchiveLock(async () => {
    const d = await db;
    const pending = await d.getAllKeysFromIndex("imports", "status", "pending");
    for (const id of pending) await discard(id);
  });
}
export async function discard(sourceId: string) {
  const d = await db;
  const tx = d.transaction(["messages", "attachments", "imports"], "readwrite");
  let cursor = await tx.objectStore("messages").openCursor();
  while (cursor) {
    if (cursor.value.sourceId === sourceId) await cursor.delete();
    cursor = await cursor.continue();
  }
  for (const key of await tx
    .objectStore("attachments")
    .index("source")
    .getAllKeys(sourceId))
    await tx.objectStore("attachments").delete(key);
  await tx.objectStore("imports").delete(sourceId);
  await tx.done;
}
export async function page(
  conversationId: string,
  offset: number,
  count = 200,
) {
  const d = await db;
  const tx = d.transaction("messages");
  const out: Message[] = [];
  let c = await tx.store
    .index("position")
    .openCursor(
      IDBKeyRange.bound(
        [conversationId, offset],
        [conversationId, Number.MAX_SAFE_INTEGER],
      ),
    );
  while (c && out.length < count) {
    out.push(c.value);
    c = await c.continue();
  }
  return out;
}
export async function messagesFor(conversationId: string) {
  const d = await db;
  return d.getAllFromIndex("messages", "conversation", conversationId);
}
export async function conversations() {
  return (await (await db).getAll("conversations")).sort((a, b) =>
    b.lastDate.localeCompare(a.lastDate),
  );
}
