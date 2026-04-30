/**
 * Generates PNG icons for the PWA from the SVG cart design.
 * Chrome requires PNG for the install prompt — SVGs are ignored.
 * Run: node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CRC32 ──────────────────────────────────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

// ── Rasterise design into RGBA pixels ─────────────────────────────────────────
// Design space is 192×192 (matching the SVG viewBox).
// Cart bar:  M48,62 → 144,62 → 136,84 → 56,84   (trapezoid, #60a5fa)
// Cart body: M62,94 → 130,94 → 124,146 → 68,146  (trapezoid, #60a5fa)
// Wheel 1:   cx=78  cy=150 r=10  (#f8fafc)
// Wheel 2:   cx=118 cy=150 r=10  (#f8fafc)
// Background: #111827, rounded rect rx=36

function rasterise(size, { maskable = false } = {}) {
  const pixels = new Uint8ClampedArray(size * size * 4);

  const BG    = [0x11, 0x18, 0x27];
  const CART  = [0x60, 0xa5, 0xfa];
  const WHITE = [0xf8, 0xfa, 0xfc];

  // For maskable icons, shrink the design into the centre 80% safe zone.
  const contentScale = maskable ? 0.72 : 1;
  const contentOffset = maskable ? size * 0.14 : 0;
  const baseScale = size / 192;

  function inRoundedRect(x, y) {
    const r = 36;
    const w = 192, h = 192;
    if (x < 0 || y < 0 || x > w || y > h) return false;
    if (x < r && y < r) return (x - r) ** 2 + (y - r) ** 2 <= r * r;
    if (x > w - r && y < r) return (x - (w - r)) ** 2 + (y - r) ** 2 <= r * r;
    if (x < r && y > h - r) return (x - r) ** 2 + (y - (h - r)) ** 2 <= r * r;
    if (x > w - r && y > h - r) return (x - (w - r)) ** 2 + (y - (h - r)) ** 2 <= r * r;
    return true;
  }

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Map pixel → 192px design space
      const x = (px - contentOffset) / (baseScale * contentScale);
      const y = (py - contentOffset) / (baseScale * contentScale);
      const i = (py * size + px) * 4;

      if (maskable) {
        // Maskable: solid background everywhere, design floats in centre
        let color = BG;
        if (x >= 0 && x <= 192 && y >= 0 && y <= 192) {
          color = pickColor(x, y) ?? BG;
        }
        pixels[i] = color[0]; pixels[i+1] = color[1];
        pixels[i+2] = color[2]; pixels[i+3] = 255;
      } else {
        // Regular: transparent outside rounded corners
        if (!inRoundedRect(x, y)) {
          pixels[i+3] = 0; // transparent
          continue;
        }
        const color = pickColor(x, y) ?? BG;
        pixels[i] = color[0]; pixels[i+1] = color[1];
        pixels[i+2] = color[2]; pixels[i+3] = 255;
      }
    }
  }
  return pixels;
}

function pickColor(x, y) {
  // Cart bar trapezoid: (48,62)→(144,62)→(136,84)→(56,84)
  if (y >= 62 && y <= 84) {
    const t = (y - 62) / 22;
    if (x >= 48 + t * 8 && x <= 144 - t * 8) return [0x60, 0xa5, 0xfa];
  }
  // Cart body trapezoid: (62,94)→(130,94)→(124,146)→(68,146)
  if (y >= 94 && y <= 146) {
    const t = (y - 94) / 52;
    if (x >= 62 + t * 6 && x <= 130 - t * 6) return [0x60, 0xa5, 0xfa];
  }
  // Wheel 1 & 2
  if ((x - 78) ** 2 + (y - 150) ** 2 <= 100) return [0xf8, 0xfa, 0xfc];
  if ((x - 118) ** 2 + (y - 150) ** 2 <= 100) return [0xf8, 0xfa, 0xfc];
  return null;
}

// ── Build PNG from pixels ──────────────────────────────────────────────────────
function buildPNG(size, pixels) {
  const rows = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    rows[y * (1 + size * 4)] = 0; // filter = None
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = y * (1 + size * 4) + 1 + x * 4;
      rows[dst]   = pixels[src];
      rows[dst+1] = pixels[src+1];
      rows[dst+2] = pixels[src+2];
      rows[dst+3] = pixels[src+3];
    }
  }

  const IHDR = Buffer.alloc(13);
  IHDR.writeUInt32BE(size, 0); IHDR.writeUInt32BE(size, 4);
  IHDR[8] = 8; IHDR[9] = 6; // 8-bit RGBA

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    pngChunk('IHDR', IHDR),
    pngChunk('IDAT', deflateSync(rows, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Write files ───────────────────────────────────────────────────────────────
const outDir = join(__dirname, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const files = [
  { name: 'icon-192.png',          size: 192, opts: {} },
  { name: 'icon-512.png',          size: 512, opts: {} },
  { name: 'icon-maskable-512.png', size: 512, opts: { maskable: true } },
];

for (const { name, size, opts } of files) {
  const pixels = rasterise(size, opts);
  writeFileSync(join(outDir, name), buildPNG(size, pixels));
  console.log(`✓ public/icons/${name}`);
}
