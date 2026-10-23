/// <reference lib="webworker" />
import { Unzip, UnzipInflate } from "fflate";
import { parse } from "../import/parser";
import { hash, inactive, limits, safePath } from "../utils/core";
let archive: File | undefined;
let text = "";
let consumed = 0;
async function scan(file: File, select?: string) {
  const paths: string[] = [];
  const texts: Record<string, string> = {};
  let size = 0;
  const seen = new Set<string>();
  let entries = 0;
  let total = 0;
  let failure: Error | undefined;
  const chunks: Uint8Array[] = [];
  const unzip = new Unzip((entry) => {
    try {
      const path = safePath(entry.name);
      if (seen.has(path)) throw Error("Caminho repetido no ZIP.");
      seen.add(path);
      if (++entries > limits.entries)
        throw Error("Demasiadas entradas no ZIP.");
      if (
        path.endsWith("/") ||
        path.startsWith("__MACOSX/") ||
        path.split("/").pop()?.startsWith(".")
      )
        return;
      if (inactive(path)) return;
      paths.push(path);
      size += entry.originalSize || 0;
      const want = select ? path === select : /\.txt$/i.test(path);
      if (!want) return;
      let bytes = 0;
      const data: Uint8Array[] = [];
      entry.ondata = (err, chunk, final) => {
        if (err) {
          failure = err;
          return;
        }
        bytes += chunk.length;
        total += chunk.length;
        if (
          bytes > limits.entryBytes ||
          total > limits.totalBytes ||
          (!select && bytes > 16 * 1024 * 1024)
        ) {
          failure = Error("Limite de extração excedido.");
          return;
        }
        if (select) chunks.push(chunk);
        else data.push(chunk);
        if (final && !select) {
          const all = new Uint8Array(bytes);
          let off = 0;
          for (const x of data) {
            all.set(x, off);
            off += x.length;
          }
          texts[path] = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(all);
        }
      };
      entry.start();
    } catch (e) {
      failure = e as Error;
    }
  });
  unzip.register(UnzipInflate);
  const reader = file.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        unzip.push(new Uint8Array(), true);
        break;
      }
      unzip.push(value);
      if (failure) throw failure;
    }
    if (failure) throw failure;
  } finally {
    await reader.cancel();
  }
  if (select && select !== "__list_only__") {
    consumed += total;
    if (consumed > limits.totalBytes)
      throw Error("Limite total descomprimido excedido.");
    if (!paths.includes(select)) throw Error("Anexo ausente.");
  }
  return { paths, texts, size, chunks };
}
self.onmessage = async (event: MessageEvent) => {
  const { id, action, ...args } = event.data;
  try {
    let result: unknown;
    if (action === "prepare") {
      archive = args.file;
      consumed = 0;
      const f = archive!;
      if (f.size > limits.inputBytes)
        throw Error("Ficheiro demasiado grande (máximo 1 GiB).");
      const digest = await hash(f);
      if (/\.zip$/i.test(f.name)) {
        const s = await scan(f);
        const candidates = Object.entries(s.texts).filter(
          ([p, t]) =>
            !/readme|license|manifest/i.test(p) &&
            parse(t).messages.some((m) => m.date),
        );
        if (!candidates.length)
          throw Error("Não foi encontrado um TXT de conversa válido no ZIP.");
        result = {
          hash: digest,
          name: f.name,
          candidates,
          paths: s.paths.filter(
            (p) =>
              !candidates.some(([name]) => name === p) &&
              !/(?:^|\/)(?:readme|license|manifest)\b/i.test(p),
          ),
          attachmentBytes: s.size,
        };
      } else if (/\.txt$/i.test(f.name)) {
        text = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(await f.arrayBuffer());
        result = {
          hash: digest,
          name: f.name,
          candidates: [[f.name, text]],
          paths: [],
          attachmentBytes: 0,
        };
      } else throw Error("Escolhe um ficheiro ZIP ou TXT.");
    } else if (action === "backupInspect") {
      archive = args.file;
      consumed = 0;
      if (archive!.size > limits.inputBytes)
        throw Error("Cópia demasiado grande.");
      const s = await scan(archive!, "__list_only__");
      result = s.paths;
    } else if (action === "parse") {
      text = args.text;
      result = parse(text, args.order);
    } else if (action === "extract") {
      if (!archive) throw Error("Origem indisponível.");
      const s = await scan(archive, args.path);
      result = new Blob(s.chunks as BlobPart[]);
    } else throw Error("Operação desconhecida.");
    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({
      id,
      error:
        e instanceof Error ? e.message : "Não foi possível ler o ficheiro.",
    });
  }
};
