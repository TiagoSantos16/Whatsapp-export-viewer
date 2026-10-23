import type { ParseResult } from "../types";
const worker = new Worker(
  new URL("../workers/import.worker.ts", import.meta.url),
  { type: "module" },
);
let sequence = 0;
const pending = new Map<
  number,
  {
    resolve: (v: never) => void;
    reject: (e: Error) => void;
  }
>();
worker.onmessage = (e) => {
  const p = pending.get(e.data.id);
  if (!p) return;
  pending.delete(e.data.id);
  if (e.data.error) p.reject(Error(e.data.error));
  else p.resolve(e.data.result as never);
};
export function request<T>(
  action: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve: resolve as (v: never) => void, reject });
    worker.postMessage({ id, action, ...args });
  });
}
export type Inspection = {
  hash: string;
  name: string;
  candidates: [string, string][];
  paths: string[];
  attachmentBytes: number;
};
export const inspect = (file: File) => request<Inspection>("prepare", { file });
export const analyze = (text: string, order?: "DMY" | "MDY") =>
  request<ParseResult>("parse", { text, order });
