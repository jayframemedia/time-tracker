// Generates the app icons (PNG + SVG) with no dependencies: `node tools/make-icons.mjs`.
// Design: near-black square, track ring with a 3/4 orange progress arc, orange START disc.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [0x0a, 0x0a, 0x0b];
const TRACK = [0x1f, 0x1f, 0x23];
const ACCENT = [0xff, 0x7a, 0x1a];

// Geometry as fractions of the icon size. `scale` shrinks the artwork for maskable icons.
function shapes(scale) {
  return {
    ringR: 0.38 * scale, ringW: 0.022 * scale,
    arcW: 0.04 * scale, arcEnd: 0.75, // fraction of the circle, clockwise from 12 o'clock
    haloR: 0.31 * scale,
    discR: 0.27 * scale,
  };
}

function colourAt(x, y, g) {
  // x, y in [-0.5, 0.5]; y down
  const r = Math.hypot(x, y);
  let c = BG;
  const blend = (col, alpha) => { c = c.map((v, i) => v + (col[i] - v) * alpha); };
  if (Math.abs(r - g.ringR) <= g.ringW / 2) blend(TRACK, 1);
  // Arc: angle clockwise from 12 o'clock
  let t = Math.atan2(x, -y) / (2 * Math.PI);
  if (t < 0) t += 1;
  const onArc = Math.abs(r - g.ringR) <= g.arcW / 2 && t <= g.arcEnd;
  const capA = Math.hypot(x, y + g.ringR) <= g.arcW / 2; // 12 o'clock
  const endAng = g.arcEnd * 2 * Math.PI;
  const capB = Math.hypot(x - g.ringR * Math.sin(endAng), y + g.ringR * Math.cos(endAng)) <= g.arcW / 2;
  if (onArc || capA || capB) blend(ACCENT, 1);
  if (r <= g.haloR) blend(ACCENT, 0.12);
  if (r <= g.discR) blend(ACCENT, 1);
  return c;
}

function renderPng(size, scale) {
  const g = shapes(scale);
  const SS = 4; // 4×4 supersampling for smooth edges
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size - 0.5;
          const y = (py + (sy + 0.5) / SS) / size - 0.5;
          colourAt(x, y, g).forEach((v, i) => { acc[i] += v; });
        }
      }
      const o = py * (size * 3 + 1) + 1 + px * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(acc[i] / (SS * SS));
    }
  }
  return encodePng(size, size, raw);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function svg() {
  const g = shapes(1);
  const S = 512;
  const R = g.ringR * S;
  const end = g.arcEnd * 2 * Math.PI;
  const ex = S / 2 + R * Math.sin(end);
  const ey = S / 2 - R * Math.cos(end);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">
  <rect width="${S}" height="${S}" rx="${S * 0.22}" fill="#0A0A0B"/>
  <circle cx="256" cy="256" r="${R}" fill="none" stroke="#1F1F23" stroke-width="${g.ringW * S}"/>
  <path d="M256 ${256 - R} A${R} ${R} 0 1 1 ${ex.toFixed(2)} ${ey.toFixed(2)}" fill="none" stroke="#FF7A1A" stroke-width="${g.arcW * S}" stroke-linecap="round"/>
  <circle cx="256" cy="256" r="${g.haloR * S}" fill="#FF7A1A" fill-opacity="0.12"/>
  <circle cx="256" cy="256" r="${g.discR * S}" fill="#FF7A1A"/>
</svg>
`;
}

const out = new URL('../icons/', import.meta.url);
mkdirSync(out, { recursive: true });
const files = [
  ['icon-32.png', 32, 1],
  ['apple-touch-icon.png', 180, 1],
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.8], // artwork inside the maskable safe zone
];
for (const [name, size, scale] of files) {
  writeFileSync(new URL(name, out), renderPng(size, scale));
  console.log('wrote icons/' + name);
}
writeFileSync(new URL('icon.svg', out), svg());
console.log('wrote icons/icon.svg');
