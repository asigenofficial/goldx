// ==========================================================================
//  نظام الثيم الذهبي والأبيض الملكي الفاخر (Gold & White Theme Only)
//  ملغى الثيم الداكن والأسود بالكامل تماشياً مع متطلبات متجر الذهب.
// ==========================================================================

const STORAGE_KEY = 'goldx_theme';
const GOLD = 'gold';

/** القيمة الحالية للثيم (ذهبي وأبيض دائماً). */
export function current() {
  return GOLD;
}

/** تطبيق الثيم الذهبي الملكي على الصفحة. */
export function apply(theme) {
  document.documentElement.setAttribute('data-theme', GOLD);
  document.documentElement.setAttribute('color-scheme', 'light');
  localStorage.setItem(STORAGE_KEY, GOLD);

  // تحديث لون شريط المتصفح على الهواتف والشاشات
  const themeMeta = document.getElementById('theme-color-meta') || document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute('content', '#faf8f5');
  }
}

/** الثيم مثبت على الذهبي والأبيض فقط. */
export function toggle() {
  apply(GOLD);
}

/** تهيئة الثيم عند تحميل الصفحة. */
export function init() {
  apply(GOLD);
}
