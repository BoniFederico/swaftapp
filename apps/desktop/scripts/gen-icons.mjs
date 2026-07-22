// Rasterizes buildResources/icon.svg → buildResources/icon.png (1024×1024).
// electron-builder derives the per-platform icons (.ico / .icns / resized PNGs) from this PNG at
// package time, so the SVG stays the single source of truth. Run via `npm run gen:icons`.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const here = dirname(fileURLToPath(import.meta.url));
const resDir = resolve(here, '../buildResources');

const svg = readFileSync(resolve(resDir, 'icon.svg'), 'utf8');
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } }).render().asPng();
writeFileSync(resolve(resDir, 'icon.png'), png);

console.log(`wrote ${resolve(resDir, 'icon.png')} (${png.length} bytes, 1024×1024)`);
