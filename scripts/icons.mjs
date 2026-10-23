import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
// Draw the original archive icon locally, without downloading any assets.
function crc(data) {
  let c = 0xffffffff;
  for (const byte of data) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type);
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length);
  t.copy(b, 4);
  data.copy(b, 8);
  b.writeUInt32BE(crc(Buffer.concat([t, data])), 8 + data.length);
  return b;
}
mkdirSync("public/icons", { recursive: true });
for (const size of [192, 512]) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const at = y * (size * 4 + 1) + 1 + x * 4;
      const u = x / size,
        v = y / size;
      const mark = u > 0.26 && u < 0.74 && v > 0.33 && v < 0.72;
      const lid = u > 0.23 && u < 0.77 && v > 0.25 && v < 0.34;
      const handle = u > 0.42 && u < 0.58 && v > 0.43 && v < 0.48;
      const col = handle
        ? [25, 95, 81]
        : mark || lid
          ? [233, 241, 220]
          : [25, 95, 81];
      raw.set([...col, 255], at);
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(`public/icons/icon-${size}.png`, png);
  if (size === 512) writeFileSync("public/icons/maskable-512.png", png);
}
