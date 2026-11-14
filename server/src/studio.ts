/**
 * Original studio-style placeholder artwork for sample catalog products and banners.
 * Geometric still-life only — no brand photos, logos or trademarks.
 */
import sharp from 'sharp';

export type Palette = { bg: string; mid: string; item: string; shade: string; highlight: string };

export const CATEGORY_PALETTES: Record<string, Palette> = {
  Hardware: { bg: '#e8f1f6', mid: '#c5d9e6', item: '#6b7c89', shade: '#3d4a54', highlight: '#dfe7ec' },
  Housewares: { bg: '#f3efe8', mid: '#e0d3c2', item: '#c4a574', shade: '#7a5a36', highlight: '#f7efe3' },
  Kitchenware: { bg: '#efecea', mid: '#d8d0cb', item: '#b0b6ba', shade: '#5c6468', highlight: '#f4f2f0' },
  Lighting: { bg: '#f7f1e6', mid: '#ead9b8', item: '#e8c15a', shade: '#8a6a22', highlight: '#fff6d9' },
  Packaging: { bg: '#f3eee4', mid: '#ddd0b6', item: '#c8a86a', shade: '#7a6240', highlight: '#f8f1df' },
  Textiles: { bg: '#eef3ec', mid: '#d2e0ce', item: '#7ea57a', shade: '#3f5c3d', highlight: '#eef6ec' },
};

function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

/** Product still-life: studio backdrop, soft shadow, geometric object. Variant changes angle and crop. */
export function productStudioSvg(scene: string, variant: number, pal: Palette, w = 1200, h = 1200) {
  const rot = [-10, 14, 2, 22][variant % 4];
  const zoom = [1, 1.12, 1.45, 0.86][variant % 4];
  const dy = [0, 30, -50, 70][variant % 4];
  const shape = sceneShape(scene, pal);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 1200 1200">
    <defs>
      <radialGradient id="bg" cx="50%" cy="36%" r="70%">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="45%" stop-color="${pal.bg}"/>
        <stop offset="100%" stop-color="${pal.mid}"/>
      </radialGradient>
      <radialGradient id="sh" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#00000028"/>
        <stop offset="100%" stop-color="#00000000"/>
      </radialGradient>
      <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${pal.highlight}"/>
        <stop offset="45%" stop-color="${pal.item}"/>
        <stop offset="100%" stop-color="${pal.shade}"/>
      </linearGradient>
      <linearGradient id="glint" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffffffbb"/>
        <stop offset="100%" stop-color="#ffffff00"/>
      </linearGradient>
      <filter id="soft"><feGaussianBlur stdDeviation="10"/></filter>
    </defs>
    <rect width="1200" height="1200" fill="url(#bg)"/>
    <ellipse cx="600" cy="980" rx="360" ry="64" fill="url(#sh)" filter="url(#soft)"/>
    <g transform="translate(600,${590 + dy}) rotate(${rot}) scale(${zoom}) translate(-600,-590)">${shape}</g>
  </svg>`;
}

function sceneShape(scene: string, pal: Palette): string {
  switch (scene) {
    case 'bolts':
      return `<g>
        <rect x="520" y="430" width="160" height="420" rx="20" fill="url(#metal)"/>
        <path d="M520 520 h160 M520 560 h160 M520 600 h160 M520 640 h160 M520 680 h160 M520 720 h160" stroke="${pal.shade}" stroke-width="6" opacity=".35"/>
        <polygon points="600,250 700,310 700,430 500,430 500,310" fill="url(#metal)"/>
        <polygon points="600,270 680,318 520,318" fill="url(#glint)" opacity=".5"/>
      </g>`;
    case 'spanner':
      return `<g>
        <path d="M320 420 c0-80 80-140 160-120 l40 30 200 200 200-40 c80 20 110 120 40 180 l-80 40-210-20-200-200 c-40-50-150-30-150-70z" fill="url(#metal)"/>
        <circle cx="430" cy="400" r="48" fill="${pal.bg}"/>
        <circle cx="860" cy="640" r="42" fill="${pal.bg}"/>
        <rect x="560" y="530" width="220" height="36" rx="8" fill="url(#glint)" opacity=".45" transform="rotate(-28 670 548)"/>
      </g>`;
    case 'gland':
      return `<g>
        <rect x="470" y="360" width="260" height="420" rx="40" fill="url(#metal)"/>
        <circle cx="600" cy="360" r="130" fill="url(#metal)"/>
        <circle cx="600" cy="360" r="70" fill="${pal.bg}"/>
        <circle cx="600" cy="780" r="90" fill="url(#metal)"/>
        <rect x="520" y="430" width="40" height="280" rx="8" fill="url(#glint)" opacity=".35"/>
      </g>`;
    case 'valve':
      return `<g>
        <rect x="470" y="520" width="260" height="180" rx="30" fill="url(#metal)"/>
        <circle cx="600" cy="610" r="70" fill="${pal.shade}"/>
        <rect x="575" y="300" width="50" height="230" rx="10" fill="url(#metal)"/>
        <rect x="420" y="280" width="360" height="50" rx="16" fill="url(#metal)"/>
        <rect x="400" y="560" width="70" height="100" rx="16" fill="url(#metal)"/>
        <rect x="730" y="560" width="70" height="100" rx="16" fill="url(#metal)"/>
      </g>`;
    case 'board':
      return `<g>
        <rect x="260" y="380" width="680" height="440" rx="36" fill="url(#metal)"/>
        <rect x="300" y="420" width="600" height="360" rx="24" fill="${pal.shade}" opacity=".12"/>
        <ellipse cx="600" cy="600" rx="200" ry="130" fill="none" stroke="${pal.shade}" stroke-width="10" opacity=".2"/>
      </g>`;
    case 'jars':
      return `<g>
        ${[0, 1, 2].map((i) => {
          const x = 320 + i * 220, h = 340 + (i === 1 ? 80 : 0), y = 720 - h;
          return `<rect x="${x}" y="${y}" width="180" height="${h}" rx="16" fill="url(#metal)" opacity="${0.75 + i * 0.1}"/>
            <rect x="${x + 20}" y="${y - 36}" width="140" height="44" rx="10" fill="${pal.shade}"/>
            <rect x="${x + 30}" y="${y + 40}" width="40" height="${h - 80}" rx="8" fill="url(#glint)" opacity=".4"/>`;
        }).join('')}
      </g>`;
    case 'towel':
      return `<g>
        <rect x="280" y="360" width="280" height="420" rx="16" fill="url(#metal)" transform="rotate(-8 420 570)"/>
        <rect x="520" y="340" width="280" height="420" rx="16" fill="${pal.shade}" opacity=".85" transform="rotate(6 660 550)"/>
        <rect x="400" y="420" width="280" height="400" rx="16" fill="${pal.highlight}" opacity=".9"/>
      </g>`;
    case 'bowls':
      return `<g>
        <ellipse cx="600" cy="720" rx="320" ry="90" fill="url(#metal)"/>
        <ellipse cx="600" cy="700" rx="280" ry="70" fill="${pal.bg}"/>
        <ellipse cx="600" cy="560" rx="240" ry="70" fill="url(#metal)"/>
        <ellipse cx="600" cy="545" rx="210" ry="52" fill="${pal.bg}"/>
        <ellipse cx="600" cy="430" rx="180" ry="55" fill="url(#metal)"/>
        <ellipse cx="600" cy="418" rx="155" ry="38" fill="${pal.bg}"/>
      </g>`;
    case 'spatula':
      return `<g>
        <rect x="560" y="280" width="80" height="460" rx="20" fill="${pal.shade}"/>
        <ellipse cx="600" cy="780" rx="90" ry="140" fill="url(#metal)"/>
        <rect x="520" y="240" width="50" height="200" rx="12" fill="url(#metal)" transform="rotate(-18 545 340)"/>
        <rect x="630" y="250" width="50" height="180" rx="12" fill="url(#metal)" transform="rotate(16 655 340)"/>
      </g>`;
    case 'skillet':
      return `<g>
        <ellipse cx="560" cy="620" rx="300" ry="220" fill="url(#metal)"/>
        <ellipse cx="560" cy="620" rx="240" ry="170" fill="${pal.shade}"/>
        <ellipse cx="500" cy="560" rx="90" ry="50" fill="url(#glint)" opacity=".25"/>
        <rect x="820" y="590" width="260" height="46" rx="18" fill="${pal.item}"/>
      </g>`;
    case 'panel':
      return `<g>
        <rect x="260" y="300" width="680" height="560" rx="12" fill="url(#metal)"/>
        <rect x="300" y="340" width="600" height="480" rx="6" fill="${pal.highlight}"/>
        <rect x="300" y="340" width="600" height="180" fill="url(#glint)" opacity=".35"/>
      </g>`;
    case 'lamp':
      return `<g>
        <rect x="540" y="620" width="120" height="200" rx="16" fill="url(#metal)"/>
        <rect x="460" y="800" width="280" height="36" rx="10" fill="${pal.shade}"/>
        <path d="M400 620 L600 280 L800 620 Z" fill="url(#metal)"/>
        <path d="M460 600 L600 340 L740 600 Z" fill="url(#glint)" opacity=".35"/>
      </g>`;
    case 'bulb':
      return `<g>
        ${[0, 1, 2, 3].map((i) => {
          const x = 300 + (i % 2) * 280, y = 320 + Math.floor(i / 2) * 300;
          return `<g transform="translate(${x},${y})">
            <ellipse cx="120" cy="110" rx="90" ry="110" fill="url(#metal)"/>
            <rect x="85" y="200" width="70" height="50" rx="8" fill="${pal.shade}"/>
            <path d="M70 90 Q120 20 170 90" fill="none" stroke="#fff" stroke-width="6" opacity=".5"/>
          </g>`;
        }).join('')}
      </g>`;
    case 'boxes':
      return `<g>
        <path d="M360 720 L600 800 L840 720 L840 480 L600 400 L360 480 Z" fill="url(#metal)"/>
        <path d="M600 400 L840 480 L840 720 L600 640 Z" fill="${pal.shade}" opacity=".35"/>
        <path d="M360 480 L600 400 L840 480 L600 560 Z" fill="url(#glint)" opacity=".25"/>
      </g>`;
    case 'mailers':
      return `<g>
        <rect x="300" y="360" width="600" height="420" rx="24" fill="url(#metal)"/>
        <path d="M300 360 L600 560 L900 360" fill="none" stroke="${pal.shade}" stroke-width="10" opacity=".35"/>
        <rect x="340" y="400" width="160" height="24" rx="8" fill="url(#glint)" opacity=".4"/>
      </g>`;
    case 'wrap':
      return `<g>
        <rect x="380" y="320" width="440" height="520" rx="20" fill="url(#metal)"/>
        <rect x="360" y="300" width="480" height="70" rx="16" fill="${pal.shade}"/>
        <rect x="360" y="790" width="480" height="70" rx="16" fill="${pal.shade}"/>
        <path d="M420 390 Q600 500 420 700" fill="none" stroke="url(#glint)" stroke-width="18" opacity=".5"/>
      </g>`;
    case 'tote':
      return `<g>
        <path d="M360 460 L390 860 Q600 920 810 860 L840 460 Z" fill="url(#metal)"/>
        <path d="M430 460 C430 300 770 300 770 460" fill="none" stroke="${pal.shade}" stroke-width="28"/>
        <rect x="420" y="500" width="40" height="260" fill="url(#glint)" opacity=".3"/>
      </g>`;
    case 'bag':
      return `<g>
        <path d="M380 420 L400 860 Q600 920 800 860 L820 420 Z" fill="url(#metal)"/>
        <path d="M500 260 C500 260 420 400 420 420" fill="none" stroke="${pal.shade}" stroke-width="18"/>
        <path d="M700 260 C700 260 780 400 780 420" fill="none" stroke="${pal.shade}" stroke-width="18"/>
      </g>`;
    default:
      return `<g>
        <rect x="340" y="360" width="520" height="480" rx="48" fill="url(#metal)"/>
        <circle cx="600" cy="560" r="120" fill="url(#glint)" opacity=".35"/>
      </g>`;
  }
}

export async function productStudioImage(scene: string, variant: number, pal: Palette) {
  const svg = productStudioSvg(scene, variant, pal);
  const orig = await sharp(Buffer.from(svg)).png().toBuffer();
  const card = await sharp(orig).resize(600, 600, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
  const gallery = await sharp(orig).resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  return { original: orig, card, gallery, mime: 'image/png' as const };
}

export async function bannerStudioImage(title: string, pal: Palette) {
  const w = 1920, h = 640;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${pal.shade}"/>
        <stop offset="55%" stop-color="${pal.item}"/>
        <stop offset="100%" stop-color="${pal.mid}"/>
      </linearGradient>
      <radialGradient id="orb" cx="80%" cy="20%" r="50%">
        <stop offset="0%" stop-color="#ffffff33"/>
        <stop offset="100%" stop-color="#ffffff00"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <circle cx="1600" cy="80" r="380" fill="url(#orb)"/>
    <circle cx="120" cy="620" r="260" fill="#00000018"/>
    <rect x="120" y="200" width="8" height="220" fill="#ffffff55"/>
    <text x="160" y="300" fill="#fff" font-family="Arial, sans-serif" font-size="64" font-weight="700">${esc(title)}</text>
    <text x="160" y="360" fill="#ffffffcc" font-family="Arial, sans-serif" font-size="28">Source Easy sample</text>
  </svg>`;
  const orig = await sharp(Buffer.from(svg)).png().toBuffer();
  const desktop = await sharp(orig).resize(1920, 640, { fit: 'cover', position: 'centre' }).webp({ quality: 82 }).toBuffer();
  const mobile = await sharp(orig).resize(1080, 720, { fit: 'cover', position: 'centre' }).webp({ quality: 82 }).toBuffer();
  return { original: orig, desktop, mobile, mime: 'image/png' as const };
}

export function sceneFor(title: string, category: string) {
  const t = `${title} ${category}`.toLowerCase();
  if (/bolt/.test(t)) return 'bolts';
  if (/spanner|wrench/.test(t)) return 'spanner';
  if (/gland/.test(t)) return 'gland';
  if (/valve/.test(t)) return 'valve';
  if (/board/.test(t)) return 'board';
  if (/jar/.test(t)) return 'jars';
  if (/towel/.test(t)) return 'towel';
  if (/bowl/.test(t)) return 'bowls';
  if (/spatula|utensil/.test(t)) return 'spatula';
  if (/skillet|pan/.test(t)) return 'skillet';
  if (/panel/.test(t)) return 'panel';
  if (/lamp/.test(t)) return 'lamp';
  if (/bulb/.test(t)) return 'bulb';
  if (/box/.test(t)) return 'boxes';
  if (/mailer/.test(t)) return 'mailers';
  if (/wrap|film/.test(t)) return 'wrap';
  if (/tote/.test(t)) return 'tote';
  if (/bag/.test(t)) return 'bag';
  return 'board';
}
