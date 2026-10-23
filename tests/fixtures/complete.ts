import { zipSync, strToU8, zlibSync } from "fflate";
function crc(data: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of data) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(data.length + 12),
    view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(strToU8(type), 4);
  out.set(data, 8);
  view.setUint32(data.length + 8, crc(out.subarray(4, data.length + 8)));
  return out;
}
function concat(...arrays: Uint8Array[]) {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
}
export function colorPng(color: [number, number, number]) {
  const size = 48,
    raw = new Uint8Array((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      raw.set([...color, 255], y * (size * 4 + 1) + 1 + x * 4);
  const ihdr = new Uint8Array(13),
    v = new DataView(ihdr.buffer);
  v.setUint32(0, size);
  v.setUint32(4, size);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return concat(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibSync(raw)),
    chunk("IEND", new Uint8Array()),
  );
}
export function syntheticAudio() {
  const samples = 2000,
    out = new Uint8Array(44 + samples * 2),
    v = new DataView(out.buffer);
  out.set(strToU8("RIFF"));
  v.setUint32(4, out.length - 8, true);
  out.set(strToU8("WAVEfmt "), 8);
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  out.set(strToU8("data"), 36);
  v.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++)
    v.setInt16(
      44 + i * 2,
      Math.sin((i * 2 * Math.PI * 440) / 8000) * 4000,
      true,
    );
  return out;
}
export const completeText = [
  "21/10/2026, 10:00 - Ana: <attached: media/z-vermelho.png>\nLegenda da imagem vermelha.",
  "21/10/2026, 10:01 - João: Texto final corrigido <Esta mensagem foi editada>",
  "21/10/2026, 10:02 - Ana: Uma mensagem entre os anexos.",
  "21/10/2026, 10:03 - João: <attached: media/a-azul.png>",
  "21/10/2026, 10:04 - Ana: voz.wav (file attached)",
  "21/10/2026, 10:05 - João: <attached: documento.txt>",
  "21/10/2026, 10:06 - Ana: <attached: falta.jpg>\nLegenda sem imagem.",
  "21/10/2026, 10:07 - João: <attached: um/repetido.png>",
  "21/10/2026, 10:08 - Ana: <attached: dois/repetido.png>",
  "21/10/2026, 10:09 - João: <attached: repetido.png>",
  "21/10/2026, 10:10 - Ana: <Ficheiro não revelado>",
  "21/10/2026, 10:11 - João: <Imagem omitida>\nLegenda preservada.",
  "21/10/2026, 10:12 - Ana: " +
    "Antes ".repeat(80) +
    "cafe\u0301 e AÇÃO " +
    "depois ".repeat(40),
  "23/10/2026, 11:00 - João: Outro dia.",
].join("\n");
export function completeArchive(video?: Uint8Array) {
  const files: Record<string, Uint8Array> = {
    "media/a-azul.png": colorPng([30, 80, 210]),
    "dois/repetido.png": colorPng([30, 80, 210]),
    "documento.txt": strToU8("Documento sintético. Sem dados pessoais."),
    "chat.txt": strToU8(
      completeText +
        (video ? "\n23/10/2026, 11:01 - Ana: <attached: pequeno.webm>" : ""),
    ),
    "voz.wav": syntheticAudio(),
    "um/repetido.png": colorPng([210, 40, 35]),
    "sem-mensagem.png": colorPng([40, 150, 70]),
    "media/z-vermelho.png": colorPng([210, 40, 35]),
  };
  if (video) files["pequeno.webm"] = video;
  return zipSync(files);
}
