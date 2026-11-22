// ==========================================================================
//  نظام الثيمات: الأبيض والذهبي الملكي (gold) + الأسود والذهبي الفاخر (dark)
// ==========================================================================

const STORAGE_KEY = 'goldx_theme';
const GOLD = 'gold';
const DARK = 'dark';

function normalize(t) {
  return t === DARK ? DARK : GOLD;
}

/** القيمة الحالية للثيم ('gold' أو 'dark'). */
export function current() {
  return normalize(document.documentElement.getAttribute('data-theme') || localStorage.getItem(STORAGE_KEY));
}

/** تطبيق الثيم المختار على الصفحة. */
export function apply(theme) {
  const next = normalize(theme);
  const isDark = next === DARK;
  document.documentElement.setAttribute('data-theme', next);
  document.documentElement.setAttribute('color-scheme', isDark ? 'dark' : 'light');
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  localStorage.setItem(STORAGE_KEY, next);

  const themeMeta = document.getElementById('theme-color-meta') || document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute('content', isDark ? '#0b0c10' : '#faf8f5');
  }
  window.dispatchEvent(new CustomEvent('goldx:theme-changed', { detail: { theme: next } }));
  return next;
}

/** التبديل بين الثيم الأبيض والأسود. */
export function toggle() {
  return apply(current() === DARK ? GOLD : DARK);
}

/** تهيئة الثيم عند تحميل الصفحة. */
export function init() {
  return apply(localStorage.getItem(STORAGE_KEY) || GOLD);
}
