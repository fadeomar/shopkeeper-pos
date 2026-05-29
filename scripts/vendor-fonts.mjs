// One-off helper: vendor Google Fonts woff2 files into app/fonts so the
// production build never needs network access (offline-first requirement).
// Run with: node scripts/vendor-fonts.mjs
// After running, app/layout.tsx loads them via next/font/local.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const OUT_DIR = join(process.cwd(), 'app', 'fonts');

// Plus Jakarta Sans + JetBrains Mono are variable (one file, weight range).
// IBM Plex Sans Arabic is static (one file per weight).
const FAMILIES = [
  {
    prefix: 'PlusJakartaSans',
    query: 'family=Plus+Jakarta+Sans:wght@400..800',
    subset: 'latin',
  },
  {
    prefix: 'JetBrainsMono',
    query: 'family=JetBrains+Mono:wght@400..700',
    subset: 'latin',
  },
  {
    prefix: 'IBMPlexSansArabic',
    query: 'family=IBM+Plex+Sans+Arabic:wght@400;500;600;700',
    subset: 'arabic',
  },
];

const BLOCK_RE =
  /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;

/** Parse @font-face blocks → [{ subset, weight, url }]. */
function parseFaces(css) {
  const faces = [];
  let m;
  while ((m = BLOCK_RE.exec(css))) {
    const subset = m[1];
    const body = m[2];
    const weight = body.match(/font-weight:\s*([^;]+);/)?.[1].trim() ?? '';
    const url = body.match(/url\((https:\/\/[^)]+\.woff2)\)/)?.[1] ?? '';
    if (url) faces.push({ subset, weight, url });
  }
  return faces;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const { prefix, query, subset } of FAMILIES) {
    const cssUrl = `https://fonts.googleapis.com/css2?${query}&display=swap`;
    const css = await fetch(cssUrl, { headers: { 'User-Agent': UA } }).then(
      (r) => r.text(),
    );
    const faces = parseFaces(css).filter((f) => f.subset === subset);
    if (faces.length === 0) {
      throw new Error(`No "${subset}" subset for ${prefix}. CSS head:\n${css.slice(0, 200)}`);
    }
    for (const face of faces) {
      // Variable weight ("400 800") → single file with no weight suffix.
      // Static weight ("500") → one file per weight.
      const isVariable = face.weight.includes(' ');
      const file = isVariable
        ? `${prefix}-${subset}.woff2`
        : `${prefix}-${subset}-${face.weight}.woff2`;
      const buf = Buffer.from(
        await fetch(face.url).then((r) => r.arrayBuffer()),
      );
      await writeFile(join(OUT_DIR, file), buf);
      console.log(
        `✓ ${file}  (${(buf.length / 1024).toFixed(1)} KB)  weight=${face.weight}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
