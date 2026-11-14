export type Pal = { bg: string; mid: string; item: string; shade: string; highlight: string };
export const CATEGORY_PALETTES: Record<string, Pal> = {
  Hardware: { bg: '#e8f1f6', mid: '#c5d9e6', item: '#6b7c89', shade: '#3d4a54', highlight: '#dfe7ec' },
  Housewares: { bg: '#f3efe8', mid: '#e0d3c2', item: '#c4a574', shade: '#7a5a36', highlight: '#f7efe3' },
  Kitchenware: { bg: '#efecea', mid: '#d8d0cb', item: '#b0b6ba', shade: '#5c6468', highlight: '#f4f2f0' },
  Lighting: { bg: '#f7f1e6', mid: '#ead9b8', item: '#e8c15a', shade: '#8a6a22', highlight: '#fff6d9' },
  Packaging: { bg: '#f3eee4', mid: '#ddd0b6', item: '#c8a86a', shade: '#7a6240', highlight: '#f8f1df' },
  Textiles: { bg: '#eef3ec', mid: '#d2e0ce', item: '#7ea57a', shade: '#3f5c3d', highlight: '#eef6ec' },
};

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

function sceneShape(scene: string, pal: Pal): string {
  switch (scene) {
    case 'bolts':
      return `<g><rect x="520" y="430" width="160" height="420" rx="20" fill="url(#metal)"/><path d="M520 520 h160 M520 560 h160 M520 600 h160 M520 640 h160 M520 680 h160 M520 720 h160" stroke="${pal.shade}" stroke-width="6" opacity=".35"/><polygon points="600,250 700,310 700,430 500,430 500,310" fill="url(#metal)"/><polygon points="600,270 680,318 520,318" fill="url(#glint)" opacity=".5"/></g>`;
    case 'spanner':
      return `<g><path d="M320 420 c0-80 80-140 160-120 l40 30 200 200 200-40 c80 20 110 120 40 180 l-80 40-210-20-200-200 c-40-50-150-30-150-70z" fill="url(#metal)"/><circle cx="430" cy="400" r="48" fill="${pal.bg}"/><circle cx="860" cy="640" r="42" fill="${pal.bg}"/></g>`;
    case 'gland':
      return `<g><rect x="470" y="360" width="260" height="420" rx="40" fill="url(#metal)"/><circle cx="600" cy="360" r="130" fill="url(#metal)"/><circle cx="600" cy="360" r="70" fill="${pal.bg}"/><circle cx="600" cy="780" r="90" fill="url(#metal)"/></g>`;
    case 'valve':
      return `<g><rect x="470" y="520" width="260" height="180" rx="30" fill="url(#metal)"/><rect x="200" y="560" width="800" height="80" rx="40" fill="url(#metal)"/><circle cx="600" cy="400" r="90" fill="url(#metal)"/><rect x="560" y="250" width="80" height="160" fill="url(#metal)"/></g>`;
    case 'jars':
      return `<g><rect x="360" y="420" width="160" height="320" rx="20" fill="${pal.highlight}" stroke="${pal.shade}" stroke-width="8"/><rect x="520" y="360" width="160" height="380" rx="20" fill="${pal.highlight}" stroke="${pal.shade}" stroke-width="8"/><rect x="680" y="460" width="160" height="280" rx="20" fill="${pal.highlight}" stroke="${pal.shade}" stroke-width="8"/><rect x="370" y="400" width="140" height="30" rx="8" fill="${pal.item}"/><rect x="530" y="340" width="140" height="30" rx="8" fill="${pal.item}"/><rect x="690" y="440" width="140" height="30" rx="8" fill="${pal.item}"/></g>`;
    case 'towel':
      return `<g><rect x="300" y="360" width="600" height="420" rx="24" fill="${pal.item}"/><rect x="300" y="360" width="600" height="70" fill="${pal.shade}" opacity=".25"/><rect x="340" y="500" width="520" height="18" rx="8" fill="${pal.highlight}" opacity=".5"/></g>`;
    case 'bowls':
      return `<g><ellipse cx="600" cy="720" rx="280" ry="70" fill="${pal.shade}" opacity=".2"/><path d="M320 520 q280 280 560 0 q-40 200-280 200 t-280-200z" fill="url(#metal)"/><ellipse cx="600" cy="520" rx="280" ry="70" fill="${pal.highlight}" opacity=".55"/></g>`;
    case 'spatula':
      return `<g><rect x="560" y="240" width="80" height="520" rx="20" fill="${pal.shade}"/><rect x="500" y="700" width="200" height="160" rx="30" fill="${pal.item}"/><rect x="520" y="250" width="40" height="200" rx="8" fill="url(#glint)" opacity=".4"/></g>`;
    case 'skillet':
      return `<g><ellipse cx="560" cy="620" rx="320" ry="220" fill="url(#metal)"/><ellipse cx="560" cy="620" rx="240" ry="160" fill="${pal.shade}" opacity=".35"/><rect x="860" y="560" width="260" height="70" rx="30" fill="url(#metal)"/></g>`;
    case 'board':
      return `<g><rect x="260" y="360" width="680" height="460" rx="28" fill="${pal.item}"/><rect x="300" y="400" width="600" height="380" rx="16" fill="${pal.mid}"/><rect x="300" y="400" width="600" height="40" fill="${pal.shade}" opacity=".2"/></g>`;
    case 'panel':
      return `<g><rect x="280" y="280" width="640" height="640" rx="16" fill="url(#metal)"/><rect x="320" y="320" width="560" height="560" rx="8" fill="${pal.highlight}" opacity=".35"/><rect x="320" y="320" width="560" height="560" rx="8" fill="${pal.item}" opacity=".2"/></g>`;
    case 'lamp':
      return `<g><rect x="560" y="640" width="80" height="260" fill="${pal.shade}"/><polygon points="600,200 780,640 420,640" fill="url(#metal)"/><ellipse cx="600" cy="900" rx="160" ry="24" fill="${pal.shade}" opacity=".3"/></g>`;
    case 'bulb':
      return `<g><circle cx="600" cy="480" r="220" fill="${pal.item}"/><circle cx="520" cy="400" r="80" fill="url(#glint)" opacity=".5"/><rect x="540" y="680" width="120" height="140" rx="16" fill="url(#metal)"/><rect x="520" y="820" width="160" height="40" rx="8" fill="${pal.shade}"/></g>`;
    case 'boxes':
      return `<g><polygon points="400,700 600,800 800,700 800,480 600,380 400,480" fill="${pal.item}"/><polygon points="400,480 600,580 800,480 600,380" fill="${pal.highlight}" opacity=".5"/><polygon points="600,580 800,480 800,700 600,800" fill="${pal.shade}" opacity=".25"/></g>`;
    case 'mailers':
      return `<g><rect x="280" y="360" width="640" height="420" rx="12" fill="${pal.item}"/><polygon points="280,360 600,560 920,360" fill="${pal.highlight}" opacity=".55"/><path d="M280 780 L600 560 L920 780" fill="none" stroke="${pal.shade}" stroke-width="8" opacity=".3"/></g>`;
    case 'wrap':
      return `<g><rect x="260" y="420" width="680" height="280" rx="20" fill="${pal.item}"/><rect x="260" y="500" width="680" height="40" fill="${pal.highlight}" opacity=".4"/><circle cx="900" cy="560" r="90" fill="url(#metal)"/></g>`;
    case 'tote':
      return `<g><path d="M360 420 h480 l40 460 h-560z" fill="${pal.item}"/><path d="M430 420 v-120 a70 70 0 0 1 140 0 v120" fill="none" stroke="${pal.shade}" stroke-width="28"/><path d="M630 420 v-120 a70 70 0 0 1 140 0 v120" fill="none" stroke="${pal.shade}" stroke-width="28"/></g>`;
    case 'bag':
      return `<g><path d="M380 400 h440 l60 480 h-560z" fill="${pal.item}"/><path d="M500 400 v-80 a100 80 0 0 1 200 0 v80" fill="none" stroke="${pal.shade}" stroke-width="26"/><circle cx="600" cy="640" r="18" fill="${pal.shade}"/></g>`;
    default:
      return `<g><rect x="300" y="360" width="600" height="420" rx="24" fill="url(#metal)"/></g>`;
  }
}

export function productStudioSvg(scene: string, variant: number, pal: Pal, w = 800, h = 800) {
  const rot = [-10, 14, 2, 22][variant % 4];
  const zoom = [1, 1.12, 1.45, 0.86][variant % 4];
  const dy = [0, 30, -50, 70][variant % 4];
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
    <g transform="translate(600,${590 + dy}) rotate(${rot}) scale(${zoom}) translate(-600,-590)">${sceneShape(scene, pal)}</g>
  </svg>`;
}

export function studioDataUri(scene: string, variant: number, pal: Pal) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(productStudioSvg(scene, variant, pal))}`;
}

export function bannerDataUri(title: string, color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="640">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${color}"/>
        <stop offset="100%" stop-color="#0f3d57"/>
      </linearGradient>
      <radialGradient id="orb" cx="80%" cy="20%" r="50%">
        <stop offset="0%" stop-color="#ffffff33"/>
        <stop offset="100%" stop-color="#ffffff00"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <circle cx="1600" cy="80" r="380" fill="url(#orb)"/>
    <rect x="120" y="200" width="8" height="220" fill="#ffffff55"/>
    <text x="160" y="300" fill="#fff" font-family="Arial, sans-serif" font-size="64" font-weight="700">${title.replace(/&/g, '&amp;')}</text>
    <text x="160" y="360" fill="#ffffffcc" font-family="Arial, sans-serif" font-size="28">Source Easy sample</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function productPhotos(title: string, category: string, count = 4) {
  const pal = CATEGORY_PALETTES[category] ?? CATEGORY_PALETTES.Hardware;
  const scene = sceneFor(title, category);
  return Array.from({ length: count }, (_, v) => ({
    id: `${title}-${v}`,
    altText: `${title} (sample)`,
    cover: v === 0,
    url: studioDataUri(scene, v, pal),
    cardUrl: studioDataUri(scene, v, pal),
  }));
}
