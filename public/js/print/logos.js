// ==========================================================================
//  مكتبة الشعارات الرسمية لمتاجر ومصوغات الذهب (GOLDX Luxury Gold Brands)
//  شعار GOLDX المعتمد وشعارات محلات وسبائك الذهب الخالص عيار 24
// ==========================================================================

export function createSvgDataUrl(svgString) {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svgString.trim().replace(/\s+/g, ' '));
}

// 1. الشعار الرسمي المعتمد: GOLDX - سبائك ومصوغات الذهب الخالص
export const LOGO_GOLDX_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 140" width="180" height="140">
  <defs>
    <linearGradient id="gx-gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fff8cc"/>
      <stop offset="35%" stop-color="#ffd700"/>
      <stop offset="70%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#b45309"/>
    </linearGradient>
    <linearGradient id="gx-plate" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#fcfbf8"/>
    </linearGradient>
    <filter id="gx-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#b45309" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect x="4" y="4" width="172" height="132" rx="24" fill="url(#gx-plate)" stroke="url(#gx-gold)" stroke-width="2"/>
  <!-- صورة الشعار الرسمي GOLDX المعتمد -->
  <g clip-path="url(#gx-clip)" transform="translate(18, 12)">
    <image href="/img/logo-banner.jpg" x="0" y="0" width="144" height="116" preserveAspectRatio="xMidYMid meet" style="border-radius:14px;"/>
  </g>
</svg>`;

// 2. دار الذهب والمجوهرات الملكية (Royal Gold & Jewelry House)
export const LOGO_ROYAL_GOLD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 140" width="180" height="140">
  <defs>
    <linearGradient id="rg-gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fffbeb"/>
      <stop offset="30%" stop-color="#fef08a"/>
      <stop offset="60%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#b45309"/>
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="168" height="128" rx="22" fill="#ffffff" stroke="url(#rg-gold)" stroke-width="2"/>
  <!-- سبيكة الذهب الثلاثية الأبعاد المتقاطعة -->
  <g transform="translate(90, 52)" filter="drop-shadow(0 4px 6px rgba(180,83,9,0.3))">
    <path d="M-28 -12 L28 -12 L36 12 L-20 12 Z" fill="url(#rg-gold)"/>
    <path d="M-20 12 L36 12 L30 26 L-26 26 Z" fill="#d97706"/>
    <text x="5" y="4" font-family="'Cairo', sans-serif" font-size="9" font-weight="900" fill="#78350f" text-anchor="middle">999.9</text>
  </g>
  <text x="90" y="104" text-anchor="middle" font-family="'Cairo', sans-serif" font-size="12" font-weight="900" fill="#b45309">دار الذهب والمجوهرات</text>
  <text x="90" y="118" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="7" font-weight="700" fill="#d97706" letter-spacing="1.5">ROYAL JEWELRY EST.</text>
</svg>`;

// 3. مؤسسة سبائك الذهب الخالص (Pure Gold Bullion Trading)
export const LOGO_BULLION_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 140" width="180" height="140">
  <defs>
    <linearGradient id="bl-gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fff8cc"/>
      <stop offset="40%" stop-color="#ffd700"/>
      <stop offset="80%" stop-color="#d97706"/>
      <stop offset="100%" stop-color="#78350f"/>
    </linearGradient>
  </defs>
  <rect x="6" y="6" width="168" height="128" rx="22" fill="#ffffff" stroke="url(#bl-gold)" stroke-width="2"/>
  <g transform="translate(90, 50)" filter="drop-shadow(0 4px 8px rgba(180,83,9,0.35))">
    <polygon points="-35,-8 15,-8 35,14 -15,14" fill="url(#bl-gold)"/>
    <polygon points="-15,14 35,14 25,28 -25,28" fill="#b45309"/>
    <text x="2" y="7" font-family="sans-serif" font-size="8.5" font-weight="900" fill="#78350f" text-anchor="middle">AU 24K</text>
  </g>
  <text x="90" y="104" text-anchor="middle" font-family="'Cairo', sans-serif" font-size="12" font-weight="900" fill="#b45309">سبائك الذهب الخالص</text>
  <text x="90" y="118" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="7" font-weight="700" fill="#d97706" letter-spacing="1.5">PURE GOLD BULLION</text>
</svg>`;

export const PRESET_LOGOS = [
  {
    id: 'logo-goldx',
    name: 'شعار GOLDX المعتمد (سبائك الذهب)',
    name_en: 'GOLDX Official Logo',
    color: '#d4af37',
    badge: 'الشعار الرسمي المعتمد',
    svg: LOGO_GOLDX_SVG,
    dataUrl: '/img/logo-banner.jpg',
  },
  {
    id: 'logo-royal-gold',
    name: 'دار الذهب والمجوهرات الملكية',
    name_en: 'Royal Gold & Jewelry',
    color: '#b45309',
    badge: 'مجوهرات فاخرة',
    svg: LOGO_ROYAL_GOLD_SVG,
    dataUrl: createSvgDataUrl(LOGO_ROYAL_GOLD_SVG),
  },
  {
    id: 'logo-bullion',
    name: 'مؤسسة سبائك الذهب الخالص',
    name_en: 'Pure Gold Bullion',
    color: '#d97706',
    badge: 'تجارة السبائك 24K',
    svg: LOGO_BULLION_SVG,
    dataUrl: createSvgDataUrl(LOGO_BULLION_SVG),
  },
];

/**
 * بديل احترافي لشعار الذهب عند عدم رفع شعار خاص
 */
export function buildLogoPlaceholderSvg({
  brandColor = '#d4af37',
  brandDark = '#b45309',
  width = '26mm',
  height = '22mm',
} = {}) {
  return `<div class="logo-fallback" style="width:${width};height:${height};border-radius:10px;overflow:hidden;border:1px solid rgba(212,175,55,0.4);" title="شعار GOLDX">
    <img src="/img/logo-banner.jpg" alt="GOLDX" style="width:100%;height:100%;object-fit:cover;" />
  </div>`;
}
