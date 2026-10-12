// ==========================================================================
//  نظام أيقونات الذهب والمجوهرات الملكي الفاخر (Royal Luxury Jewelry Icon System)
//  تصميم فيكتور هندسي فائق الدقة (24x24) ثنائي التدرج (Duotone) مخصص لتجارة الذهب،
//  السبائك 999.9، أطقم الألماس، موازين الجرامات الحساسة، الفوترة والسندات المعتمدة.
// ==========================================================================

function createSvg(content, { size = 18, cls = '', style = '', stroke = 1.85 } = {}) {
  const s = Number(size) || 18;
  const inlineStyle = `vertical-align:middle;display:inline-block;flex-shrink:0;${style}`;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" class="ico ${cls}" style="${inlineStyle}">${content}</svg>`;
}

const rawIcons = {
  // ─── أيقونات الذهب والمصوغات التخصصية الفاخرة ─────────────────────────────────

  // سبيكة الذهب الخالص 999.9 (3D Beveled Gold Bullion Bar)
  goldBar: (opt) => createSvg(`
    <path d="M4.5 8h15l-2.2 4.5H6.7L4.5 8z" fill="currentColor" fill-opacity="0.22" stroke-width="1.8" />
    <path d="M6.7 12.5h10.6l1.2 5.5H5.5L6.7 12.5z" fill="currentColor" fill-opacity="0.35" stroke-width="1.8" />
    <path d="M4.5 8l-1.5 8 2.5 2H18.5l2.5-2-1.5-8H4.5z" stroke-width="2" />
    <line x1="6.7" y1="12.5" x2="17.3" y2="12.5" stroke-width="1.6" />
    <line x1="10" y1="10.2" x2="14" y2="10.2" stroke-width="1.4" />
    <line x1="9.5" y1="15.5" x2="14.5" y2="15.5" stroke-width="1.4" />
    <circle cx="12" cy="10.2" r="0.6" fill="currentColor" />
  `, opt),

  // خاتم الذهب المرصع بالألماس (Solitaire Diamond Ring with Sparkle Rays)
  goldRing: (opt) => createSvg(`
    <circle cx="12" cy="14" r="7" stroke-width="1.9" />
    <circle cx="12" cy="14" r="4.8" stroke-dasharray="2 3" stroke-width="1.2" opacity="0.6" />
    <path d="M9.5 4.5l2.5-2.5 2.5 2.5-2.5 2.5z" fill="currentColor" fill-opacity="0.25" stroke-width="1.8" />
    <path d="M10 4.5h4" stroke-width="1.4" />
    <line x1="12" y1="0.8" x2="12" y2="1.8" stroke-width="1.6" />
    <line x1="7.5" y1="2.5" x2="8.3" y2="3.3" stroke-width="1.4" />
    <line x1="16.5" y1="2.5" x2="15.7" y2="3.3" stroke-width="1.4" />
  `, opt),

  // ميزان الذهب الحساس للجرامات (Jeweler Precision Balance Scale)
  goldScale: (opt) => createSvg(`
    <line x1="12" y1="2.5" x2="12" y2="21.5" stroke-width="2.2" />
    <circle cx="12" cy="3" r="1.5" fill="currentColor" />
    <path d="M4 6.5l8-2 8 2" stroke-width="2" />
    <path d="M1.5 14l2.5-7.5 2.5 7.5a2.5 2.5 0 0 1-5 0z" fill="currentColor" fill-opacity="0.18" stroke-width="1.7" />
    <path d="M17.5 14l2.5-7.5 2.5 7.5a2.5 2.5 0 0 1-5 0z" fill="currentColor" fill-opacity="0.18" stroke-width="1.7" />
    <line x1="7" y1="21.5" x2="17" y2="21.5" stroke-width="2.4" />
    <rect x="10" y="18.5" width="4" height="3" rx="0.5" fill="currentColor" fill-opacity="0.2" />
  `, opt),

  // التاج الملكي للذهب (Royal Imperial Crown)
  crown: (opt) => createSvg(`
    <path d="M2.5 18h19l-2.2-10.5-4.3 4.2-3-7.5-3 7.5-4.3-4.2L2.5 18z" fill="currentColor" fill-opacity="0.18" stroke-width="1.8" />
    <circle cx="2.5" cy="7.5" r="1.1" fill="currentColor" />
    <circle cx="8" cy="4.8" r="1.1" fill="currentColor" />
    <circle cx="12" cy="2.5" r="1.4" fill="currentColor" />
    <circle cx="16" cy="4.8" r="1.1" fill="currentColor" />
    <circle cx="21.5" cy="7.5" r="1.1" fill="currentColor" />
    <line x1="3.5" y1="18" x2="20.5" y2="18" stroke-width="2.4" />
    <line x1="4.5" y1="20.5" x2="19.5" y2="20.5" stroke-width="1.4" />
  `, opt),

  // حبة الألماس اللامعة (Faceted Brilliant Diamond)
  diamond: (opt) => createSvg(`
    <path d="M6 3.5h12l4.5 5.5-10.5 12.5L1.5 9 6 3.5z" fill="currentColor" fill-opacity="0.15" stroke-width="1.9" />
    <path d="M1.5 9h21" stroke-width="1.7" />
    <path d="M12 21.5L7.5 9 5.5 3.5" stroke-width="1.5" />
    <path d="M12 21.5l4.5-12.5 2-5.5" stroke-width="1.5" />
    <path d="M9.5 3.5l-2 5.5 4.5 12.5" stroke-width="1.2" opacity="0.5" />
  `, opt),

  // ختم فحص عيار الذهب الرسمي (Official Hallmark Assay Stamp)
  stamp: (opt) => createSvg(`
    <circle cx="12" cy="12" r="9.5" stroke-width="1.8" />
    <circle cx="12" cy="12" r="7.5" stroke-dasharray="1.5 2" stroke-width="1.2" />
    <polygon points="12,5.5 13.9,9.4 18.2,10 15.1,13 15.8,17.2 12,15.2 8.2,17.2 8.9,13 5.8,10 10.1,9.4" fill="currentColor" fill-opacity="0.22" stroke-width="1.4" />
  `, opt),

  // ─── وثائق ومحررات فواتير الذهب المعتمدة ──────────────────────────────────

  // فاتورة ذهب رسمية مع شريط وختم معتمد (Certified Gold Invoice)
  invoice: (opt) => createSvg(`
    <path d="M14 2H5.5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V8l-6.5-6z" fill="currentColor" fill-opacity="0.08" stroke-width="1.8" />
    <polyline points="14 2 14 8 20 8" stroke-width="1.8" fill="currentColor" fill-opacity="0.2" />
    <circle cx="12" cy="14.5" r="3.2" fill="currentColor" fill-opacity="0.2" stroke-width="1.6" />
    <path d="M12 13v3M10.5 14.5h3" stroke-width="1.4" />
    <line x1="6.5" y1="19.5" x2="17.5" y2="19.5" stroke-width="1.6" />
    <line x1="6.5" y1="9" x2="10.5" y2="9" stroke-width="1.6" />
  `, opt),

  // فاتورة ذهب جديدة مع بريق سبيكة (+) (New Gold Invoice with Gem Sparkle)
  invoicePlus: (opt) => createSvg(`
    <path d="M14 2H5.5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V8l-6.5-6z" fill="currentColor" fill-opacity="0.1" stroke-width="1.8" />
    <polyline points="14 2 14 8 20 8" stroke-width="1.8" fill="currentColor" fill-opacity="0.25" />
    <circle cx="12" cy="14.5" r="4" fill="currentColor" fill-opacity="0.15" />
    <path d="M12 11.5v6M9 14.5h6" stroke-width="2.6" />
    <path d="M7 6l1-1 1 1-1 1z" fill="currentColor" stroke-width="0.8" />
  `, opt),

  // فاتورة ذهب مدفوعة ومحققة (Paid & Verified Gold Invoice)
  invoiceCheck: (opt) => createSvg(`
    <path d="M14 2H5.5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V8l-6.5-6z" fill="currentColor" fill-opacity="0.08" stroke-width="1.8" />
    <polyline points="14 2 14 8 20 8" stroke-width="1.8" />
    <circle cx="12" cy="14.5" r="4.2" fill="currentColor" fill-opacity="0.2" stroke-width="1.6" />
    <path d="m9.8 14.5 1.6 1.6 3.2-3.2" stroke-width="2.4" />
  `, opt),

  // فاتورة ملغاة (Canceled Invoice)
  invoiceX: (opt) => createSvg(`
    <path d="M14 2H5.5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V8l-6.5-6z" stroke-width="1.8" />
    <polyline points="14 2 14 8 20 8" stroke-width="1.8" />
    <circle cx="12" cy="14.5" r="4.2" fill="currentColor" fill-opacity="0.1" />
    <line x1="9.8" x2="14.2" y1="12.3" y2="16.7" stroke-width="2.2" />
    <line x1="14.2" x2="9.8" y1="12.3" y2="16.7" stroke-width="2.2" />
  `, opt),

  // سند قبض مالي للذهب مع وسام نقدية (Gold Cash Voucher with Security Medal)
  receipt: (opt) => createSvg(`
    <rect width="20.5" height="13.5" x="1.75" y="5.25" rx="2.5" fill="currentColor" fill-opacity="0.1" stroke-width="1.9" />
    <circle cx="12" cy="12" r="3.8" fill="currentColor" fill-opacity="0.25" stroke-width="1.7" />
    <path d="M12 9.5v5M10.8 11.2h2.4" stroke-width="1.5" />
    <line x1="5.2" x2="5.2" y1="9" y2="15" stroke-width="1.8" stroke-linecap="round" />
    <line x1="18.8" x2="18.8" y1="9" y2="15" stroke-width="1.8" stroke-linecap="round" />
  `, opt),

  // كشف حساب عميل ذهب مفصل (Client Gold Account Statement)
  statement: (opt) => createSvg(`
    <rect width="8" height="3.5" x="8" y="2" rx="1.2" fill="currentColor" fill-opacity="0.2" stroke-width="1.6" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" stroke-width="1.8" />
    <line x1="8" y1="10" x2="16" y2="10" stroke-width="1.8" />
    <line x1="8" y1="14" x2="16" y2="14" stroke-width="1.8" />
    <line x1="8" y1="18" x2="13" y2="18" stroke-width="1.8" />
    <circle cx="16" cy="18" r="1.5" fill="currentColor" />
  `, opt),

  // تقارير مالية وتدفقات أوزان الذهب (Financial Growth Chart & Star Peak)
  report: (opt) => createSvg(`
    <line x1="18" x2="18" y1="20" y2="7.5" stroke-width="2.5" stroke-linecap="round" />
    <line x1="12" x2="12" y1="20" y2="11.5" stroke-width="2.5" stroke-linecap="round" />
    <line x1="6" x2="6" y1="20" y2="15.5" stroke-width="2.5" stroke-linecap="round" />
    <polygon points="18,3.5 19.3,6.2 22.2,6.5 20,8.5 20.6,11.4 18,9.9 15.4,11.4 16,8.5 13.8,6.5 16.7,6.2" fill="currentColor" fill-opacity="0.35" stroke-width="1.2" />
    <path d="M3 21h18" stroke-width="2.2" />
    <polyline points="5 13 11 9 17 5" stroke-width="1.4" stroke-dasharray="2 2" opacity="0.6" />
  `, opt),

  // قوالب فواتير الذهب المزخرفة (Gold Invoice Templates Layout)
  layoutTemplate: (opt) => createSvg(`
    <rect width="18.5" height="18.5" x="2.75" y="2.75" rx="3.5" fill="currentColor" fill-opacity="0.08" stroke-width="1.8" />
    <path d="M2.75 8.5h18.5" stroke-width="1.6" />
    <path d="M8.5 8.5v12.75" stroke-width="1.6" />
    <circle cx="5.5" cy="5.6" r="1.2" fill="currentColor" />
    <polygon points="15.5,13 16.5,15.2 18.8,15.5 17,17.2 17.5,19.5 15.5,18.3 13.5,19.5 14,17.2 12.2,15.5 14.5,15.2" fill="currentColor" fill-opacity="0.25" stroke-width="1.1" />
  `, opt),

  // محرر قوالب الذهب الاحترافي (Gold Template Builder / Designer)
  templateBuilder: (opt) => createSvg(`
    <path d="M14 2H5.5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V8z" stroke-width="1.8" />
    <polyline points="14 2 14 8 20 8" stroke-width="1.8" />
    <path d="M13.5 10.5l4 4-6 6H7.5v-4l6-6z" fill="currentColor" fill-opacity="0.22" stroke-width="1.7" />
    <line x1="12" y1="12" x2="16" y2="16" stroke-width="1.2" />
  `, opt),

  // ─── أصناف الذهب والكيانات والمستخدمين ────────────────────────────────────

  // صندوق المجوهرات الفاخر / صنف ذهبي (Luxury Jewelry Box / Package)
  package: (opt) => createSvg(`
    <path d="M16.5 9.4 7.55 4.24a1.78 1.78 0 0 0-2.5 1.55v12.42a1.78 1.78 0 0 0 2.5 1.55L16.5 14.6a1.78 1.78 0 0 0 0-3.1z" fill="currentColor" fill-opacity="0.12" stroke-width="1.7" />
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" stroke-width="1.8" />
    <polyline points="3.29 7 12 12 20.71 7" stroke-width="1.6" />
    <line x1="12" y1="22" x2="12" y2="12" stroke-width="1.8" />
  `, opt),

  // عملاء المتجر VIP (VIP Gold Clients with Diamond)
  users: (opt) => createSvg(`
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke-width="1.9" />
    <circle cx="9" cy="7" r="4" fill="currentColor" fill-opacity="0.18" stroke-width="1.9" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" stroke-width="1.7" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" stroke-width="1.7" />
    <polygon points="9,2 10,4.2 12,4.5 10.5,6 11,8 9,7 7,8 7.5,6 6,4.5 8,4.2" fill="currentColor" fill-opacity="0.3" stroke-width="0.8" />
  `, opt),

  user: (opt) => createSvg(`
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" stroke-width="2" />
    <circle cx="12" cy="7" r="4.2" fill="currentColor" fill-opacity="0.2" stroke-width="2" />
  `, opt),

  usersManage: (opt) => createSvg(`
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke-width="1.8" />
    <circle cx="9" cy="7" r="4" fill="currentColor" fill-opacity="0.18" stroke-width="1.8" />
    <circle cx="18.5" cy="11.5" r="3.5" fill="currentColor" fill-opacity="0.25" stroke-width="1.6" />
    <path d="M18.5 9.5v4M16.5 11.5h4" stroke-width="1.8" />
  `, opt),

  // فرع ومؤسسة تجارة الذهب (Jewelry Store Building / Boutique)
  building: (opt) => createSvg(`
    <rect width="16" height="20" x="4" y="2" rx="2" fill="currentColor" fill-opacity="0.08" stroke-width="1.8" />
    <path d="M9 22v-4h6v4" stroke-width="1.8" fill="currentColor" fill-opacity="0.2" />
    <line x1="8" y1="6" x2="8.01" y2="6" stroke-width="2.6" />
    <line x1="16" y1="6" x2="16.01" y2="6" stroke-width="2.6" />
    <line x1="8" y1="10" x2="8.01" y2="10" stroke-width="2.6" />
    <line x1="16" y1="10" x2="16.01" y2="10" stroke-width="2.6" />
    <line x1="8" y1="14" x2="8.01" y2="14" stroke-width="2.6" />
    <line x1="16" y1="14" x2="16.01" y2="14" stroke-width="2.6" />
  `, opt),

  // المتجر الرئيسي / الواجهة (Luxury Storefront Palace)
  home: (opt) => createSvg(`
    <path d="M3 10.5 12 3l9 7.5v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9z" fill="currentColor" fill-opacity="0.12" stroke-width="1.8" />
    <path d="M9 21.5v-6.5a3 3 0 0 1 6 0v6.5" fill="currentColor" fill-opacity="0.25" stroke-width="1.8" />
    <circle cx="12" cy="7.8" r="1.5" fill="currentColor" />
  `, opt),

  dashboard: (opt) => createSvg(`
    <rect width="8" height="9" x="3" y="3" rx="2" fill="currentColor" fill-opacity="0.2" stroke-width="1.8" />
    <rect width="8" height="5" x="13" y="3" rx="2" stroke-width="1.8" />
    <rect width="8" height="9" x="13" y="12" rx="2" fill="currentColor" fill-opacity="0.2" stroke-width="1.8" />
    <rect width="8" height="5" x="3" y="16" rx="2" stroke-width="1.8" />
  `, opt),

  // درع الحماية والرقابة الملكي (Royal Crest Audit Shield)
  shieldCheck: (opt) => createSvg(`
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="currentColor" fill-opacity="0.15" stroke-width="1.9" />
    <path d="m9 12 2 2 4-4" stroke-width="2.4" />
  `, opt),

  shield: (opt) => createSvg(`
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="currentColor" fill-opacity="0.12" stroke-width="1.9" />
  `, opt),

  // تروس إعدادات الصائغ الدقيقة (Jewel Watchmaker Precision Gears)
  settings: (opt) => createSvg(`
    <circle cx="12" cy="12" r="3.2" fill="currentColor" fill-opacity="0.25" stroke-width="1.8" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" stroke-width="1.8" />
  `, opt),

  calculator: (opt) => createSvg(`
    <rect width="16" height="20" x="4" y="2" rx="3" fill="currentColor" fill-opacity="0.1" stroke-width="1.8" />
    <rect width="10" height="4" x="7" y="5" rx="1" fill="currentColor" fill-opacity="0.2" stroke-width="1.4" />
    <circle cx="8" cy="13" r="1" fill="currentColor" />
    <circle cx="12" cy="13" r="1" fill="currentColor" />
    <circle cx="16" cy="13" r="1" fill="currentColor" />
    <circle cx="8" cy="17" r="1" fill="currentColor" />
    <circle cx="12" cy="17" r="1" fill="currentColor" />
    <circle cx="16" cy="17" r="1" fill="currentColor" />
  `, opt),

  bank: (opt) => createSvg(`
    <polygon points="12,2 2,7 22,7" fill="currentColor" fill-opacity="0.25" stroke-width="1.8" />
    <line x1="4" y1="10" x2="4" y2="18" stroke-width="2" />
    <line x1="9.3" y1="10" x2="9.3" y2="18" stroke-width="2" />
    <line x1="14.7" y1="10" x2="14.7" y2="18" stroke-width="2" />
    <line x1="20" y1="10" x2="20" y2="18" stroke-width="2" />
    <line x1="2" y1="21" x2="22" y2="21" stroke-width="2.5" />
    <line x1="2" y1="7" x2="22" y2="7" stroke-width="1.8" />
  `, opt),

  wallet: (opt) => createSvg(`
    <path d="M19 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h15a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" fill="currentColor" fill-opacity="0.12" stroke-width="1.8" />
    <path d="M16 12h5v4h-5a2 2 0 0 1-2-2 2 2 0 0 1 2-2z" fill="currentColor" fill-opacity="0.25" stroke-width="1.6" />
    <circle cx="17.5" cy="14" r="1" fill="currentColor" />
  `, opt),

  card: (opt) => createSvg(`
    <rect width="20" height="14" x="2" y="5" rx="2.5" fill="currentColor" fill-opacity="0.1" stroke-width="1.8" />
    <line x1="2" y1="10" x2="22" y2="10" stroke-width="2" />
    <line x1="6" y1="15" x2="10" y2="15" stroke-width="2" />
  `, opt),

  coins: (opt) => createSvg(`
    <circle cx="8" cy="8" r="6" fill="currentColor" fill-opacity="0.18" stroke-width="1.8" />
    <path d="M18.09 10.37A6 6 0 1 1 10.34 18" stroke-width="1.8" />
    <path d="M7 6h2M8 5v2" stroke-width="1.4" />
  `, opt),

  money: (opt) => createSvg(`
    <rect width="20" height="12" x="2" y="6" rx="2" fill="currentColor" fill-opacity="0.12" stroke-width="1.8" />
    <circle cx="12" cy="12" r="2.8" fill="currentColor" fill-opacity="0.25" stroke-width="1.6" />
    <path d="M6 12h.01M18 12h.01" stroke-width="2.4" />
  `, opt),

  signature: (opt) => createSvg(`
    <path d="m21 17-2.15-2.15a1 1 0 0 0-1.41 0L12 20.25 15.75 24l5.4-5.4a1 1 0 0 0 0-1.42Z" stroke-width="1.8" />
    <path d="M3 21h7" stroke-width="2" />
    <path d="M3 10c2.5-3 5-3 7.5 0s5 3 7.5 0" stroke-width="1.8" />
  `, opt),

  qrCode: (opt) => createSvg(`
    <rect width="5" height="5" x="3" y="3" rx="1" fill="currentColor" fill-opacity="0.3" stroke-width="1.8" />
    <rect width="5" height="5" x="16" y="3" rx="1" fill="currentColor" fill-opacity="0.3" stroke-width="1.8" />
    <rect width="5" height="5" x="3" y="16" rx="1" fill="currentColor" fill-opacity="0.3" stroke-width="1.8" />
    <path d="M21 16h-3v5h3M12 7v3M7 12h3M12 12h5v5h-5z" stroke-width="1.6" />
  `, opt),

  sparkles: (opt) => createSvg(`
    <path d="m12 3 2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5L12 3z" fill="currentColor" fill-opacity="0.25" stroke-width="1.7" />
    <path d="M19 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z" fill="currentColor" stroke-width="0.8" />
    <path d="M5 4l.8 1.5 1.5.8-1.5.8-.8 1.5-.8-1.5-1.5-.8 1.5-.8.8-1.5z" fill="currentColor" stroke-width="0.8" />
  `, opt),

  lock: (opt) => createSvg(`
    <rect width="18" height="11" x="3" y="11" rx="2" fill="currentColor" fill-opacity="0.14" stroke-width="1.8" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke-width="2" />
    <circle cx="12" cy="16" r="1.5" fill="currentColor" />
  `, opt),

  key: (opt) => createSvg(`
    <circle cx="7.5" cy="15.5" r="4.5" fill="currentColor" fill-opacity="0.2" stroke-width="1.8" />
    <path d="m10.7 12.3 8.3-8.3M15.5 7.5l2 2M18.5 4.5l2 2" stroke-width="2" />
  `, opt),

  // طابعة الفواتير الليزرية المعتمدة (Modern Gold Invoice Printer)
  printer: (opt) => createSvg(`
    <polyline points="6 9 6 2 18 2 18 9" stroke-width="1.8" fill="currentColor" fill-opacity="0.1" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" stroke-width="1.9" />
    <rect width="12" height="8" x="6" y="14" rx="1.5" fill="currentColor" fill-opacity="0.25" stroke-width="1.8" />
    <line x1="8.5" y1="17" x2="15.5" y2="17" stroke-width="1.4" />
    <circle cx="18.5" cy="13.5" r="1" fill="currentColor" />
  `, opt),

  // ملف إكسل المعتمد (Excel Spreadsheet with Ribbon Grid)
  fileSpreadsheet: (opt) => createSvg(`
    <path d="M14 2H5.5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V8z" fill="currentColor" fill-opacity="0.1" stroke-width="1.8" />
    <polyline points="14 2 14 8 20 8" stroke-width="1.8" fill="currentColor" fill-opacity="0.25" />
    <rect width="10" height="7.5" x="7" y="12" rx="1" fill="currentColor" fill-opacity="0.18" stroke-width="1.5" />
    <line x1="7" y1="15.7" x2="17" y2="15.7" stroke-width="1.3" />
    <line x1="12" y1="12" x2="12" y2="19.5" stroke-width="1.3" />
  `, opt),

  fileText: (opt) => createSvg(`
    <path d="M14 2H5.5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V8z" stroke-width="1.8" />
    <polyline points="14 2 14 8 20 8" stroke-width="1.8" />
    <line x1="8" y1="12" x2="16" y2="12" stroke-width="1.8" />
    <line x1="8" y1="16" x2="14" y2="16" stroke-width="1.8" />
  `, opt),

  pdf: (opt) => createSvg(`
    <path d="M14 2H5.5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V8z" stroke-width="1.8" />
    <polyline points="14 2 14 8 20 8" stroke-width="1.8" fill="currentColor" fill-opacity="0.2" />
    <path d="M6.5 17v-4.5h2a1.5 1.5 0 0 1 0 3h-2" stroke-width="1.6" />
    <path d="M11.5 12.5v4.5M14.5 12.5h1.5a1.5 1.5 0 0 1 1.5 1.5v1.5a1.5 1.5 0 0 1-1.5 1.5h-1.5" stroke-width="1.6" />
  `, opt),

  xml: (opt) => createSvg(`
    <polyline points="15 8 19 12 15 16" stroke-width="2" />
    <polyline points="9 8 5 12 9 16" stroke-width="2" />
    <line x1="13" y1="6" x2="11" y2="18" stroke-width="1.8" />
  `, opt),

  htmlFile: (opt) => createSvg(`
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke-width="1.8" />
    <polyline points="14 2 14 8 20 8" stroke-width="1.8" />
    <polyline points="9 13 7 15 9 17" stroke-width="1.8" />
    <polyline points="15 13 17 15 15 17" stroke-width="1.8" />
  `, opt),

  palette: (opt) => createSvg(`
    <circle cx="13.5" cy="6.5" r="1.5" fill="currentColor" />
    <circle cx="17.5" cy="10.5" r="1.5" fill="currentColor" />
    <circle cx="8.5" cy="7.5" r="1.5" fill="currentColor" />
    <circle cx="6.5" cy="12.5" r="1.5" fill="currentColor" />
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.4-.4-.8-.4-1.3 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-5.5-4.5-9.6-10-9.6z" stroke-width="1.8" fill="currentColor" fill-opacity="0.08" />
  `, opt),

  layers: (opt) => createSvg(`
    <polygon points="12 2 2 7 12 12 22 7 12 2" fill="currentColor" fill-opacity="0.25" stroke-width="1.8" />
    <polyline points="2 12 12 17 22 12" stroke-width="1.8" />
    <polyline points="2 17 12 22 22 17" stroke-width="1.8" />
  `, opt),

  bulk: (opt) => createSvg(`
    <rect width="13" height="13" x="8" y="8" rx="2" fill="currentColor" fill-opacity="0.18" stroke-width="1.8" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" stroke-width="1.8" />
    <line x1="12" y1="12" x2="17" y2="12" stroke-width="1.8" />
    <line x1="12" y1="16" x2="17" y2="16" stroke-width="1.8" />
  `, opt),

  download: (opt) => createSvg(`
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke-width="2" />
    <polyline points="7 10 12 15 17 10" stroke-width="2.2" />
    <line x1="12" x2="12" y1="15" y2="3" stroke-width="2.2" />
  `, opt),

  upload: (opt) => createSvg(`
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke-width="2" />
    <polyline points="17 8 12 3 7 8" stroke-width="2.2" />
    <line x1="12" x2="12" y1="3" y2="15" stroke-width="2.2" />
  `, opt),

  share: (opt) => createSvg(`
    <circle cx="18" cy="5" r="3" fill="currentColor" fill-opacity="0.2" stroke-width="1.8" />
    <circle cx="6" cy="12" r="3" fill="currentColor" fill-opacity="0.2" stroke-width="1.8" />
    <circle cx="18" cy="19" r="3" fill="currentColor" fill-opacity="0.2" stroke-width="1.8" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" stroke-width="1.8" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" stroke-width="1.8" />
  `, opt),

  eye: (opt) => createSvg(`
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke-width="1.9" />
    <circle cx="12" cy="12" r="3.5" fill="currentColor" fill-opacity="0.25" stroke-width="1.8" />
  `, opt),

  edit: (opt) => createSvg(`
    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" fill="currentColor" fill-opacity="0.12" stroke-width="1.9" />
    <line x1="15" y1="5" x2="19" y2="9" stroke-width="1.6" />
  `, opt),

  trash: (opt) => createSvg(`
    <path d="M3 6h18" stroke-width="2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" stroke-width="1.9" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke-width="1.8" />
    <line x1="10" y1="11" x2="10" y2="17" stroke-width="1.8" stroke-linecap="round" />
    <line x1="14" y1="11" x2="14" y2="17" stroke-width="1.8" stroke-linecap="round" />
  `, opt),

  copy: (opt) => createSvg(`
    <rect width="13" height="13" x="8" y="8" rx="2.5" fill="currentColor" fill-opacity="0.18" stroke-width="1.8" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" stroke-width="1.8" />
  `, opt),

  check: (opt) => createSvg('<polyline points="20 6 9 17 4 12" stroke-width="2.5"/>', opt),
  checkCircle: (opt) => createSvg('<circle cx="12" cy="12" r="10" fill="currentColor" fill-opacity="0.15" stroke-width="1.9"/><path d="m9 12 2 2 4-4" stroke-width="2.4"/>', opt),
  alertCircle: (opt) => createSvg('<circle cx="12" cy="12" r="10" fill="currentColor" fill-opacity="0.15" stroke-width="1.9"/><line x1="12" y1="8" x2="12" y2="12" stroke-width="2.4"/><line x1="12" y1="16" x2="12.01" y2="16" stroke-width="2.8"/>', opt),
  xCircle: (opt) => createSvg('<circle cx="12" cy="12" r="10" stroke-width="1.9"/><line x1="15" y1="9" x2="9" y2="15" stroke-width="2.2"/><line x1="9" y1="9" x2="15" y2="15" stroke-width="2.2"/>', opt),
  info: (opt) => createSvg('<circle cx="12" cy="12" r="10" fill="currentColor" fill-opacity="0.15" stroke-width="1.9"/><line x1="12" y1="16" x2="12" y2="12" stroke-width="2.2"/><circle cx="12" cy="8" r="1" fill="currentColor"/>', opt),

  // تحديث / إعادة تعيين مع حركة ذهبية (Gilded Refresh / Reset)
  refresh: (opt) => createSvg(`
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" stroke-width="2" />
    <path d="M21 3v5h-5" stroke-width="2" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" stroke-width="2" />
    <path d="M3 21v-5h5" stroke-width="2" />
  `, opt),

  // عدسة الفحص والبحث الدقيق (Jeweler Loupe Search Lens)
  search: (opt) => createSvg(`
    <circle cx="10.5" cy="10.5" r="7.5" fill="currentColor" fill-opacity="0.12" stroke-width="2" />
    <line x1="21" y1="21" x2="15.8" y2="15.8" stroke-width="2.5" />
    <circle cx="9" cy="9" r="2" stroke-width="1.2" opacity="0.6" />
  `, opt),

  // قمع التصفية الماسي (Diamond Filter Funnel)
  filter: (opt) => createSvg(`
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" fill="currentColor" fill-opacity="0.18" stroke-width="1.9" />
  `, opt),

  plus: (opt) => createSvg('<line x1="12" y1="5" x2="12" y2="19" stroke-width="2.5"/><line x1="5" y1="12" x2="19" y2="12" stroke-width="2.5"/>', opt),
  arrowRight: (opt) => createSvg('<line x1="5" y1="12" x2="19" y2="12" stroke-width="2"/><polyline points="12 5 19 12 12 19" stroke-width="2"/>', opt),
  arrowLeft: (opt) => createSvg('<line x1="19" y1="12" x2="5" y2="12" stroke-width="2"/><polyline points="12 19 5 12 12 5" stroke-width="2"/>', opt),
  chevronDown: (opt) => createSvg('<polyline points="6 9 12 15 18 9" stroke-width="2.4"/>', opt),
  chevronLeft: (opt) => createSvg('<polyline points="15 18 9 12 15 6" stroke-width="2.4"/>', opt),
  chevronRight: (opt) => createSvg('<polyline points="9 18 15 12 9 6" stroke-width="2.4"/>', opt),

  userPlus: (opt) => createSvg(`
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke-width="1.9" />
    <circle cx="8.5" cy="7" r="4" fill="currentColor" fill-opacity="0.18" stroke-width="1.9" />
    <line x1="20" y1="8" x2="20" y2="14" stroke-width="2.4" />
    <line x1="23" y1="11" x2="17" y2="11" stroke-width="2.4" />
  `, opt),

  // تقويم فترات الذهب الفاخر (Royal Jewelry Calendar)
  calendar: (opt) => createSvg(`
    <rect width="18" height="17" x="3" y="4.5" rx="3" fill="currentColor" fill-opacity="0.12" stroke-width="1.9" />
    <line x1="16" y1="2" x2="16" y2="5.5" stroke-width="2.2" stroke-linecap="round" />
    <line x1="8" y1="2" x2="8" y2="5.5" stroke-width="2.2" stroke-linecap="round" />
    <line x1="3" y1="9.5" x2="21" y2="9.5" stroke-width="1.8" />
    <circle cx="8" cy="14" r="1.1" fill="currentColor" />
    <circle cx="12" cy="14" r="1.1" fill="currentColor" />
    <circle cx="16" cy="14" r="1.1" fill="currentColor" />
    <circle cx="8" cy="17.5" r="1.1" fill="currentColor" />
    <circle cx="12" cy="17.5" r="1.1" fill="currentColor" />
  `, opt),

  whatsapp: (opt) => createSvg(`
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="currentColor" fill-opacity="0.15" stroke-width="1.9" />
  `, opt),

  bell: (opt) => createSvg(`
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" fill="currentColor" fill-opacity="0.15" stroke-width="1.9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" stroke-width="2" />
  `, opt),

  pencil: (opt) => createSvg('<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" fill="currentColor" fill-opacity="0.15" stroke-width="1.8"/>', opt),
  phone: (opt) => createSvg('<rect width="14" height="20" x="5" y="2" rx="2.5" fill="currentColor" fill-opacity="0.1" stroke-width="1.9"/><line x1="12" y1="18" x2="12.01" y2="18" stroke-width="2.5"/>', opt),
  laptop: (opt) => createSvg('<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16" fill="currentColor" fill-opacity="0.1" stroke-width="1.8"/>', opt),
  desktop: (opt) => createSvg('<rect width="20" height="14" x="2" y="3" rx="2.5" fill="currentColor" fill-opacity="0.1" stroke-width="1.8"/><line x1="8" y1="21" x2="16" y2="21" stroke-width="2.2"/><line x1="12" y1="17" x2="12" y2="21" stroke-width="2.2"/>', opt),

  sar: (opt) => sarSvg(opt),
  riyal: (opt) => sarSvg(opt),
  riyadhTower: (opt) => riyadhTowerSvg(opt),

  sun: (opt) => createSvg('<circle cx="12" cy="12" r="4.5" fill="currentColor" fill-opacity="0.25" stroke-width="1.8"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" stroke-width="2"/>', opt),
  moon: (opt) => createSvg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" fill="currentColor" fill-opacity="0.2" stroke-width="1.9"/>', opt),
};

// حاوية أمان عبر Proxy لضمان عدم تعطل أي واجهة في حال استدعاء أي أيقونة غير معرّفة مستقبلاً
export const icon = new Proxy(rawIcons, {
  get(target, prop) {
    if (prop in target) return target[prop];
    return (opt) => createSvg('<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>', opt);
  },
});

/**
 * الرمز والشعار الرسمي الجديد للريال السعودي (ساما - أمر ملكي 2025 - يونيكود U+20C1)
 * تصميم فيكتور نقي (Vector SVG) يتناسب انسيابياً مع أسطر النصوص والأرقام والطباعة.
 */
export function sarSvg({ size = 16, cls = '', style = '' } = {}) {
  const s = typeof size === 'number' ? `${size}px` : size;
  const inlineStyle = `vertical-align:-0.14em;display:inline-block;fill:currentColor;flex-shrink:0;${style}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1124.14 1256.39" width="${s}" height="${s}" class="sar-sym-svg ${cls}" style="${inlineStyle}" aria-label="ريال سعودي" title="ريال سعودي" role="img"><path d="M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z"/><path d="M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z"/></svg>`;
}

/**
 * أيقونة برج الرياض (المعلم المعماري الأيقوني للعاصمة - برج المملكة) بالذهب الملكي
 */
export function riyadhTowerSvg({ size = 36, color = '#b8860b', cls = '', style = '' } = {}) {
  const h = typeof size === 'number' ? `${size}px` : size;
  const inlineStyle = `vertical-align:middle;display:inline-block;flex-shrink:0;${style}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140" height="${h}" class="riyadh-tower-svg ${cls}" fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round" style="${inlineStyle}">
    <line x1="16" y1="135" x2="84" y2="135" stroke-width="2.5" />
    <path d="M 26 135 L 30 50 Q 32 15 40 10 L 60 10 Q 68 15 70 50 L 74 135 Z" stroke-width="2.2" fill="${color}" fill-opacity="0.04" />
    <path d="M 39 10 L 61 10 L 61 15 L 39 15 Z" fill="${color}" stroke="${color}" stroke-width="1.5" />
    <path d="M 39 15 C 41 42 46 68 50 68 C 54 68 59 42 61 15 Z" fill="none" stroke="${color}" stroke-width="2" />
    <line x1="50" y1="68" x2="50" y2="135" stroke-width="1.5" stroke-dasharray="3 3" />
    <line x1="35" y1="85" x2="65" y2="85" stroke-width="1" />
    <line x1="33" y1="102" x2="67" y2="102" stroke-width="1" />
    <line x1="30" y1="119" x2="70" y2="119" stroke-width="1" />
  </svg>`;
}
