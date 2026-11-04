// ==========================================================================
//  goldx — إدارة وحالة الاتصال بالإنترنت والنافذة التفاعلية (Connectivity Hub)
//  تنبيه المستخدم عند انقطاع الإنترنت مع أيقونة واي فاي متحركة باللغة العربية
// ==========================================================================
import { toastOk, toastErr } from './util.js';

let activeNoInternetModal = null;
let pendingRetryCallbacks = [];

/**
 * فحص حالة اتصال المتصفح الحالية
 */
export function isOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

/**
 * فحص نشط حقيقي للاتصال عبر إرسال طلب خفيف (Ping)
 */
export async function pingConnection(timeoutMs = 2500) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // نطلب عنوان الرأس الخفيف مع تعطيل الكاش للتأكد من الشبكة
    const res = await fetch('/api/health?t=' + Date.now(), {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok || res.status < 500;
  } catch (_) {
    return false;
  }
}

/**
 * إظهار نافذة "لا يوجد اتصال بالإنترنت" المتطابقة تماماً مع التصميم والمتحركة
 */
export function showNoInternetModal({ onRetry = null, title = 'لا يوجد اتصال بالإنترنت', message = 'يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.' } = {}) {
  if (onRetry && typeof onRetry === 'function') {
    pendingRetryCallbacks.push(onRetry);
  }

  // إذا كانت النافذة معروضة بالفعل، لا نكررها بل نكتفي بإضافة الكولباك
  if (activeNoInternetModal && document.body.contains(activeNoInternetModal)) {
    return activeNoInternetModal;
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'no-internet-backdrop';
  backdrop.id = 'no-internet-modal-root';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-labelledby', 'no-internet-title-h3');

  backdrop.innerHTML = `
    <div class="no-internet-modal" id="no-internet-card">
      <div class="no-internet-icon-wrap" aria-hidden="true">
        <svg class="no-internet-wifi-svg" width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
          <!-- الخط المشطوب المتحرك -->
          <line x1="2" y1="2" x2="22" y2="22" class="wifi-slash" stroke="#71717a" stroke-width="2.2" />
          <!-- موجات الواي فاي المتتالية والمتحركة -->
          <path d="M8.5 16.5a5 5 0 0 1 7 0" class="wifi-arc wifi-arc-1" stroke="#71717a" stroke-width="2.2" />
          <path d="M5 12.5a10 10 0 0 1 14 0" class="wifi-arc wifi-arc-2" stroke="#71717a" stroke-width="2.2" />
          <path d="M1.5 8.5a15 15 0 0 1 21 0" class="wifi-arc wifi-arc-3" stroke="#71717a" stroke-width="2.2" />
          <!-- نقطة البث في المركز -->
          <circle cx="12" cy="20" r="1.3" fill="#71717a" class="wifi-center-dot" />
        </svg>
      </div>

      <h3 class="no-internet-title" id="no-internet-title-h3">${title}</h3>
      <p class="no-internet-desc">${message}</p>

      <button type="button" class="no-internet-retry-btn" id="btn-no-internet-retry">
        <span class="btn-text">إعادة المحاولة</span>
        <span class="btn-spinner" style="display:none">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin-icon"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          جارٍ التحقق...
        </span>
      </button>

      <div class="no-internet-offline-hint" id="no-internet-offline-hint" style="display:none">
        ما زلت غير متصل بالإنترنت. يرجى تفعيل Wi-Fi أو بيانات الهاتف.
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  activeNoInternetModal = backdrop;

  const retryBtn = backdrop.querySelector('#btn-no-internet-retry');
  const card = backdrop.querySelector('#no-internet-card');
  const hint = backdrop.querySelector('#no-internet-offline-hint');
  const btnText = retryBtn.querySelector('.btn-text');
  const btnSpinner = retryBtn.querySelector('.btn-spinner');

  const close = () => {
    backdrop.classList.add('fade-out');
    setTimeout(() => {
      backdrop.remove();
      if (activeNoInternetModal === backdrop) {
        activeNoInternetModal = null;
      }
    }, 220);
  };

  const executeRetries = () => {
    const callbacks = [...pendingRetryCallbacks];
    pendingRetryCallbacks = [];
    callbacks.forEach(cb => {
      try { cb(); } catch (err) { console.warn('Retry callback error:', err); }
    });
  };

  retryBtn.addEventListener('click', async () => {
    retryBtn.disabled = true;
    btnText.style.display = 'none';
    btnSpinner.style.display = 'inline-flex';
    if (hint) hint.style.display = 'none';

    // فحص الاتصال
    const online = await pingConnection(2000);

    btnText.style.display = 'inline';
    btnSpinner.style.display = 'none';
    retryBtn.disabled = false;

    if (online) {
      close();
      toastOk('تم استعادة الاتصال بالإنترنت بنجاح');
      executeRetries();
    } else {
      // هزة تفاعلية لطيفة للدلالة على استمرار انقطاع الشبكة
      card.classList.remove('shake');
      void card.offsetWidth; // إعادة التشغيل
      card.classList.add('shake');
      if (hint) hint.style.display = 'block';
    }
  });

  // دعم إغلاق النافذة بزر الهروب Escape
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', onKeyDown);
      close();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  return backdrop;
}

/**
 * تهيئة الاستماع الشامل لانقطاع وعودة الاتصال والاعتراض الذكي لعمليات البحث
 */
export function initConnectivityListener() {
  // عند عودة الإنترنت تلقائياً
  window.addEventListener('online', () => {
    if (activeNoInternetModal) {
      activeNoInternetModal.remove();
      activeNoInternetModal = null;
      toastOk('تمت استعادة الاتصال بالإنترنت');
      const callbacks = [...pendingRetryCallbacks];
      pendingRetryCallbacks = [];
      callbacks.forEach(cb => { try { cb(); } catch (_) {} });
    }
  });

  // اعتراض عمليات البحث عند إدخال رقم أو نص بدون إنترنت
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const target = e.target;
      if (target && isSearchOrNumberInput(target)) {
        if (!isOnline()) {
          e.preventDefault();
          e.stopPropagation();
          showNoInternetModal({
            onRetry: () => {
              target.dispatchEvent(new Event('input', { bubbles: true }));
              target.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
        }
      }
    }
  }, true);

  // اعتراض أزرار البحث في النماذج أو الفلاتر
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button, .btn');
    if (!btn) return;
    const isSearchBtn = btn.id === 'btn-search' ||
      btn.dataset.act === 'search' ||
      btn.classList.contains('btn-search') ||
      btn.textContent.includes('بحث') ||
      btn.querySelector('svg.ico-search, svg[data-icon="search"]');

    if (isSearchBtn && !isOnline()) {
      e.preventDefault();
      e.stopPropagation();
      showNoInternetModal({
        onRetry: () => btn.click()
      });
    }
  }, true);
}

/**
 * تحديد ما إذا كان حقل الإدخال خاصاً ببحث أو إدخال رقمي
 */
function isSearchOrNumberInput(el) {
  if (!el || el.tagName !== 'INPUT') return false;
  const type = (el.type || '').toLowerCase();
  const id = (el.id || '').toLowerCase();
  const name = (el.name || '').toLowerCase();
  const placeholder = (el.placeholder || '').toLowerCase();

  return (
    type === 'search' ||
    id === 'q' ||
    id.includes('search') ||
    name.includes('search') ||
    placeholder.includes('بحث') ||
    placeholder.includes('رقم') ||
    id.includes('tax') ||
    id.includes('cr') ||
    id.includes('number') ||
    id.includes('code')
  );
}
