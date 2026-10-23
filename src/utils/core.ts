export const uid = () => crypto.randomUUID();
export function messageSide(
  message: { kind: string; participantId?: string },
  selfId?: string,
) {
  return message.kind !== "message"
    ? "system"
    : selfId && message.participantId === selfId
      ? "self"
      : "other";
}
export const normalize = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-PT");
export async function hash(data: Uint8Array | Blob | string) {
  const bytes =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : data instanceof Blob
        ? new Uint8Array(await data.arrayBuffer())
        : data;
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export const limits = {
  entries: 10000,
  entryBytes: 256 * 1024 * 1024,
  totalBytes: 1024 * 1024 * 1024,
  inputBytes: 1024 * 1024 * 1024,
  messages: 1000000,
};
export function safePath(path: string) {
  const p = path.replace(/\\/g, "/");
  if (
    p.startsWith("/") ||
    /^[a-z]:/i.test(p) ||
    p.split("/").some((x) => x === "..") ||
    p.includes("\0")
  )
    throw Error("Caminho inseguro no ZIP.");
  return p.replace(/^\.\//, "");
}
export const inactive = (p: string) =>
  /\.(exe|com|bat|cmd|ps1|msi|dll|js|mjs|vbs|jar|apk|zip)$/i.test(p);
export const mime = (p: string) =>
  ({
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    wav: "audio/wav",
    amr: "audio/amr",
    aac: "audio/aac",
    "3gp": "video/3gpp",
    pdf: "application/pdf",
  })[p.split(".").pop()!.toLowerCase()] || "application/octet-stream";
export function matchPath(name: string, paths: string[]) {
  const n = safePath(name).normalize("NFC");
  const exact = paths.filter((p) => p.normalize("NFC") === n);
  if (exact.length === 1) return exact[0];
  const candidates = paths.filter(
    (p) => p.split("/").pop()?.normalize("NFC") === n.split("/").pop(),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}
