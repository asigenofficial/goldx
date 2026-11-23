// ==========================================================================
//  سندات القبض: قائمة، سند مجمّع بتوزيع على عدة فواتير، عرض وطباعة وإلغاء.
// ==========================================================================
import { api, qs } from '../core/api.js';
import { store, loadClients, loadTemplates, can, currencyLabel, getFilterState, setFilterState, clearFilterState } from '../core/store.js';

const syncNotify = (entity, action, payload) => (typeof store.syncNotify === 'function' ? store.syncNotify(entity, action, payload) : null);
const onSync = (cb) => (typeof store.onSync === 'function' ? store.onSync(cb) : () => { });
import {
  html, raw, esc, money, num, dateAr, dateTimeAr, today, monthStart, toastOk, toastErr,
  $, $$, delegate, debounce, modal, formValues, confirmDialog, exportCsv, exportExcel, printDoc, toNum,
  icon, downloadPdfFromHtml, downloadPdfFromUrl, amount, sarSvg, shareDocument, renderStoredVoucher, clientPdfFilename,
  loadStoredTemplate, fillStoredTemplate,
} from '../core/util.js';
import * as _coreUtil from '../core/util.js';
const fillDynamicTemplateHtml = _coreUtil.fillDynamicTemplateHtml || ((html) => html);

const PAGE = 50;

const ARABIC_WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function weekdayAr(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  return ARABIC_WEEKDAYS[d.getUTCDay()] || '';
}

function isFridayIso(isoDate) {
  if (!isoDate) return false;
  const d = new Date(isoDate + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.getUTCDay() === 5;
}

function calcVoucherDate(baseIso, offsetDays = 0, skipFriday = true) {
  const off = Math.max(0, parseInt(offsetDays, 10) || 0);
  const d = new Date(baseIso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return { date: baseIso || '', weekday: '', skippedFriday: false };
  d.setUTCDate(d.getUTCDate() + off);
  let skippedFriday = false;
  if (skipFriday && d.getUTCDay() === 5) {
    d.setUTCDate(d.getUTCDate() + 1);
    skippedFriday = true;
  }
  const iso = d.toISOString().substring(0, 10);
  return { date: iso, weekday: ARABIC_WEEKDAYS[d.getUTCDay()] || '', skippedFriday };
}

function parseSerialPattern(pattern, fallbackPrefix = 'G-RV', fallbackStart = 1, fallbackPad = 5) {
  const clean = String(pattern || '').trim();
  const defStart = Number(fallbackStart) > 0 ? Math.floor(Number(fallbackStart)) : 1;
  const defPad = Number(fallbackPad) > 0 ? Math.floor(Number(fallbackPad)) : 5;
  if (!clean) {
    const p = String(fallbackPrefix || 'G-RV').trim().replace(/-+$/, '');
    return { prefix: p || 'G-RV', startNo: defStart, pad: defPad };
  }
  let i = clean.length - 1;
  while (i >= 0 && clean[i] >= '0' && clean[i] <= '9') i--;
  const digits = clean.slice(i + 1);
  const prefix = clean.slice(0, i + 1).trim().replace(/-+$/, '');
  if (!digits) {
    return { prefix, startNo: defStart, pad: defPad };
  }
  const numVal = parseInt(digits, 10);
  return { prefix, startNo: Number.isFinite(numVal) ? numVal : defStart, pad: digits.length };
}

function formatSerialPattern(prefix, numVal, pad) {
  const numStr = String(numVal).padStart(Math.max(1, pad || 1), '0');
  const p = String(prefix || '').trim().replace(/-+$/, '');
  return p ? `${p}-${numStr}` : numStr;
}

/** نافذة سند القبض المجمّع أو المنفصل (سند لكل فاتورة) مع تأخير التاريخ وفجوة التسلسل. */
export function voucherWizard({ clientId = '', issuerId = '', mode = 'single', onDone }) {
  const cur = currencyLabel();
  let batchMode = false;   // false = سند واحد مجمع, true = سند منفصل لكل فاتورة
  let installMode = false; // true = سندات دفعية (أقساط) على تواريخ مستقبلية

  const m = modal({
    title: mode === 'install' ? 'إنشاء سندات قبض دفعية (أقساط)' : (mode === 'batch' ? 'إنشاء سند منفصل لكل فاتورة' : 'سند قبض جديد'),
    wide: true,
    body: html`
      <div id="w-mode-bar">
        <button type="button" id="btn-mode-single" class="btn btn-sm" title="سند قبض واحد عادي بمبلغ محدد">
          سند عادي موحد
        </button>
        <button type="button" id="btn-mode-install" class="btn btn-sm" title="توليد سندات دفعية مجدولة على أقساط وتواريخ مستقبلية">
          السندات الدفعية (أقساط)
        </button>
        <button type="button" id="btn-mode-batch" class="btn btn-sm" title="إنشاء سند منفصل لكل فاتورة مفتوحة">
          سند منفصل لكل فاتورة
        </button>
      </div>

      <div class="form-grid-3">
        <div class="field"><label class="req" for="w-issuer">الشركة المصدرة</label>
          <select name="issuer_id" id="w-issuer">
            ${raw(store.issuers.filter((i) => i.is_active).map((i) => `<option value="${esc(i.id)}" ${i.id === issuerId ? 'selected' : ''}>${esc(i.name_ar)}</option>`).join(''))}
          </select></div>
        <div class="field"><label class="req" for="w-client">العميل</label>
          <select name="client_id" id="w-client">
            <option value="">— اختر العميل —</option>
            ${raw(store.clients.map((c) => `<option value="${esc(c.id)}" ${c.id === clientId ? 'selected' : ''}>${esc(c.name)} (${esc(c.client_code)})</option>`).join(''))}
          </select></div>
        <div class="field" id="w-date-wrap"><label for="w-date">التاريخ</label>
          <input type="date" name="voucher_date" id="w-date" value="${today()}" /></div>
      </div>

      <div id="w-batch-opts" class="form-grid-3 mt" style="display:none;background:var(--card);padding:10px 14px;border-radius:8px;border:1px solid var(--line);align-items:center">
        <div class="field" style="margin:0">
          <label for="w-date-offset" style="font-size:12px;margin-bottom:2px">تأخير التاريخ (أيام)</label>
          <input type="number" id="w-date-offset" value="2" min="0" max="365" />
        </div>
        <div class="field" style="margin:0">
          <label for="w-seq-gap" style="font-size:12px;margin-bottom:2px">فجوة التسلسل</label>
          <input type="number" id="w-seq-gap" value="2" min="0" max="50" />
        </div>
        <label class="check" style="margin:14px 0 0;font-size:12.5px;font-weight:700">
          <input type="checkbox" id="w-skip-friday" checked />
          تخطي يوم الجمعة أبداً
        </label>
      </div>

      <div id="w-single-opts" class="form-grid-4 mt">
        <div class="field"><label class="req" for="w-amount">المبلغ المستلم (${esc(cur)})</label>
          <input type="number" name="total_amount" id="w-amount" value="" step="0.01" min="0.01" /></div>
        <div class="field"><label for="w-pay-type">طريقة السداد</label>
          <select name="payment_type" id="w-pay-type">
            <option value="CASH">نقداً</option><option value="TRANSFER">تحويل بنكي</option>
            <option value="CARD">شبكة / بطاقة</option><option value="CHEQUE">شيك</option>
          </select></div>
        <div class="field"><label>رقم المرجع / الشيك</label><input type="text" name="reference_no" class="ltr" /></div>
        <div class="field"><label>ملاحظات</label><input type="text" name="notes" /></div>
      </div>
      <div id="w-batch-pay" class="form-grid-2 mt" style="display:none">
        <div class="field"><label for="w-batch-pay-type">طريقة السداد (لجميع السندات)</label>
          <select id="w-batch-pay-type">
            <option value="CASH">نقداً</option><option value="TRANSFER">تحويل بنكي</option>
            <option value="CARD">شبكة / بطاقة</option><option value="CHEQUE">شيك</option>
          </select></div>
        <div class="field"><label for="w-batch-ref">رقم المرجع / الشيك</label><input type="text" id="w-batch-ref" class="ltr" /></div>
      </div>

      <!-- ── وضع السندات الدفعية ──────────────────────────────────────────── -->
      <div id="w-install-opts" class="mt" style="display:none">
        <div class="alert alert-info tiny" style="margin-bottom:10px">
          <b>وضع السندات الدفعية</b> — حدد العميل ثم الإجمالي وعدد الدفعات والتواتر.
          يمكنك اختيار فواتير محددة للتوزيع التلقائي (FIFO)، أو تركها بدون تخصيص.
        </div>
        <div class="form-grid-4">
          <div class="field"><label class="req" for="w-inst-count">عدد الدفعات</label>
            <input type="number" id="w-inst-count" value="3" min="2" max="24" /></div>
          <div class="field"><label class="req" for="w-inst-start">تاريخ أول دفعة</label>
            <input type="date" id="w-inst-start" /></div>
          <div class="field"><label for="w-inst-freq">التواتر</label>
            <select id="w-inst-freq">
              <option value="7">أسبوعياً</option>
              <option value="14">نصف شهرياً</option>
              <option value="30" selected>شهرياً</option>
              <option value="60">كل شهرين</option>
              <option value="90">ربع سنوي</option>
            </select></div>
          <div class="field"><label class="req" for="w-inst-total">الإجمالي (${esc(cur)})</label>
            <input type="number" id="w-inst-total" step="0.01" min="0.01" /></div>
        </div>
        <div class="form-grid-2 mt">
          <div class="field"><label for="w-inst-pay">طريقة الدفع (لكل الدفعات)</label>
            <select id="w-inst-pay">
              <option value="CASH">نقداً</option><option value="TRANSFER">تحويل بنكي</option>
              <option value="CARD">شبكة / بطاقة</option><option value="CHEQUE">شيك</option>
            </select></div>
          <div class="field"><label for="w-inst-ref">رقم المرجع / الشيك</label>
            <input type="text" id="w-inst-ref" class="ltr" /></div>
        </div>
        <label class="check mt tiny" style="font-weight:700">
          <input type="checkbox" id="w-inst-skip-friday" checked />
          تخطي يوم الجمعة تلقائياً (ترحيل للسبت)
        </label>
        <div id="w-inst-preview"></div>
      </div>

      <div class="alert alert-info mt tiny" id="w-hint">
        اختر العميل لعرض فواتيره غير المسددة. يمكنك التوزيع تلقائياً من الأقدم للأحدث، أو إدخال مبلغ لكل فاتورة يدوياً،
        أو تركها بدون توزيع ليبقى المبلغ رصيداً دائناً للعميل.
      </div>
      <div id="w-open"></div>
      <div id="w-batch-progress" style="display:none"></div>`,
    footer: `<button class="btn" data-close type="button">إلغاء</button>
             <button class="btn" data-fifo type="button">توزيع تلقائي (الأقدم أولاً)</button>
             <button class="btn btn-primary" data-ok type="button">حفظ السند</button>`,
  });

  let open = [];
  const alloc = new Map();

  // ── أدوات مساعدة ─────────────────────────────────────────────────────────
  const setActiveBtn = (btnEl, active) => {
    if (!btnEl) return;
    btnEl.classList.toggle('active', !!active);
  };

  // ── تحديث معاينة الدفعات ────────────────────────────────────────────────
  const updateInstallPreview = () => {
    const count = parseInt($('#w-inst-count', m.body)?.value, 10) || 0;
    const start = $('#w-inst-start', m.body)?.value;
    const freq = parseInt($('#w-inst-freq', m.body)?.value, 10) || 30;
    const total = toNum($('#w-inst-total', m.body)?.value, 0);
    const skipFriday = $('#w-inst-skip-friday', m.body)?.checked ?? true;
    const preview = $('#w-inst-preview', m.body);
    if (!preview) return;
    if (!start || !total || count < 2) { preview.innerHTML = ''; return; }

    const base = Math.floor((total / count) * 100) / 100;
    const last = Math.round((total - base * (count - 1)) * 100) / 100;
    const rows = [];
    for (let i = 0; i < count; i++) {
      const dt = calcVoucherDate(start, freq * i, skipFriday);
      rows.push({ n: i + 1, date: dt.date, weekday: dt.weekday, skippedFriday: dt.skippedFriday, amt: i === count - 1 ? last : base });
    }
    const totalCalc = rows.reduce((a, r) => a + r.amt, 0);
    preview.innerHTML = `
      <div style="margin-top:12px;border:1px solid var(--line);border-radius:8px;overflow:hidden">
        <div style="background:var(--brand-light);padding:8px 14px;font-size:12px;font-weight:700;color:var(--brand);display:flex;justify-content:space-between">
          <span>📅 جدول الدفعات — ${count} دفعة</span>
          <span>الإجمالي: ${money(totalCalc)} ${cur}</span>
        </div>
        <table class="tbl compact" style="margin:0">
          <thead><tr><th style="width:36px">#</th><th>تاريخ الدفعة</th><th class="text-end">المبلغ</th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td class="muted">${r.n}</td>
            <td><span class="mono ltr">${r.date}</span> <span class="tiny muted">(${esc(r.weekday)})</span>${r.skippedFriday ? ' <span class="badge amber" style="font-size:10.5px">تعدّى الجمعة</span>' : ''}</td>
            <td class="text-end num">${money(r.amt)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  };

  // ── تبديل الوضع (موحد / دفعي / منفصل) ──────────────────────────────────
  const updateModeTabs = (curMode) => {
    setActiveBtn($('#btn-mode-single', m.body), curMode === 'single');
    setActiveBtn($('#btn-mode-install', m.body), curMode === 'install');
    setActiveBtn($('#btn-mode-batch', m.body), curMode === 'batch');
  };

  const resetAllModes = () => {
    batchMode = false; installMode = false;
    updateModeTabs('single');
    $('#w-batch-opts', m.body).style.display = 'none';
    $('#w-batch-pay', m.body).style.display = 'none';
    $('#w-install-opts', m.body).style.display = 'none';
    $('#w-single-opts', m.body).style.display = 'grid';
    $('#w-date-wrap', m.body).style.opacity = ''; $('#w-date-wrap', m.body).title = '';
    $('#w-hint', m.body).style.display = '';
    m.el.querySelector('[data-fifo]').style.display = '';
    m.el.querySelector('[data-ok]').textContent = 'حفظ السند';
  };

  const toggleBatch = () => {
    resetAllModes();
    batchMode = true;
    updateModeTabs('batch');
    $('#w-batch-opts', m.body).style.display = 'grid';
    $('#w-batch-pay', m.body).style.display = 'grid';
    $('#w-single-opts', m.body).style.display = 'none';
    $('#w-date-wrap', m.body).style.opacity = '0.4';
    $('#w-date-wrap', m.body).title = 'التاريخ يُحسب تلقائياً من تاريخ كل فاتورة + التأخير مع تخطي يوم الجمعة';
    $('#w-hint', m.body).style.display = 'none';
    m.el.querySelector('[data-fifo]').style.display = 'none';
    m.el.querySelector('[data-ok]').textContent = 'إنشاء سند لكل فاتورة';
    if (open.length) renderOpen();
  };

  let installBound = false;
  const toggleInstall = () => {
    resetAllModes();
    installMode = true;
    updateModeTabs('install');
    $('#w-install-opts', m.body).style.display = 'block';
    $('#w-single-opts', m.body).style.display = 'none';
    $('#w-date-wrap', m.body).style.opacity = '0.4';
    $('#w-date-wrap', m.body).title = 'التاريخ يُحدَّد لكل دفعة على حدة';
    $('#w-hint', m.body).style.display = 'none';
    m.el.querySelector('[data-fifo]').style.display = 'none';
    m.el.querySelector('[data-ok]').textContent = 'إنشاء الدفعات';
    // اضبط تاريخ أول دفعة الشهر القادم تلقائياً
    if (!$('#w-inst-start', m.body).value) {
      const nx = new Date(); nx.setUTCMonth(nx.getUTCMonth() + 1); nx.setUTCDate(1);
      $('#w-inst-start', m.body).value = nx.toISOString().substring(0, 10);
    }
    if (!installBound) {
      installBound = true;
      ['#w-inst-count', '#w-inst-start', '#w-inst-freq', '#w-inst-total'].forEach((sel) => {
        $('#' + sel.slice(1), m.body)?.addEventListener('input', updateInstallPreview);
      });
      $('#w-inst-skip-friday', m.body)?.addEventListener('change', updateInstallPreview);
    }
    updateInstallPreview();
    if (open.length) renderOpen();
  };

  $('#btn-mode-single', m.body)?.addEventListener('click', resetAllModes);
  $('#btn-mode-install', m.body)?.addEventListener('click', toggleInstall);
  $('#btn-mode-batch', m.body)?.addEventListener('click', toggleBatch);

  if (mode === 'install') toggleInstall();
  else if (mode === 'batch') toggleBatch();
  else resetAllModes();

  // ── رسم جدول الفواتير المفتوحة ───────────────────────────────────────────
  const renderOpen = () => {
    const box = $('#w-open', m.body);
    if (!open.length) {
      box.innerHTML = '<div class="alert alert-warn tiny">لا توجد فواتير غير مسددة لهذا العميل بهذه الشركة — سيُسجَّل المبلغ كرصيد دائن.</div>';
      return;
    }
    const offset = parseInt($('#w-date-offset', m.body)?.value || '2', 10);
    const skipFriday = $('#w-skip-friday', m.body)?.checked ?? true;
    const totalOpen = open.reduce((a, i) => a + i.remaining_amount, 0);
    const totalAlloc = Array.from(alloc.values()).reduce((a, b) => a + b, 0);
    const enteredAmount = toNum($('#w-amount', m.body)?.value, 0);

    const batchDateCol = batchMode ? `<th>تاريخ السند</th>` : '';
    const batchDateCell = (inv) => {
      if (!batchMode) return '';
      const dt = calcVoucherDate(inv.issue_date, offset, skipFriday);
      return `<td class="tiny nowrap"><span class="mono ltr">${dt.date}</span> <span class="muted">(${esc(dt.weekday)})</span>${dt.skippedFriday ? ' <span class="badge amber" style="font-size:10px">تعدّى الجمعة</span>' : ''}</td>`;
    };

    box.innerHTML = `
      <div class="table-wrap" style="max-height:300px;overflow-y:auto">
        <table class="tbl compact">
          <thead><tr><th style="width:30px"></th><th>الفاتورة</th><th>تاريخ الفاتورة</th>
            ${batchDateCol}
            <th class="text-end">الإجمالي <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
            <th class="text-end">المتبقي <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>
            ${batchMode ? '' : `<th style="width:130px">المبلغ الموزّع <span class="cur-sym">${sarSvg({ size: 11 })}</span></th>`}</tr></thead>
          <tbody>
            ${open.map((i) => `<tr>
              <td><input type="checkbox" data-pick="${esc(i.id)}" ${alloc.has(i.id) ? 'checked' : ''} /></td>
              <td class="mono">${esc(i.invoice_number)}</td>
              <td class="tiny">${esc(dateAr(i.issue_date))}</td>
              ${batchDateCell(i)}
              <td class="text-end num tiny">${amount(i.grand_total)}</td>
              <td class="text-end num">${amount(i.remaining_amount)}</td>
              ${batchMode ? '' : `<td><input type="number" data-amt="${esc(i.id)}" value="${alloc.get(i.id) || ''}" step="0.01" min="0" max="${i.remaining_amount}" /></td>`}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="row mt tiny">
        <div>إجمالي المتبقي على الفواتير: <b class="num">${amount(totalOpen)}</b></div>
        <div class="spacer"></div>
        ${batchMode
        ? `<div>المحدد: <b class="num">${amount(totalAlloc)}</b> — <span class="muted">${alloc.size} فاتورة</span></div>`
        : `<div>الموزّع: <b class="num">${amount(totalAlloc)}</b>${enteredAmount ? ` / غير موزّع: <b class="num" style="color:${Math.abs(enteredAmount - totalAlloc) < 0.005 ? 'var(--success)' : 'var(--warn)'}">${amount(Math.round((enteredAmount - totalAlloc) * 100) / 100)}</b>` : ''}</div>`}
      </div>`;

    $$('[data-pick]', box).forEach((cb) => cb.addEventListener('change', () => {
      const id = cb.dataset.pick;
      const inv = open.find((x) => x.id === id);
      if (cb.checked) {
        if (batchMode) {
          alloc.set(id, inv.remaining_amount);
        } else {
          const amt = toNum($('#w-amount', m.body).value, 0);
          const used = Array.from(alloc.values()).reduce((a, b) => a + b, 0);
          const avail = amt ? Math.max(0, Math.round((amt - used) * 100) / 100) : inv.remaining_amount;
          alloc.set(id, Math.min(inv.remaining_amount, avail || inv.remaining_amount));
        }
      } else alloc.delete(id);
      renderOpen();
    }));
    $$('[data-amt]', box).forEach((inp) => inp.addEventListener('change', () => {
      const id = inp.dataset.amt;
      const v = toNum(inp.value, 0);
      if (v > 0) alloc.set(id, v); else alloc.delete(id);
      renderOpen();
    }));
    if (!batchMode && alloc.size === 1) {
      const invId = Array.from(alloc.keys())[0];
      const singleInv = open.find((x) => x.id === invId);
      const notesInp = $('input[name="notes"]', m.body);
      if (singleInv && notesInp && (!notesInp.value || notesInp.value.startsWith('وذلك مقابل سداد فاتورة رقم '))) {
        notesInp.value = `وذلك مقابل سداد فاتورة رقم ${singleInv.invoice_number}`;
      }
    }
  };

  // ── تحديث جدول عند تغيير التأخير أو خيار يوم الجمعة ──────────────────────
  $('#w-date-offset', m.body).addEventListener('input', () => { if (open.length) renderOpen(); });
  $('#w-skip-friday', m.body)?.addEventListener('change', () => { if (open.length) renderOpen(); });

  const loadOpen = async () => {
    const clientSel = $('#w-client', m.body).value;
    alloc.clear();
    if (!clientSel) { open = []; $('#w-open', m.body).innerHTML = ''; return; }
    open = await api.get(qs('/api/invoices/open', { client_id: clientSel, issuer_id: $('#w-issuer', m.body).value }));
    if (batchMode) alloc.clear(); // reset selections on reload
    renderOpen();
  };

  $('#w-client', m.body).addEventListener('change', loadOpen);
  $('#w-issuer', m.body).addEventListener('change', loadOpen);
  $('#w-amount', m.body).addEventListener('input', () => { if (open.length) renderOpen(); });

  // ── توزيع تلقائي (الأقدم أولاً) — وضع السند الموحد فقط ──────────────────
  m.el.querySelector('[data-fifo]').addEventListener('click', () => {
    let remaining = toNum($('#w-amount', m.body).value, 0);
    if (!remaining) return toastErr('أدخل المبلغ المستلم أولاً');
    alloc.clear();
    for (const inv of open) {
      if (remaining <= 0) break;
      const take = Math.min(inv.remaining_amount, Math.round(remaining * 100) / 100);
      if (take > 0) { alloc.set(inv.id, take); remaining = Math.round((remaining - take) * 100) / 100; }
    }
    renderOpen();
    return undefined;
  });

  // ── حفظ — وضع السند الموحد ────────────────────────────────────────────────
  m.el.querySelector('[data-ok]').addEventListener('click', async (e) => {
    if (installMode) { await runInstallmentVouchers(e); return; }
    if (batchMode) { await runBatchVouchers(e); return; }

    const values = formValues(m.body);
    if (!values.client_id) return toastErr('اختر العميل');
    if (!values.total_amount || values.total_amount <= 0) return toastErr('أدخل مبلغاً صحيحاً');
    const allocations = Array.from(alloc.entries()).map(([invoice_id, amount]) => ({ invoice_id, amount }));
    const sum = allocations.reduce((a, b) => a + b.amount, 0);
    if (sum > values.total_amount + 0.004) return toastErr('مجموع التوزيع أكبر من مبلغ السند');

    if (sum < values.total_amount - 0.004) {
      const surplus = Math.round((values.total_amount - sum) * 100) / 100;
      const proceed = await confirmDialog({
        title: 'تنبيه فائض غير موزّع',
        message: `مبلغ السند (${money(values.total_amount)}) أكبر من المجموع الموزع (${money(sum)}). سيتم تسجيل الفائض (${money(surplus)} ${cur}) كرصيد دائن للعميل في كشف الحساب. هل ترغب في المتابعة؟`,
        confirmText: 'نعم، حفظ السند',
      });
      if (!proceed) return undefined;
    }

    e.target.disabled = true;
    try {
      const voucher = await api.post('/api/vouchers', {
        issuer_id: values.issuer_id,
        client_id: values.client_id,
        voucher_date: values.voucher_date,
        total_amount: values.total_amount,
        payment_type: values.payment_type,
        reference_no: values.reference_no,
        notes: values.notes,
        allocations,
      });
      toastOk(`تم تسجيل السند ${voucher.voucher_number}`);
      syncNotify('vouchers', 'create', voucher);
      syncNotify('invoices', 'update');
      m.close();
      if (onDone) onDone(voucher);
      showVoucher(voucher.id, onDone);
    } catch { e.target.disabled = false; }
    return undefined;
  });

  // ── إنشاء سندات منفصلة (Batch Mode) ─────────────────────────────────────
  const runBatchVouchers = async (e) => {
    const clientSel = $('#w-client', m.body).value;
    const issuerSel = $('#w-issuer', m.body).value;
    if (!clientSel || !issuerSel) return toastErr('اختر الشركة والعميل');
    if (alloc.size === 0) return toastErr('حدد فاتورة واحدة على الأقل');

    const offset = parseInt($('#w-date-offset', m.body).value || '2', 10);
    const seqGap = parseInt($('#w-seq-gap', m.body).value || '2', 10);
    const skipFriday = $('#w-skip-friday', m.body)?.checked ?? true;
    const payType = $('#w-batch-pay-type', m.body).value || 'TRANSFER';
    const refNo = $('#w-batch-ref', m.body).value || '';

    const selectedInvoices = open.filter((i) => alloc.has(i.id));
    const total = selectedInvoices.reduce((a, i) => a + i.remaining_amount, 0);

    const ok = await confirmDialog({
      title: `إنشاء ${selectedInvoices.length} سند قبض منفصل`,
      message: `سيتم إنشاء ${selectedInvoices.length} سند منفصل بإجمالي ${money(total)} ر.س — تأخير التاريخ: ${offset} أيام${skipFriday ? ' (مع تخطي يوم الجمعة)' : ''} — فجوة التسلسل: ${seqGap}. هل تريد المتابعة؟`,
      okText: 'نعم، ابدأ الإنشاء',
    });
    if (!ok) return;

    e.target.disabled = true;
    m.el.querySelector('[data-fifo]').disabled = true;
    m.el.querySelector('[data-close]').disabled = true;

    const progressBox = $('#w-batch-progress', m.body);
    progressBox.style.display = 'block';

    const created = [];
    const errors = [];

    for (let i = 0; i < selectedInvoices.length; i++) {
      const inv = selectedInvoices[i];

      // حساب تاريخ السند مع تخطي يوم الجمعة إن كان مفعّلاً
      const vDate = calcVoucherDate(inv.issue_date, offset, skipFriday).date;

      // تقدم التسلسل (فجوة) بين السندات
      if (seqGap > 0 && i > 0) {
        try { await api.post(`/api/issuers/${issuerSel}/advance-voucher-seq`, { steps: seqGap }); } catch { /* تجاهل */ }
      }

      // تحديث مؤشر التقدم
      progressBox.innerHTML = `
        <div class="alert alert-info tiny" style="margin-top:10px">
          <b>جاري الإنشاء…</b> ${i + 1} / ${selectedInvoices.length} — فاتورة رقم ${inv.invoice_number}
          <div style="height:6px;background:#e2e8f0;border-radius:3px;margin-top:6px">
            <div style="height:100%;background:var(--brand);border-radius:3px;width:${Math.round(((i + 1) / selectedInvoices.length) * 100)}%;transition:width .3s"></div>
          </div>
        </div>`;

      try {
        const v = await api.post('/api/vouchers', {
          issuer_id: issuerSel,
          client_id: clientSel,
          voucher_date: vDate,
          total_amount: inv.remaining_amount,
          payment_type: payType,
          reference_no: refNo,
          notes: `وذلك مقابل سداد فاتورة رقم ${inv.invoice_number}`,
          allocations: [{ invoice_id: inv.id, amount: inv.remaining_amount }],
        });
        created.push({ num: v.voucher_number, inv: inv.invoice_number, date: vDate, amount: inv.remaining_amount });
      } catch (err) {
        errors.push({ inv: inv.invoice_number, err: err.message || 'خطأ غير معروف' });
      }

      // تأخير بسيط بين الطلبات
      await new Promise((r) => setTimeout(r, 150));
    }

    syncNotify('vouchers', 'create', {});
    syncNotify('invoices', 'update');

    // ── عرض ملخص Batch ──────────────────────────────────────────────────────
    const totalCreated = created.reduce((a, v) => a + v.amount, 0);
    progressBox.innerHTML = `
      <div class="card" style="margin-top:12px;border:2px solid var(--success);padding:14px;border-radius:8px">
        <div style="font-weight:700;color:var(--success);margin-bottom:8px">
          تم إنشاء ${created.length} سند بنجاح${errors.length ? ` — ${errors.length} خطأ` : ''}
        </div>
        <div class="table-wrap" style="max-height:220px;overflow-y:auto">
          <table class="tbl compact" style="font-size:12px">
            <thead><tr><th>رقم السند</th><th>الفاتورة</th><th>تاريخ السند</th><th class="text-end">المبلغ</th></tr></thead>
            <tbody>
              ${created.map((v) => `<tr>
                <td class="mono ltr">${esc(v.num)}</td>
                <td class="mono">${esc(v.inv)}</td>
                <td class="tiny">${esc(v.date)}</td>
                <td class="text-end num">${money(v.amount)}</td>
              </tr>`).join('')}
            </tbody>
            <tfoot><tr>
              <td colspan="3"><b>الإجمالي</b></td>
              <td class="text-end num"><b>${money(totalCreated)}</b></td>
            </tr></tfoot>
          </table>
        </div>
        ${errors.length ? `<div class="alert alert-warn tiny mt">${errors.map((er) => `فاتورة ${er.inv}: ${er.err}`).join('<br>')}</div>` : ''}
      </div>`;

    m.el.querySelector('[data-close]').disabled = false;
    m.el.querySelector('[data-close]').textContent = 'إغلاق';
    e.target.style.display = 'none';
    m.el.querySelector('[data-fifo]').style.display = 'none';

    if (onDone) onDone(null);
  };

  // ── إنشاء سندات دفعية (Installment Mode) ──────────────────────────────────
  const runInstallmentVouchers = async (e) => {
    const clientSel = $('#w-client', m.body).value;
    const issuerSel = $('#w-issuer', m.body).value;
    if (!clientSel || !issuerSel) return toastErr('اختر الشركة والعميل');

    const count = parseInt($('#w-inst-count', m.body).value, 10);
    const start = $('#w-inst-start', m.body).value;
    const freq = parseInt($('#w-inst-freq', m.body).value, 10) || 30;
    const total = toNum($('#w-inst-total', m.body).value, 0);
    const payType = $('#w-inst-pay', m.body).value || 'CASH';
    const refNo = $('#w-inst-ref', m.body).value || '';

    if (!start) return toastErr('حدد تاريخ أول دفعة');
    if (!total || total <= 0) return toastErr('أدخل المبلغ الإجمالي');
    if (count < 2 || count > 24) return toastErr('عدد الدفعات يجب أن يكون بين 2 و 24');

    const skipFriday = $('#w-inst-skip-friday', m.body)?.checked ?? true;
    const base = Math.floor((total / count) * 100) / 100;
    const last = Math.round((total - base * (count - 1)) * 100) / 100;
    const installments = Array.from({ length: count }, (_, i) => {
      const dt = calcVoucherDate(start, freq * i, skipFriday);
      return { date: dt.date, amount: i === count - 1 ? last : base };
    });

    const ok = await confirmDialog({
      title: `إنشاء ${count} سند قبض دفعي`,
      message: `الإجمالي: ${money(total)} ${cur} — أول دفعة: ${installments[0].date} — آخر دفعة: ${installments[count - 1].date}${skipFriday ? ' (مع تخطي يوم الجمعة)' : ''}. هل تريد المتابعة؟`,
      okText: 'نعم، إنشاء الدفعات',
    });
    if (!ok) return;

    e.target.disabled = true;
    m.el.querySelector('[data-fifo]').disabled = true;
    m.el.querySelector('[data-close]').disabled = true;

    const progressBox = $('#w-batch-progress', m.body);
    progressBox.style.display = 'block';

    const created = [];
    const errors = [];

    // FIFO: توزيع الدفعات على الفواتير المختارة من الأقدم للأحدث
    const selInvs = open.filter((i) => alloc.has(i.id)).sort((a, b) => a.issue_date.localeCompare(b.issue_date));
    const remaining = selInvs.map((i) => ({ id: i.id, rem: i.remaining_amount }));

    for (let i = 0; i < installments.length; i++) {
      const inst = installments[i];
      progressBox.innerHTML = `
        <div class="alert alert-info tiny" style="margin-top:10px">
          <b>جاري الإنشاء…</b> دفعة ${i + 1} / ${count} — تاريخ: ${inst.date}
          <div style="height:6px;background:#e2e8f0;border-radius:3px;margin-top:6px">
            <div style="height:100%;background:var(--brand);border-radius:3px;width:${Math.round(((i + 1) / count) * 100)}%;transition:width .3s"></div>
          </div>
        </div>`;

      // FIFO allocation
      let instRem = inst.amount;
      const allocations = [];
      for (const inv of remaining) {
        if (instRem < 0.005) break;
        const take = Math.min(inv.rem, Math.round(instRem * 100) / 100);
        if (take > 0.005) {
          allocations.push({ invoice_id: inv.id, amount: Math.round(take * 100) / 100 });
          inv.rem = Math.round((inv.rem - take) * 100) / 100;
          instRem = Math.round((instRem - take) * 100) / 100;
        }
      }

      try {
        const v = await api.post('/api/vouchers', {
          issuer_id: issuerSel,
          client_id: clientSel,
          voucher_date: inst.date,
          total_amount: inst.amount,
          payment_type: payType,
          reference_no: refNo,
          notes: `دفعة ${i + 1} من ${count}`,
          allocations,
        });
        created.push({ num: v.voucher_number, date: inst.date, amount: inst.amount });
      } catch (err) {
        errors.push({ date: inst.date, err: err.message || 'خطأ' });
      }
      await new Promise((r) => setTimeout(r, 150));
    }

    syncNotify('vouchers', 'create', {});
    syncNotify('invoices', 'update');

    const totalCreated = created.reduce((a, v) => a + v.amount, 0);
    progressBox.innerHTML = `
      <div class="card" style="margin-top:12px;border:2px solid var(--success);padding:14px;border-radius:8px">
        <div style="font-weight:700;color:var(--success);margin-bottom:8px">
          تم إنشاء ${created.length} سند دفعي بنجاح${errors.length ? ` — ${errors.length} خطأ` : ''}
        </div>
        <div class="table-wrap" style="max-height:220px;overflow-y:auto">
          <table class="tbl compact" style="font-size:12px">
            <thead><tr><th>رقم السند</th><th>تاريخ الدفعة</th><th class="text-end">المبلغ</th></tr></thead>
            <tbody>${created.map((v) => `<tr>
              <td class="mono ltr">${esc(v.num)}</td>
              <td class="tiny ltr">${esc(v.date)}</td>
              <td class="text-end num">${money(v.amount)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
        <div style="text-align:left;font-size:13px;font-weight:700;margin-top:8px;color:var(--brand)">
          الإجمالي: ${money(totalCreated)} ${cur}
        </div>
        ${errors.length ? `<div class="alert alert-warn tiny mt">${errors.map((x) => `${esc(x.date)}: ${esc(x.err)}`).join('<br>')}</div>` : ''}
      </div>`;

    e.target.disabled = false;
    m.el.querySelector('[data-fifo]').disabled = false;
    m.el.querySelector('[data-close]').disabled = false;
    if (onDone) onDone(created[0]);
  };

  if (clientId) loadOpen();
  return m;
}


export async function showVoucher(id, onChange) {
  const voucher = await api.get(`/api/vouchers/${id}`);
  const [issuer, client, templatesRes] = await Promise.all([
    api.get(`/api/issuers/${voucher.issuer_id}`),
    api.get(`/api/clients/${voucher.client_id}`),
    loadTemplates('documents').catch(() => []),
  ]);

  const availableTemplates = Array.isArray(templatesRes) ? templatesRes : (templatesRes?.data || []);

  const issuerPrintCfg = (typeof issuer.print_settings === 'string'
    ? JSON.parse(issuer.print_settings || '{}')
    : (issuer.print_settings || {})) || {};

  let currentStyle = issuerPrintCfg.voucher_template_style || (availableTemplates[0]?.id || 'default');

  async function renderDoc(style) {
    let rawHtml = '';
    const targetTpl = availableTemplates.find((t) => t.id === style) || availableTemplates[0];
    if (targetTpl) {
      try {
        const r = await fetch(`/api/invoices/templates/${encodeURIComponent(targetTpl.id)}/render-html`);
        if (r.ok) rawHtml = await r.text();
      } catch { }
    }

    if (rawHtml) {
      return fillDynamicTemplateHtml(rawHtml, { issuer, client, voucher });
    }

    return renderStoredVoucher(voucher, issuer, client, style);
  }

  let currentHtml = await renderDoc(currentStyle);

  const m = modal({
    title: `سند قبض ${voucher.voucher_number} ${voucher.status === 'CANCELLED' ? '(ملغى)' : ''}`,
    wide: true,
    body: html`
      <div style="background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-weight:700;font-size:13px;color:var(--brand)">قالب السند:</span>
          <select id="v-style-select" aria-label="اختيار قالب السند" aria-label="اختيار قالب السند" style="min-width:280px;font-size:13px;padding:6px 10px;border-radius:6px;border:1px solid var(--line);background:var(--field-bg, var(--card));color:var(--text);font-weight:700">
            ${raw(availableTemplates.length
      ? availableTemplates.map((t) => `<option value="${esc(t.id)}" ${t.id === currentStyle ? 'selected' : ''}>${esc(t.name_ar || t.name)} (${esc(t.badge || 'سند HTML')})</option>`).join('')
      : '<option value="default">قالب سند قبض (سند HTML)</option>')}
          </select>
          ${raw((() => {
        const isVoucherDefault = currentStyle && currentStyle === issuerPrintCfg.voucher_template_style;
        return `<button class="btn btn-sm" id="btn-adopt-voucher-tpl" type="button" style="font-size:12px;padding:5px 12px;background:${isVoucherDefault ? 'rgba(16,185,129,0.12)' : 'var(--brand-light)'};border:1px solid ${isVoucherDefault ? 'rgba(16,185,129,0.3)' : 'var(--brand)'};color:${isVoucherDefault ? '#10b981' : 'var(--brand)'};font-weight:700;border-radius:6px;white-space:nowrap" title="${isVoucherDefault ? 'هذا القالب معتمد حالياً كافتراضي لجميع سندات هذه المنشأة' : 'اعتماد هذا القالب كقالب افتراضي لجميع سندات المنشأة'}">
              ${isVoucherDefault ? '✓ القالب المعتمد للمنشأة' : 'اعتماد كقالب افتراضي للمنشأة'}
            </button>`;
      })())}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
          <div style="font-size:12px;color:var(--muted)">
            ${voucher.client_name} — <b class="num">${amount(voucher.total_amount, 'SAR', { size: 13 })}</b>
          </div>
          <div class="tpl-zoom-controls" style="margin:0;">
            <button type="button" class="tpl-zoom-btn" id="vp-zoom-out" title="تصغير">−</button>
            <span class="tpl-zoom-val" id="vp-zoom-text">80%</span>
            <button type="button" class="tpl-zoom-btn" id="vp-zoom-in" title="تكبير">+</button>
            <button type="button" class="tpl-zoom-btn" id="vp-zoom-fit" title="ملاءمة الشاشة" style="border-inline-start:1px solid var(--line-strong); font-size:.72rem;">العرض</button>
          </div>
        </div>
      </div>
      <div class="modal-paper-stage" id="vp-stage">
        <div class="modal-paper-scaler" id="vp-scaler" style="transform: scale(0.80);">
          <div class="modal-paper-sheet">
            <iframe id="v-preview-iframe" style="width:100%;height:100%;min-height:850px;border:none;display:block;background:#fff"></iframe>
          </div>
        </div>
      </div>
    `,
    footer: html`
      <div class="flex gap" style="justify-content:space-between;width:100%">
        <div class="flex gap-xs">
          <span class="badge gray" data-pdf-status title="حالة نسخة PDF المحفوظة">PDF قيد التجهيز</span>
          <button class="btn btn-primary" data-print type="button">${icon.printer({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })}طباعة السند</button>
          <button class="btn" data-pdf type="button">${icon.pdf({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })}تحميل PDF</button>
          <button class="btn" data-share type="button" style="background:#10b981;border-color:#10b981;color:#fff">${icon.share({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })}مشاركة</button>
          ${voucher.status !== 'CANCELLED' && can('vouchers.edit') ? raw(`<button class="btn" data-edit type="button" style="background:var(--brand-light);border-color:var(--brand);color:var(--brand)">${icon.pencil ? icon.pencil({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' }) : ''}تعديل</button>`) : ''}
          <button class="btn btn-danger" data-delete type="button">${icon.trash({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })}حذف نهائي</button>
        </div>
        <button class="btn" data-close type="button">إغلاق</button>
      </div>
    `,
  });

  const refreshVoucherPdfStatus = async (attempt = 0) => {
    const badge = m.el.querySelector('[data-pdf-status]');
    if (!badge) return;
    try {
      const pdf = await api.get(`/api/vouchers/${encodeURIComponent(voucher.id)}/pdf-status`, { silent: true });
      badge.textContent = pdf.status === 'READY' ? 'PDF محفوظ' : pdf.status === 'FAILED' ? 'تعذر تجهيز PDF' : 'PDF قيد التجهيز';
      badge.className = `badge ${pdf.status === 'READY' ? 'green' : pdf.status === 'FAILED' ? 'red' : 'gray'}`;
      if (pdf.error) badge.title = pdf.error;
      if (pdf.status === 'PENDING' && attempt < 5) setTimeout(() => refreshVoucherPdfStatus(attempt + 1), 3000);
    } catch { }
  };
  refreshVoucherPdfStatus();

  let vpZoom = 80;
  const updateVpZoom = (z) => {
    vpZoom = Math.max(25, Math.min(130, z));
    const zText = $('#vp-zoom-text', m.body);
    const scaler = $('#vp-scaler', m.body);
    if (zText) zText.textContent = `${vpZoom}%`;
    if (scaler) scaler.style.transform = `scale(${vpZoom / 100})`;
  };
  const fitVpZoom = () => {
    const stage = $('#vp-stage', m.body);
    if (stage && stage.clientWidth > 60) {
      const availableW = stage.clientWidth - 20;
      const targetW = 794;
      const scale = Math.min(1.15, Math.max(0.25, Math.round((availableW / targetW) * 95) / 100));
      updateVpZoom(Math.round(scale * 100));
    }
  };
  $('#vp-zoom-in', m.body)?.addEventListener('click', () => updateVpZoom(vpZoom + 10));
  $('#vp-zoom-out', m.body)?.addEventListener('click', () => updateVpZoom(vpZoom - 10));
  $('#vp-zoom-fit', m.body)?.addEventListener('click', fitVpZoom);
  setTimeout(fitVpZoom, 40);

  const iframe = $('#v-preview-iframe', m.body);
  if (iframe) iframe.srcdoc = currentHtml;

  const updateVoucherAdoptBtn = () => {
    const adoptBtn = $('#btn-adopt-voucher-tpl', m.body);
    if (!adoptBtn) return;
    const isDefault = currentStyle && currentStyle === issuerPrintCfg.voucher_template_style;
    if (isDefault) {
      adoptBtn.innerHTML = '✓ القالب المعتمد للمنشأة';
      adoptBtn.style.background = 'rgba(16,185,129,0.12)';
      adoptBtn.style.borderColor = 'rgba(16,185,129,0.3)';
      adoptBtn.style.color = '#10b981';
      adoptBtn.title = 'هذا القالب معتمد حالياً كافتراضي لجميع سندات هذه المنشأة';
    } else {
      adoptBtn.innerHTML = '★ اعتماد كقالب افتراضي للمنشأة';
      adoptBtn.style.background = 'var(--brand-light)';
      adoptBtn.style.borderColor = 'var(--brand)';
      adoptBtn.style.color = 'var(--brand)';
      adoptBtn.title = 'حفظ واعتماد هذا القالب ليكون القالب الافتراضي الدائم لسندات هذه المنشأة';
    }
  };

  const styleSel = $('#v-style-select', m.body);
  if (styleSel) {
    styleSel.addEventListener('change', async () => {
      currentStyle = styleSel.value;
      updateVoucherAdoptBtn();
      currentHtml = await renderDoc(currentStyle);
      if (iframe) iframe.srcdoc = currentHtml;
    });
  }

  const adoptBtn = $('#btn-adopt-voucher-tpl', m.body);
  if (adoptBtn) {
    adoptBtn.addEventListener('click', async () => {
      adoptBtn.disabled = true;
      try {
        issuerPrintCfg.voucher_template_style = currentStyle;
        await api.put(`/api/issuers/${issuer.id}`, {
          ...issuer,
          print_settings: issuerPrintCfg,
        });
        issuer.print_settings = issuerPrintCfg;
        if (store.issuers) {
          const stored = store.issuers.find((i) => i.id === issuer.id);
          if (stored) stored.print_settings = issuerPrintCfg;
        }
        toastOk('تم اعتماد القالب كافتراضي لجميع سندات المنشأة بنجاح');
        updateVoucherAdoptBtn();
      } catch (err) {
        toastErr('فشل اعتماد القالب: ' + err.message);
      } finally {
        adoptBtn.disabled = false;
      }
    });
  }

  const pdfBtn = m.el.querySelector('[data-pdf]');
  if (pdfBtn) {
    pdfBtn.addEventListener('click', async (e) => {
      const button = e.currentTarget;
      button.disabled = true;
      try {
        const vNum = voucher.voucher_number || 'سند';
        const pdfFileName = clientPdfFilename('سند قبض', voucher.client_name || client?.name, vNum);
        await downloadPdfFromUrl(`/api/vouchers/${encodeURIComponent(voucher.id)}/pdf?style=${encodeURIComponent(currentStyle)}`, pdfFileName);
      } catch (err) {
        toastErr(err.message || 'تعذر تحميل ملف PDF');
      } finally {
        button.disabled = false;
      }
    });
  }

  const shareBtn = m.el.querySelector('[data-share]');
  if (shareBtn) {
    shareBtn.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const clientNameClean = (voucher.client_name || client?.name || '').replace(/[\/\\?%*:|"<>]/g, '_').trim();
        const vNum = voucher.voucher_number || 'سند';
        const pdfFileName = clientNameClean ? `سند_قبض_${vNum}_${clientNameClean}.pdf` : `سند_قبض_${vNum}.pdf`;
        await shareVoucherPdfFile({ voucher, issuer, client, docHtml: currentHtml, pdfFileName });
      } catch (err) {
        toastErr(err.message || 'تعذر مشاركة السند');
      } finally {
        e.target.disabled = false;
      }
    });
  }

  m.el.querySelector('[data-print]').addEventListener('click', () => {
    printDoc(currentHtml);
  });

  const deleteBtn = m.el.querySelector('[data-delete]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: `حذف سند القبض ${voucher.voucher_number} نهائياً`,
        message: 'هل أنت متأكد من حذف هذا السند نهائياً من قاعدة البيانات؟ سيتم مسح السند والقيود المرتبطة به بالكامل.',
        danger: true,
        okText: 'نعم، حذف نهائي',
      });
      if (!ok) return;
      try {
        await api.del(`/api/vouchers/${id}`);
        toastOk(`تم حذف سند القبض ${voucher.voucher_number} نهائياً من قاعدة البيانات`);
        m.close();
        if (onChange) onChange();
      } catch (err) {
        toastErr(err.message || 'فشل حذف السند');
      }
    });
  }

  // ── زر التعديل ────────────────────────────────────────────────────────────
  const editBtn = m.el.querySelector('[data-edit]');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      openEditVoucherModal(voucher, async (updated) => {
        Object.assign(voucher, updated);
        currentHtml = await renderDoc(currentStyle);
        if (iframe) iframe.srcdoc = currentHtml;
        m.el.querySelector('.modal-title, h2, [class*="title"]')?.childNodes[0] &&
          (m.el.querySelector('.modal-title, h2, [class*="title"]').textContent = `سند قبض ${updated.voucher_number}`);
        if (onChange) onChange(updated);
      });
    });
  }
}

export function openEditVoucherModal(voucher, onDone) {
  const paymentOptions = [
    { v: 'CASH', l: 'نقداً' },
    { v: 'TRANSFER', l: 'تحويل بنكي' },
    { v: 'CHEQUE', l: 'شيك' },
    { v: 'CARD', l: 'شبكة' },
  ];

  const em = modal({
    title: `تعديل سند ${voucher.voucher_number}`,
    body: html`
      <div class="form-grid" style="gap:14px">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600">
          رقم السند
          <input id="ev-number" type="text" class="input mono" dir="ltr" value="${esc(voucher.voucher_number || '')}" placeholder="مثال: RV-00020" style="font-size:14px;font-weight:700">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600">
          تاريخ السند
          <input id="ev-date" type="date" class="input" value="${voucher.voucher_date}" style="font-size:14px">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600">
          طريقة الدفع
          <select id="ev-pay" class="input" style="font-size:14px">
            ${raw(paymentOptions.map((o) => `<option value="${o.v}" ${(voucher.payment_type || voucher.payment_method) === o.v ? 'selected' : ''}>${o.l}</option>`).join(''))}
          </select>
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600">
          رقم المرجع / الشيك
          <input id="ev-ref" type="text" class="input" value="${esc(voucher.reference_no || '')}" placeholder="اختياري" style="font-size:14px">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600">
          الملاحظات
          <input id="ev-notes" type="text" class="input" value="${esc(voucher.notes || '')}" placeholder="اختياري" style="font-size:14px">
        </label>
      </div>
    `,
    footer: html`
      <div class="flex gap" style="justify-content:flex-end;width:100%">
        <button class="btn" data-close type="button">إلغاء</button>
        <button class="btn btn-primary" id="ev-save" type="button">حفظ التعديلات</button>
      </div>
    `,
  });

  em.el.querySelector('#ev-save').addEventListener('click', async (e) => {
    const newNumber = em.el.querySelector('#ev-number').value.trim();
    const newDate = em.el.querySelector('#ev-date').value;
    const newPay = em.el.querySelector('#ev-pay').value;
    const newRef = em.el.querySelector('#ev-ref').value.trim();
    const newNotes = em.el.querySelector('#ev-notes').value.trim();

    if (!newNumber) return toastErr('يرجى إدخال رقم السند');
    if (!newDate) return toastErr('حدد تاريخ السند');

    e.target.disabled = true;
    try {
      const updated = await api.patch(`/api/vouchers/${voucher.id}`, {
        voucher_number: newNumber,
        voucher_date: newDate,
        payment_type: newPay,
        reference_no: newRef,
        notes: newNotes,
      });
      toastOk(`تم تعديل سند ${updated.voucher_number} بنجاح`);
      em.close();
      if (onDone) onDone(updated);
    } catch (err) {
      toastErr(err.message || 'فشل حفظ التعديلات');
      e.target.disabled = false;
    }
  });
}

async function getVoucherRenderedData(voucherId) {
  const voucher = typeof voucherId === 'object' ? voucherId : await api.get(`/api/vouchers/${voucherId}`);
  const [issuer, client, templatesRes] = await Promise.all([
    api.get(`/api/issuers/${voucher.issuer_id}`).catch(() => store.issuers.find((i) => i.id === voucher.issuer_id) || store.activeIssuer || {}),
    api.get(`/api/clients/${voucher.client_id}`).catch(() => store.clients.find((c) => c.id === voucher.client_id) || { name: voucher.client_name }),
    loadTemplates('documents').catch(() => []),
  ]);

  const availableTemplates = Array.isArray(templatesRes) ? templatesRes : (templatesRes?.data || []);
  const issuerPrintCfg = (typeof issuer.print_settings === 'string'
    ? JSON.parse(issuer.print_settings || '{}')
    : (issuer.print_settings || {})) || {};
  const currentStyle = issuerPrintCfg.voucher_template_style || (availableTemplates[0]?.id || 'default');

  let rawHtml = '';
  const targetTpl = availableTemplates.find((t) => t.id === currentStyle) || availableTemplates[0];
  if (targetTpl) {
    try {
      const r = await fetch(`/api/invoices/templates/${encodeURIComponent(targetTpl.id)}/render-html`);
      if (r.ok) rawHtml = await r.text();
    } catch { }
  }

  const docHtml = rawHtml
    ? fillDynamicTemplateHtml(rawHtml, { issuer, client, voucher })
    : await renderStoredVoucher(voucher, issuer, client, currentStyle);

  const clientNameClean = (voucher.client_name || client?.name || '').replace(/[\/\\?%*:|"<>]/g, '_').trim();
  const vNum = voucher.voucher_number || 'سند';
  const pdfFileName = clientNameClean ? `سند_قبض_${vNum}_${clientNameClean}.pdf` : `سند_قبض_${vNum}.pdf`;
  return { voucher, issuer, client, docHtml, pdfFileName };
}

export async function downloadVoucherDirectPdf(voucherId) {
  toastOk('جارٍ تجهيز ملف PDF للسند...');
  const { voucher, client } = await getVoucherRenderedData(voucherId);
  const vid = encodeURIComponent(voucher.id);
  // انتظار اكتمال PDF (حتى 20 ثانية) قبل التحميل
  for (let i = 0; i < 10; i++) {
    const status = await api.get(`/api/vouchers/${vid}/pdf-status`).catch(() => null);
    if (!status || status.status === 'READY') break;
    if (status.status === 'FAILED') throw new Error('فشل توليد ملف PDF: ' + (status.error || ''));
    await new Promise((r) => setTimeout(r, 2000));
  }
  await downloadPdfFromUrl(`/api/vouchers/${vid}/pdf`, clientPdfFilename('سند قبض', voucher.client_name || client?.name, voucher.voucher_number || 'سند'));
}

export async function shareVoucherPdfFile({ voucher, issuer, client, docHtml, pdfFileName }) {
  return shareDocument({
    title: `سند قبض ${voucher.voucher_number || ''}`,
    text: `سند قبض رقم ${voucher.voucher_number || ''} بمبلغ ${voucher.total_amount || ''} ر.س من ${issuer?.name_ar || voucher.issuer_name || ''}`,
    url: `${location.origin}${location.pathname}#/vouchers?q=${encodeURIComponent(voucher.voucher_number || '')}`,
  });
}

export async function shareVoucherDirectPdf(voucherId) {
  const data = await getVoucherRenderedData(voucherId);
  await shareVoucherPdfFile(data);
}

export async function render(view, ctx) {
  await loadClients();
  const q0 = (ctx && ctx.query) || {};
  const defaults = {
    issuer_id: store.activeIssuerId,
    client_id: '',
    status: '',
    payment_type: '',
    from: '',
    to: '',
    min_amount: '',
    max_amount: '',
    q: '',
    offset: 0,
  };
  const cached = getFilterState('vouchers', defaults);
  const state = {
    ...cached,
    ...q0,
    offset: q0.offset !== undefined ? Number(q0.offset) : (cached.offset || 0),
    data: { items: [], totals: {}, total_count: 0 },
  };
  if (q0.issuer_id !== undefined) state.issuer_id = q0.issuer_id;

  const saveState = () => {
    setFilterState('vouchers', {
      issuer_id: state.issuer_id,
      client_id: state.client_id,
      status: state.status,
      payment_type: state.payment_type,
      from: state.from,
      to: state.to,
      min_amount: state.min_amount,
      max_amount: state.max_amount,
      q: state.q,
      offset: state.offset,
    });
  };

  const load = async () => {
    saveState();
    const res = await api.get(qs('/api/vouchers', {
      issuer_id: state.issuer_id,
      client_id: state.client_id,
      status: state.status,
      payment_type: state.payment_type,
      from: state.from,
      to: state.to,
      min_amount: state.min_amount,
      max_amount: state.max_amount,
      q: state.q,
      limit: PAGE,
      offset: state.offset,
    }));
    state.data = res || { items: [], totals: {}, total_count: 0 };
    if (!Array.isArray(state.data.items)) state.data.items = [];
    if (!state.data.totals) state.data.totals = {};
  };

  const draw = () => {
    const pageTo = Math.min(state.offset + PAGE, state.data.total_count);
    view.innerHTML = html`
      <div class="page-head">
        <div class="titles">
          <h1>${raw(icon.receipt({ size: 24, style: 'vertical-align:middle;margin-left:8px;color:#d4af37' }))}سندات القبض المالي للذهب</h1>
          <p>سندات قبض مالي وتسديد فواتير ومصوغات الذهب كلياً أو جزئياً بدقة متناهية.</p>
        </div>
        <div class="page-actions">
          <a class="btn" href="#/gold-receipts">سندات قبض الذهب بالجرام</a>
          ${raw(can('vouchers.create') ? `
            <button class="btn btn-primary" id="new-v" type="button">
              ${icon.receipt({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}سند قبض جديد
            </button>
            <button class="btn" id="new-v-install" type="button" style="background:rgba(212,175,55,0.15);color:#8c6d1f;border:1px solid rgba(212,175,55,0.4);font-weight:700" title="إنشاء وتوليد دفعات سندات قبض مجدولة على أقساط وتواريخ مستقبلية">
              ${raw(icon.calendar({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}السندات الدفعية (أقساط)
            </button>
            <button class="btn" id="new-v-batch" type="button" style="border:1.5px solid var(--line-strong);font-weight:700" title="إنشاء سند قبض منفصل لكل فاتورة غير مسددة">
              سندات لكل فاتورة
            </button>
            <button class="btn" id="new-v-suppliers-batch" type="button" style="background:rgba(16,185,129,0.12);color:#065f46;border:1px solid rgba(16,185,129,0.4);font-weight:700" title="إنشاء سندات قبض ريال دفعية لكل عملاء المورد مع تجميع الفواتير وتوحيد التسلسل">
              سندات دفعة (كل العملاء)
            </button>
          ` : '')}
          <button class="btn btn-primary" id="btn-pdf-vouchers" type="button">
            ${raw(icon.pdf({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}
            تحميل قائمة PDF
          </button>
          <button class="btn" id="btn-voucher-templates" type="button">
            ${raw(icon.fileSpreadsheet({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}
            قوالب Excel للسندات ▾
          </button>
          <button class="btn" id="exp-xls" type="button">${raw(icon.fileSpreadsheet({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}تصدير Excel</button>
          <button class="btn" id="exp-csv" type="button">${raw(icon.fileText({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' }))}CSV</button>
        </div>
      </div>

      <div class="card filter-box">
        <div class="filter-row">
          <div class="field flex-2"><label for="q">بحث سريع</label>
            <input type="search" id="q" value="${esc(state.q)}" placeholder="رقم السند، المرجع، اسم العميل، ملاحظات…" /></div>
          <div class="field"><label for="issuer_id">الشركة</label>
            <select id="issuer_id"><option value="">كل الشركات</option>
              ${raw(store.issuers.map((i) => `<option value="${esc(i.id)}" ${i.id === state.issuer_id ? 'selected' : ''}>${esc(i.name_ar)}</option>`).join(''))}
            </select></div>
          <div class="field"><label for="client_id">العميل</label>
            <select id="client_id"><option value="">كل العملاء</option>
              ${raw(store.clients.map((c) => `<option value="${esc(c.id)}" ${c.id === state.client_id ? 'selected' : ''}>${esc(c.name)}</option>`).join(''))}
            </select></div>
          <div class="field field-sm"><label for="status">الحالة</label>
            <select id="status"><option value="">كل الحالات</option>
              <option value="ACTIVE" ${raw(state.status === 'ACTIVE' ? 'selected' : '')}>نشط</option>
              <option value="CANCELLED" ${raw(state.status === 'CANCELLED' ? 'selected' : '')}>ملغى</option>
            </select></div>
          <div class="field field-sm"><label for="payment_type">طريقة السداد</label>
            <select id="payment_type"><option value="">كل الطرق</option>
              <option value="CASH" ${raw(state.payment_type === 'CASH' ? 'selected' : '')}>نقداً</option>
              <option value="TRANSFER" ${raw(state.payment_type === 'TRANSFER' ? 'selected' : '')}>تحويل بنكي</option>
              <option value="CARD" ${raw(state.payment_type === 'CARD' ? 'selected' : '')}>شبكة</option>
              <option value="CHEQUE" ${raw(state.payment_type === 'CHEQUE' ? 'selected' : '')}>شيك</option>
            </select></div>
        </div>
        <div class="filter-row" style="margin-top:.75rem">
          <div class="field field-date"><label for="from">من تاريخ</label><input type="date" id="from" value="${state.from}" /></div>
          <div class="field field-date"><label for="to">إلى تاريخ</label><input type="date" id="to" value="${state.to}" /></div>
          <div class="field field-num"><label for="min_amount">أقل مبلغ</label><input type="number" id="min_amount" value="${state.min_amount}" placeholder="0.00" step="0.01" min="0" /></div>
          <div class="field field-num"><label for="max_amount">أعلى مبلغ</label><input type="number" id="max_amount" value="${state.max_amount}" placeholder="0.00" step="0.01" min="0" /></div>
          <div class="filter-actions-col">
            <div class="filter-btn-group">
              <button class="btn btn-sm" data-quick="today" type="button" title="سندات اليوم">${raw(icon.calendar({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}اليوم</button>
              <button class="btn btn-sm" data-quick="month" type="button" title="سندات هذا الشهر">${raw(icon.calendar({ size: 13, style: 'vertical-align:text-bottom;margin-left:3px' }))}هذا الشهر</button>
              <button class="btn btn-sm" data-quick="clear" type="button" title="إعادة تعيين الفلاتر">إعادة تعيين</button>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${amount(state.data.totals.total_amount, 'SAR', { size: 16 })}</div><div class="stat-lab">إجمالي السندات المطابقة</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${num(state.data.total_count)}</div><div class="stat-lab">عدد السندات</div></div></div>
      </div>

      <div class="card pad0 mt">
        <div class="table-wrap">
          <table class="tbl invoices-tbl vouchers-tbl">
            <thead><tr>
              <th style="white-space:nowrap;min-width:125px">رقم السند</th>
              <th style="white-space:nowrap;min-width:110px">التاريخ</th>
              <th style="min-width:180px">العميل</th>
              <th style="min-width:135px">الشركة</th>
              <th style="white-space:nowrap">طريقة السداد</th>
              <th style="white-space:nowrap">المرجع</th>
              <th class="text-end nowrap" style="white-space:nowrap">المبلغ <span class="cur-sym">${sarSvg({ size: 12 })}</span></th>
              <th class="text-end nowrap" style="white-space:nowrap">الموزّع <span class="cur-sym">${sarSvg({ size: 12 })}</span></th>
              <th class="text-end nowrap" style="white-space:nowrap">غير موزّع <span class="cur-sym">${sarSvg({ size: 12 })}</span></th>
              <th class="text-center nowrap" style="min-width:80px;white-space:nowrap">الحالة</th>
              <th class="text-center nowrap" style="min-width:180px;white-space:nowrap">الإجراءات</th>
            </tr></thead>
            <tbody>
              ${raw(state.data.items.length ? state.data.items.map((v) => `<tr class="${v.status === 'CANCELLED' ? 'row-off' : ''}">
                <td class="nowrap" style="white-space:nowrap"><a class="mono invoice-no-link" href="javascript:void(0)" data-act="show" data-id="${esc(v.id)}" style="font-weight:700;white-space:nowrap" title="عرض تفاصيل السند"><b>${esc(v.voucher_number)}</b></a></td>
                <td class="tiny nowrap" style="white-space:nowrap">${esc(dateAr(v.voucher_date))}</td>
                <td class="cell-client"><div class="client-name" title="${esc(v.client_name)}">${esc(v.client_name)}</div>${v.client_code ? `<div class="tiny muted mono">${esc(v.client_code)}</div>` : ''}</td>
                <td class="cell-issuer"><div class="issuer-name" title="${esc(v.issuer_name)}">${esc(v.issuer_name)}</div></td>
                <td class="tiny nowrap" style="white-space:nowrap">${esc(v.payment_label)}</td>
                <td class="tiny mono nowrap" style="white-space:nowrap">${esc(v.reference_no || '—')}</td>
                <td class="text-end num nowrap" style="white-space:nowrap"><b>${amount(v.total_amount)}</b></td>
                <td class="text-end num nowrap" style="white-space:nowrap">${amount(v.allocated_total)}</td>
                <td class="text-end num nowrap" style="white-space:nowrap">${v.unallocated > 0 ? `<span class="badge amber" style="white-space:nowrap">${amount(v.unallocated)}</span>` : '—'}</td>
                <td class="text-center nowrap" style="white-space:nowrap">
                  ${v.status === 'CANCELLED' ? '<span class="badge red">ملغى</span>' : '<span class="badge green">نشط</span>'}
                </td>
                <td class="actions">
                  <div class="row-actions-group">
                    <button class="btn btn-sm btn-ghost" data-act="show" data-id="${esc(v.id)}" type="button" title="عرض تفاصيل السند" style="padding:.28rem .55rem">
                      ${icon.eye({ size: 14, style: 'vertical-align:middle' })}<span>عرض</span>
                    </button>
                    <button class="btn btn-sm btn-icon btn-primary" data-act="pdf" data-id="${esc(v.id)}" type="button" title="تحميل ملف PDF">
                      ${icon.pdf({ size: 14, style: 'vertical-align:middle' })}
                    </button>
                    <button class="btn btn-sm btn-icon" data-act="share" data-id="${esc(v.id)}" type="button" style="background:rgba(212,175,55,0.18);border-color:rgba(212,175,55,0.4);color:#8c6d1f" title="مشاركة سند القبض">
                      ${icon.share({ size: 13, style: 'vertical-align:middle' })}
                    </button>
                    ${v.status !== 'CANCELLED' && can('vouchers.edit') ? `
                    <button class="btn btn-sm btn-icon" data-act="edit" data-id="${esc(v.id)}" type="button" title="تعديل السند">
                      ${icon.edit({ size: 13, style: 'vertical-align:middle' })}
                    </button>` : ''}
                    ${can('vouchers.delete') ? `<button class="btn btn-sm btn-icon btn-danger" data-act="delete" data-id="${esc(v.id)}" data-num="${esc(v.voucher_number)}" type="button" title="حذف السند">
                      ${icon.trash({ size: 13, style: 'vertical-align:middle' })}
                    </button>` : ''}
                  </div>
                </td>
              </tr>`).join('') : '<tr><td colspan="11" class="text-center muted" style="padding:2rem">لا توجد سندات مطابقة</td></tr>')}
            </tbody>
          </table>
        </div>
        <div class="pager">
          <button class="btn btn-sm" id="prev" ${raw(state.offset === 0 ? 'disabled' : '')} type="button">${raw(icon.arrowRight({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' }))}السابق</button>
          <span class="tiny muted">${state.data.total_count ? state.offset + 1 : 0} — ${pageTo} من ${num(state.data.total_count)}</span>
          <button class="btn btn-sm" id="next" ${raw(pageTo >= state.data.total_count ? 'disabled' : '')} type="button">التالي${raw(icon.arrowLeft({ size: 14, style: 'vertical-align:text-bottom;margin-right:3px' }))}</button>
        </div>
      </div>`;

    const reload = async () => { await load(); draw(); };
    $('#q', view).addEventListener('input', debounce(async (e) => { state.q = e.target.value; state.offset = 0; await reload(); }, 350));
    ['issuer_id', 'client_id', 'status', 'payment_type', 'from', 'to'].forEach((id) => {
      const el = $(`#${id}`, view);
      if (el) el.addEventListener('change', async (e) => { state[id] = e.target.value; state.offset = 0; await reload(); });
    });
    ['min_amount', 'max_amount'].forEach((id) => {
      const el = $(`#${id}`, view);
      if (el) el.addEventListener('change', async (e) => { state[id] = e.target.value; state.offset = 0; await reload(); });
    });

    delegate(view, 'click', '[data-quick]', async (e, btn) => {
      const kind = btn.dataset.quick;
      if (kind === 'month') { state.from = monthStart(); state.to = today(); }
      else if (kind === 'today') { state.from = today(); state.to = today(); }
      else {
        clearFilterState('vouchers');
        Object.assign(state, defaults, { issuer_id: store.activeIssuerId, data: state.data });
      }
      state.offset = 0;
      await reload();
    });

    $('#prev', view).addEventListener('click', async () => { state.offset = Math.max(0, state.offset - PAGE); await reload(); });
    $('#next', view).addEventListener('click', async () => { state.offset += PAGE; await reload(); });

    const newBtn = $('#new-v', view);
    if (newBtn) {
      newBtn.addEventListener('click', () => voucherWizard({
        clientId: state.client_id,
        issuerId: state.issuer_id || store.activeIssuerId,
        mode: 'single',
        onDone: reload,
      }));
    }

    const newInstallBtn = $('#new-v-install', view);
    if (newInstallBtn) {
      newInstallBtn.addEventListener('click', () => voucherWizard({
        clientId: state.client_id,
        issuerId: state.issuer_id || store.activeIssuerId,
        mode: 'install',
        onDone: reload,
      }));
    }

    const newBatchBtn = $('#new-v-batch', view);
    if (newBatchBtn) {
      newBatchBtn.addEventListener('click', () => voucherWizard({
        clientId: state.client_id,
        issuerId: state.issuer_id || store.activeIssuerId,
        mode: 'batch',
        onDone: reload,
      }));
    }

    const newSuppliersBatchBtn = $('#new-v-suppliers-batch', view);
    if (newSuppliersBatchBtn) {
      newSuppliersBatchBtn.addEventListener('click', () => cashReceiptBatchModal({
        issuerId: state.issuer_id || store.activeIssuerId,
        onDone: reload,
      }));
    }

    if (q0.mode === 'install' || q0.action === 'install') {
      setTimeout(() => {
        voucherWizard({
          clientId: state.client_id,
          issuerId: state.issuer_id || store.activeIssuerId,
          mode: 'install',
          onDone: reload,
        });
      }, 50);
    }

    delegate(view, 'click', '[data-act="show"]', async (e, btn) => { await showVoucher(btn.dataset.id, reload); });

    delegate(view, 'click', '[data-act="edit"]', async (e, btn) => {
      const id = btn.dataset.id;
      const v = state.data.items.find((item) => item.id === id);
      if (v) {
        openEditVoucherModal(v, reload);
      } else {
        try {
          const fetched = await api.get(`/api/vouchers/${id}`);
          openEditVoucherModal(fetched, reload);
        } catch (err) {
          toastErr('تعذر تحميل بيانات السند: ' + (err.message || err));
        }
      }
    });

    delegate(view, 'click', '[data-act="pdf"]', async (e, btn) => {
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        await downloadVoucherDirectPdf(id);
      } catch (err) {
        toastErr('تعذر تحميل ملف PDF: ' + (err.message || err));
      } finally {
        btn.disabled = false;
      }
    });

    delegate(view, 'click', '[data-act="share"]', async (e, btn) => {
      const id = btn.dataset.id;
      const voucher = state.data.items.find((item) => item.id === id);
      if (voucher) await shareVoucherPdfFile({ voucher, issuer: { name_ar: voucher.issuer_name } });
    });

    delegate(view, 'click', '[data-act="delete"]', async (e, btn) => {
      const id = btn.dataset.id;
      const num = btn.dataset.num || '';
      const ok = await confirmDialog({
        title: `حذف سند القبض ${num} نهائياً`,
        message: 'هل أنت متأكد من حذف هذا السند نهائياً من قاعدة البيانات؟ سيتم مسح السند والقيود المرتبطة به بالكامل.',
        danger: true,
        okText: 'نعم، حذف نهائي',
      });
      if (!ok) return;
      try {
        await api.del(`/api/vouchers/${id}`);
        toastOk(`تم حذف سند القبض ${num} نهائياً من قاعدة البيانات`);
        await reload();
      } catch (err) {
        toastErr(err.message || 'فشل حذف السند');
      }
    });

    const headers = ['رقم السند', 'التاريخ', 'العميل', 'الشركة', 'طريقة السداد', 'المرجع', 'المبلغ', 'الموزّع', 'غير موزّع', 'الحالة'];
    const rows = () => state.data.items.map((v) => [v.voucher_number, v.voucher_date, v.client_name, v.issuer_name,
    v.payment_label, v.reference_no, v.total_amount, v.allocated_total, v.unallocated, v.status_label]);
    $('#exp-csv', view).addEventListener('click', () => exportCsv('سندات-القبض', headers, rows()));
    $('#exp-xls', view).addEventListener('click', () => exportExcel('سندات-القبض', 'سندات القبض', headers, rows()));

    $('#btn-voucher-templates', view)?.addEventListener('click', () => {
      modal({
        title: 'قوالب Excel المعتمدة لسندات القبض',
        wide: true,
        body: html`
          <p class="muted" style="margin-bottom:14px;font-size:13px">
            اختر قالب سند القبض المطلوب لتنزيل ملف الـ Excel الأصلي (.xlsx) المعتمد أو صيغة SpreadsheetML (.xls):
          </p>
          <div class="grid grid-2" style="gap:14px">
            <div class="card" style="border:1.5px solid rgba(212,175,55,0.45);border-radius:12px;padding:16px;background:#ffffff;box-shadow:0 4px 18px rgba(184,134,11,0.06)">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <span class="badge" style="background:var(--brand);color:#fff;font-weight:700">عينة توريدات الصقر</span>
                <span class="tiny mono" style="color:var(--brand-dark)">A4 Portrait</span>
              </div>
              <h3 style="margin:0 0 6px;color:var(--text-heading);font-size:15px">قسيمة تحصيل وسند قبض (توريدات الصقر)</h3>
              <p style="font-size:12px;color:#334155;margin:0 0 14px;line-height:1.5">
                قالب قسيمة تحصيل الصقر بكروت المؤشرات الأربعة (المبلغ، رقم السند، التاريخ، العميل)، شريط التفقيط، جدول بيان السند وتوزيع الفواتير، وثلاث تواقيع معتمدة (الصندوق، المحاسب، الختم).
              </p>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <a class="btn btn-sm btn-primary" href="/api/vouchers/template?style=voucher_saqr_slip&format=xlsx" target="_blank" download="voucher_template_voucher_saqr_slip.xlsx">
                  ${raw(icon.download({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' }))}تنزيل Excel (.xlsx)
                </a>
                <a class="btn btn-sm" href="/api/vouchers/template?style=voucher_saqr_slip&format=xls" target="_blank" download="voucher_template_voucher_saqr_slip.xls">
                  تنزيل توافقي (.xls)
                </a>
              </div>
            </div>

            <div class="card" style="border:1.5px solid rgba(184,134,11,0.45);border-radius:12px;padding:16px;background:#ffffff;box-shadow:0 4px 18px rgba(184,134,11,0.06)">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <span class="badge" style="background:var(--brand-dark);color:#fff;font-weight:700">عينة الإصدار الفاخر وتويوتا</span>
                <span class="tiny mono" style="color:var(--brand-dark)">A4 Portrait</span>
              </div>
              <h3 style="margin:0 0 6px;color:var(--text-heading);font-size:15px">سند قبض تجاري (الإصدار الفاخر وتويوتا)</h3>
              <p style="font-size:12px;color:#334155;margin:0 0 14px;line-height:1.5">
                قالب تنفيذي ثنائي اللغة فاخر، شريط بيانات السند والتاريخ، شارة المبلغ البارزة، شريط التفقيط، جدول تسديد الفواتير، والاعتماد الثنائي (الصندوق والمحاسب).
              </p>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <a class="btn btn-sm btn-primary" href="/api/vouchers/template?style=voucher_luxury_receipt&format=xlsx" target="_blank" download="voucher_template_voucher_luxury_receipt.xlsx">
                  ${raw(icon.download({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' }))}تنزيل Excel (.xlsx)
                </a>
                <a class="btn btn-sm" href="/api/vouchers/template?style=voucher_luxury_receipt&format=xls" target="_blank" download="voucher_template_voucher_luxury_receipt.xls">
                  تنزيل توافقي (.xls)
                </a>
              </div>
            </div>
          </div>
        `,
        footer: '<button class="btn" data-close type="button">إغلاق</button>',
      });
    });

    const getVouchersDocHtml = async () => {
      const issuer = store.issuers.find((item) => item.id === state.issuer_id) || store.activeIssuer || {};
      let settings = issuer.print_settings || {};
      if (typeof settings === 'string') { try { settings = JSON.parse(settings); } catch { settings = {}; } }
      const template = await loadStoredTemplate('reports', settings.report_template_style || '');
      const rows = state.data.items.map((v) => [
        v.voucher_number, v.voucher_date, v.client_name, v.issuer_name, v.payment_label, v.reference_no || '—',
        money(v.total_amount), money(v.allocated_total), money(v.unallocated), v.status_label,
      ]);
      const totals = state.data.totals || {};
      const footer = ['الإجمالي', '', '', '', '', '', money(totals.total_amount), money(totals.allocated_total || 0), money(totals.unallocated_total || 0), ''];
      const cells = (values, tag) => values.map((value) => `<${tag}>${esc(String(value ?? ''))}</${tag}>`).join('');
      return fillStoredTemplate(template, {
        title: 'تقرير قائمة سندات القبض',
        subtitle: `إجمالي السندات: ${num(state.data.total_count)} — الإجمالي: ${money(totals.total_amount)} ر.س`,
        issuer_name: issuer.name_ar || '', generated_at: new Date().toLocaleString('ar-SA'), page_size: 'A4 landscape',
        stats_html: '', headers_html: cells(headers, 'th'),
        rows_html: rows.length ? rows.map((row) => `<tr>${cells(row, 'td')}</tr>`).join('') : `<tr><td colspan="${headers.length}">لا توجد بيانات مسجلة</td></tr>`,
        footer_html: `<tr>${cells(footer, 'td')}</tr>`,
      }, ['stats_html', 'headers_html', 'rows_html', 'footer_html']);
    };

    $('#btn-pdf-vouchers', view).addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const docHtml = await getVouchersDocHtml();
        await downloadPdfFromHtml(docHtml, 'قائمة-سندات-القبض.pdf');
      } catch (err) {
        toastErr(err.message || 'تعذر تحميل ملف PDF');
      } finally {
        e.target.disabled = false;
      }
    });
  };

  const unsubSync = onSync((ev) => {
    if (ev.entity === 'vouchers' || ev.entity === 'invoices') {
      reload();
    }
  });

  await load();
  draw();
  return () => { unsubSync(); };
}


const kindLabel = (kind) => (kind === 'WAGES' ? 'قبض أجور بذهب عيار 24' : 'قبض معدن كسر');

function formatGoldLinesBadges(lines) {
  if (!Array.isArray(lines) || !lines.length) return '—';
  return lines.map((l) => `<span class="badge amber" style="margin-inline-end:4px;font-weight:700;direction:ltr">${esc(l.karat)}K: ${Number(l.weight || 0).toFixed(3)} جم</span>`).join('');
}

async function printGoldReceiptsBatch(ids, style = '') {
  if (!Array.isArray(ids) || !ids.length) return toastErr('حدد سنداً واحداً على الأقل للطباعة');
  const chosenStyle = style || localStorage.getItem('zs.gold_receipt_style') || '';
  const { html: batchHtml } = await api.post('/api/vouchers/gold/batch-html', { ids, style: chosenStyle });
  printDoc(batchHtml, { flowing: true });
}

export async function showGoldReceipt(id, onChange = null) {
  try {
    const templates = await loadTemplates('documents').catch(() => []);
    let style = localStorage.getItem('zs.gold_receipt_style') || '';
    if (!templates.some((t) => t.id === style)) style = '';
    let { html: documentHTML } = await api.get(`/api/vouchers/gold/${encodeURIComponent(id)}/html?style=${encodeURIComponent(style)}`);
    const m = modal({
      title: 'سند قبض الذهب',
      wide: true,
      body: '',
      footer: `<button class="btn" data-close type="button">إغلاق</button>
               <button class="btn" data-print type="button">${icon.printer({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })}طباعة</button>
               <a class="btn btn-primary" href="/api/vouchers/gold/${encodeURIComponent(id)}/pdf">${icon.pdf({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })}تحميل PDF</a>`,
    });
    const frame = document.createElement('iframe');
    frame.title = 'معاينة سند قبض الذهب';
    frame.style.cssText = 'width:100%;height:70vh;border:0;background:#fff;border-radius:8px';
    frame.srcdoc = documentHTML;
    m.body.append(frame);
    const field = document.createElement('div');
    field.className = 'field';
    field.style.marginBottom = '10px';
    field.innerHTML = html`<label>قالب السند</label><select><option value="">القالب الافتراضي</option>${raw(templates.map((t) => `<option value="${esc(t.id)}" ${t.id === style ? 'selected' : ''}>${esc(t.name_ar || t.name || t.id)}</option>`).join(''))}</select>`;
    m.body.prepend(field);
    const pdfLink = m.el.querySelector('a[href]');
    pdfLink.href = `/api/vouchers/gold/${encodeURIComponent(id)}/pdf?style=${encodeURIComponent(style)}`;
    field.querySelector('select').addEventListener('change', async (e) => {
      const selected = e.target.value;
      try {
        const result = await api.get(`/api/vouchers/gold/${encodeURIComponent(id)}/html?style=${encodeURIComponent(selected)}`);
        style = selected;
        documentHTML = result.html;
        frame.srcdoc = documentHTML;
        pdfLink.href = `/api/vouchers/gold/${encodeURIComponent(id)}/pdf?style=${encodeURIComponent(style)}`;
        localStorage.setItem('zs.gold_receipt_style', style);
      } catch (error) {
        e.target.value = style;
        toastErr(error.message || 'تعذر تحميل القالب');
      }
    });
    m.el.querySelector('[data-print]').addEventListener('click', () => printDoc(documentHTML));
    void onChange;
  } catch (error) {
    toastErr(error.message || 'تعذر عرض السند');
  }
}

export function openEditGoldReceiptModal(receipt, onDone = () => {}) {
  const em = modal({
    title: `تعديل سند قبض ذهب ${receipt.voucher_number}`,
    body: html`
      <div class="form-grid-2" style="gap:12px">
        <div class="field">
          <label class="req" for="egr-num">رقم السند</label>
          <input id="egr-num" type="text" class="mono ltr" value="${esc(receipt.voucher_number || '')}" style="font-weight:700" />
        </div>
        <div class="field">
          <label class="req" for="egr-date">تاريخ السند <span id="egr-weekday" class="tiny muted" style="font-weight:600"></span></label>
          <input id="egr-date" type="date" value="${esc(receipt.voucher_date || '')}" />
        </div>
      </div>
      <div class="mt">
        <label class="check" style="font-size:13px">
          <input type="checkbox" id="egr-skip-friday" checked />
          منع تحديد تاريخ يوم الجمعة
        </label>
        <div id="egr-fri-warn" class="alert alert-danger tiny mt" style="display:none">
          التاريخ المختار يوافق يوم الجمعة — يُرجى اختيار يوم آخر أو إلغاء قفل يوم الجمعة.
        </div>
      </div>
      <div class="field mt">
        <label for="egr-notes">ملاحظات / بيان السند</label>
        <input id="egr-notes" type="text" value="${esc(receipt.notes || '')}" />
      </div>
    `,
    footer: `<button class="btn" data-close type="button">إلغاء</button>
             <button class="btn btn-primary" id="egr-save" type="button">حفظ التعديلات</button>`,
  });

  const dateInp = $('#egr-date', em.body);
  const skipCb = $('#egr-skip-friday', em.body);
  const wdEl = $('#egr-weekday', em.body);
  const warnEl = $('#egr-fri-warn', em.body);

  const syncDateInfo = () => {
    const val = dateInp.value;
    const wd = weekdayAr(val);
    wdEl.textContent = wd ? `(${wd})` : '';
    const fri = isFridayIso(val) && skipCb.checked;
    warnEl.style.display = fri ? 'block' : 'none';
  };
  dateInp.addEventListener('input', syncDateInfo);
  skipCb.addEventListener('change', syncDateInfo);
  syncDateInfo();

  em.el.querySelector('#egr-save').addEventListener('click', async (e) => {
    const voucher_number = $('#egr-num', em.body).value.trim();
    const voucher_date = dateInp.value;
    const notes = $('#egr-notes', em.body).value.trim();
    const skip_friday = skipCb.checked;
    if (!voucher_number) return toastErr('أدخل رقم السند');
    if (!voucher_date) return toastErr('حدد تاريخ السند');
    if (skip_friday && isFridayIso(voucher_date)) return toastErr('لا يمكن تعيين تاريخ السند ليوم الجمعة');
    e.target.disabled = true;
    try {
      const updated = await api.patch(`/api/vouchers/gold/${encodeURIComponent(receipt.id)}`, {
        voucher_number,
        voucher_date,
        notes,
        skip_friday,
      });
      toastOk(`تم تعديل السند ${updated.voucher_number} بنجاح`);
      syncNotify('vouchers', 'update', updated);
      em.close();
      await onDone(updated);
    } catch (err) {
      toastErr(err.message || 'تعذر حفظ التعديلات');
      e.target.disabled = false;
    }
  });
}

export async function goldReceiptModal(invoice, kind, onDone = () => {}) {
  try {
    const previous = await api.get(`/api/vouchers/gold?invoice_id=${encodeURIComponent(invoice.id)}`);
    const weights = {};
    for (const line of invoice.lines || []) {
      const k = String(line.karat || '21');
      weights[k] = (weights[k] || 0) + Number(line.quantity || 0);
    }
    for (const receipt of previous.filter((v) => v.kind === 'METAL' && v.status === 'ACTIVE')) {
      for (const line of receipt.lines) weights[line.karat] = (weights[line.karat] || 0) - line.weight;
    }
    const karats = ['18', '21', '22', '24'].filter((k) => Math.round((weights[k] || 0) * 1000) > 0);
    if (kind === 'METAL' && !karats.length) return toastErr('لا يوجد وزن متبقٍ للقبض في الفاتورة');
    if (kind === 'WAGES' && previous.some((v) => v.kind === 'WAGES' && v.status === 'ACTIVE')) return toastErr('يوجد سند أجور ذهب لهذه الفاتورة');
    const savedPrice = kind === 'WAGES'
      ? await api.get(`/api/vouchers/gold/price?issuer_id=${encodeURIComponent(invoice.issuer_id)}&date=${encodeURIComponent(invoice.issue_date)}`)
      : {};
    const initCalc = calcVoucherDate(invoice.issue_date, 0, true);

    const m = modal({
      title: kindLabel(kind),
      body: html`
        <p style="margin-top:0">فاتورة <b class="mono">${invoice.invoice_number}</b> · تاريخ الفاتورة: <b class="mono ltr">${invoice.issue_date}</b> (${weekdayAr(invoice.issue_date)}) · العميل: <b>${invoice.client_name || invoice.buyer_name || ''}</b></p>
        <div class="form-grid-3">
          <div class="field">
            <label for="gr-offset">بعد كم يوم من الفاتورة</label>
            <input id="gr-offset" type="number" min="0" max="365" value="0" />
          </div>
          <div class="field">
            <label for="gr-date">تاريخ السند <span id="gr-date-wd" class="tiny muted"></span></label>
            <input id="gr-date" name="voucher_date" type="date" value="${initCalc.date}" />
          </div>
          <div class="field">
            <label for="gr-num">رقم السند (اختياري)</label>
            <input id="gr-num" name="voucher_number" type="text" class="mono ltr" placeholder="تلقائي إذا تُرك فارغاً" />
          </div>
        </div>
        <div style="margin:6px 0 10px">
          <label class="check tiny">
            <input type="checkbox" id="gr-skip-fri" checked />
            تخطي يوم الجمعة تلقائياً (لا يُصدر السند يوم الجمعة أبداً)
          </label>
          <span id="gr-fri-badge" class="badge amber" style="display:${initCalc.skippedFriday ? 'inline-flex' : 'none'};margin-inline-start:8px">تم ترحيل الجمعة إلى السبت</span>
        </div>
        ${raw(kind === 'WAGES'
          ? `<p>إجمالي الفاتورة شامل الضريبة: <b>${money(invoice.grand_total)}</b> ريال سعودي</p>
             <div class="field"><label>سعر جرام الذهب عيار 24 في تاريخ الفاتورة (ريال سعودي)</label>
               <input name="gold_price" type="number" min="0.01" step="0.01" value="${savedPrice.gold_price || ''}" required /></div>
             <p>إجمالي الفاتورة ÷ سعر الجرام = <b id="gold-result">—</b> جرام عيار 24</p>`
          : karats.map((k) => `<div class="field"><label>ذهب كسر عيار ${k} — الوزن المقبوض بالجرام</label>
               <input name="weight_${k}" type="number" min="0" max="${weights[k].toFixed(3)}" step="0.001" value="${weights[k].toFixed(3)}" /></div>`).join(''))}
        <div class="field mt"><label>بيان السند</label><textarea name="notes">قبض ذهب مقابل فاتورة رقم ${invoice.invoice_number}</textarea></div>`,
      footer: '<button class="btn" data-close type="button">إلغاء</button><button class="btn btn-primary" data-save type="button">تسجيل سند الذهب</button>',
    });

    const offInp = $('#gr-offset', m.body);
    const dateInp = $('#gr-date', m.body);
    const skipCb = $('#gr-skip-fri', m.body);
    const wdSpan = $('#gr-date-wd', m.body);
    const friBadge = $('#gr-fri-badge', m.body);

    const refreshWd = (shifted = false) => {
      const wd = weekdayAr(dateInp.value);
      wdSpan.textContent = wd ? `(${wd})` : '';
      if (skipCb.checked && isFridayIso(dateInp.value)) {
        wdSpan.style.color = 'var(--danger, #dc2626)';
        friBadge.style.display = 'inline-flex';
        friBadge.className = 'badge red';
        friBadge.textContent = '⚠ يوافق يوم الجمعة — غير مسموح';
      } else if (shifted) {
        wdSpan.style.color = '';
        friBadge.style.display = 'inline-flex';
        friBadge.className = 'badge amber';
        friBadge.textContent = 'تعدّى الجمعة ← السبت';
      } else {
        wdSpan.style.color = '';
        friBadge.style.display = 'none';
      }
    };
    const recalcFromOffset = () => {
      const res = calcVoucherDate(invoice.issue_date, offInp.value, skipCb.checked);
      dateInp.value = res.date;
      refreshWd(res.skippedFriday);
    };
    offInp.addEventListener('input', recalcFromOffset);
    skipCb.addEventListener('change', recalcFromOffset);
    dateInp.addEventListener('input', () => refreshWd(false));
    refreshWd(initCalc.skippedFriday);

    const price = m.body.querySelector('[name="gold_price"]');
    if (price) {
      const update = () => {
        const p = Number(price.value);
        m.body.querySelector('#gold-result').textContent = p > 0 ? (Number(invoice.grand_total) / p).toFixed(3) : '—';
      };
      price.addEventListener('input', update);
      update();
    }
    m.el.querySelector('[data-save]').addEventListener('click', async (e) => {
      const values = formValues(m.body);
      if (!values.voucher_date) return toastErr('حدد تاريخ السند');
      if (skipCb.checked && isFridayIso(values.voucher_date)) return toastErr('لا يمكن إصدار سند قبض ذهب يوم الجمعة');
      if (kind === 'WAGES' && !(Number(values.gold_price) > 0)) return toastErr('أدخل سعر جرام عيار 24 في تاريخ الفاتورة');
      const lines = kind === 'METAL' ? karats.map((k) => ({ karat: k, weight: Number(values['weight_' + k]) })).filter((l) => l.weight > 0) : [];
      if (kind === 'METAL' && !lines.length) return toastErr('أدخل وزن الذهب المقبوض');
      e.target.disabled = true;
      try {
        const v = await api.post('/api/vouchers/gold', {
          invoice_id: invoice.id,
          kind,
          voucher_date: values.voucher_date,
          voucher_number: (values.voucher_number || '').trim(),
          skip_friday: skipCb.checked,
          gold_price: Number(values.gold_price || 0),
          lines,
          notes: values.notes,
        });
        m.close();
        toastOk(`تم تسجيل ${v.voucher_number}: ${v.total_weight.toFixed(3)} جرام`);
        syncNotify('vouchers', 'create', v);
        await onDone();
        await showGoldReceipt(v.id);
      } catch (error) {
        toastErr(error.message || 'تعذر حفظ السند');
        e.target.disabled = false;
      }
    });
  } catch (error) {
    toastErr(error.message || 'تعذر قراءة بيانات الفاتورة');
  }
}

/** نافذة إنشاء سندات قبض ذهب دفعية (معدن كسر) لكل عملاء المورد دفعة واحدة بتسلسل موحد وتخطي يوم الجمعة. */
export async function goldReceiptBatchModal({ issuerId = '', onDone = () => {} } = {}) {
  await loadClients();
  const activeIssuers = store.issuers.filter((i) => i.is_active);
  const initialIssuerId = issuerId || store.activeIssuerId || activeIssuers[0]?.id || '';

  const m = modal({
    title: 'إنشاء سندات قبض ذهب دفعية — لكل عملاء المورد',
    wide: true,
    body: html`
      <div class="alert alert-info tiny" style="margin-bottom:10px">
        اختر <b>المورد (المتجر المصدر)</b> لإظهار جميع فواتير كل العملاء المؤهلة لقبض الذهب، ثم حدّد الفواتير واضبط
        <b>تأخير التاريخ (مع تخطي يوم الجمعة تلقائياً)</b> و<b>رقم بداية التسلسل</b> و<b>الفارق بين السندات</b> لإنشائها دفعة واحدة بتسلسل موحد.
      </div>

      <!-- ── الصف 1: اختيار المورد والفلاتر السريعة ───────────────────────── -->
      <div class="form-grid-4" style="gap:10px">
        <div class="field" style="margin:0">
          <label class="req" for="gb-issuer">المورد (المتجر المصدر)</label>
          <select id="gb-issuer">
            <option value="">— اختر المورد —</option>
            ${raw(activeIssuers.map((i) => `<option value="${esc(i.id)}" ${i.id === initialIssuerId ? 'selected' : ''}>${esc(i.name_ar)}</option>`).join(''))}
          </select>
        </div>
        <div class="field" style="margin:0">
          <label for="gb-client">العميل</label>
          <select id="gb-client">
            <option value="">كل العملاء (تسلسل موحد)</option>
            ${raw(store.clients.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.client_code)})</option>`).join(''))}
          </select>
        </div>
        <div class="field" style="margin:0">
          <label for="gb-from">فواتير من تاريخ</label>
          <input type="date" id="gb-from" />
        </div>
        <div class="field" style="margin:0">
          <label for="gb-to">فواتير إلى تاريخ</label>
          <input type="date" id="gb-to" />
        </div>
      </div>

      <!-- ── الصف 2: إعدادات التاريخ والتسلسل والفارق ───────────────────── -->
      <div class="card mt" style="padding:12px 14px;border:1.5px solid rgba(212,175,55,0.45);background:rgba(212,175,55,0.05)">
        <div class="form-grid-4" style="gap:10px">
          <div class="field" style="margin:0">
            <label for="gb-offset">تاريخ السند (بعد كم يوم)</label>
            <input type="number" id="gb-offset" value="2" min="0" max="365" />
            <span class="hint tiny">أيام بعد تاريخ كل فاتورة</span>
          </div>
          <div class="field" style="margin:0">
            <label for="gb-start-no">بداية التسلسل (أول رقم)</label>
            <input type="text" id="gb-start-no" class="mono ltr" placeholder="مثال: 100 أو G-RV-00100" />
            <span id="gb-last-hint" class="hint tiny muted"></span>
          </div>
          <div class="field" style="margin:0">
            <label for="gb-gap-min">الفارق بين السندات</label>
            <input type="number" id="gb-gap-min" value="1" min="1" max="1000" />
            <span class="hint tiny">1 = متسلسل، 2 = +2، 5 = +5</span>
          </div>
          <div class="field" style="margin:0">
            <label for="gb-gap-max">فارق إلى (اختياري عشوائي)</label>
            <div style="display:flex;gap:4px;align-items:center">
              <input type="number" id="gb-gap-max" placeholder="ثابت" min="1" max="1000" style="flex:1;min-width:0" />
              <button type="button" id="gb-reroll" class="btn btn-sm" style="display:none;white-space:nowrap" title="إعادة توزيع الفوارق العشوائية">↻ توزيع</button>
            </div>
            <span class="hint tiny">اتركه فارغاً للفارق الثابت</span>
          </div>
        </div>

        <div class="form-grid-2 mt" style="gap:10px;align-items:center">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <label class="check" style="font-weight:700;font-size:13px;margin:0">
              <input type="checkbox" id="gb-skip-friday" checked />
              تخطي يوم الجمعة أبداً (ترحيل تلقائي للسبت)
            </label>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="search" id="gb-q" placeholder="بحث سريع في الفواتير أو العملاء…" style="flex:1" />
            <input type="text" id="gb-notes" placeholder="ملاحظة عامة (اختياري)…" style="flex:1" />
          </div>
        </div>
      </div>

      <!-- ── شريط الملخص والتحذيرات وجدول المعاينة الحية ──────────────────── -->
      <div id="gb-summary" class="mt"></div>
      <div id="gb-table-wrap" class="mt"></div>
      <div id="gb-result" class="mt" style="display:none"></div>
    `,
    footer: `<button class="btn" data-close type="button">إلغاء</button>
             <button class="btn btn-primary" data-create type="button" disabled>إنشاء سندات قبض الذهب</button>`,
  });

  let eligibleData = null;
  let selectedIds = new Set();
  let randomGaps = [];
  let plannedRows = [];
  let hasCollision = false;
  let lastLoadedIssuer = '';

  const issuerSel = $('#gb-issuer', m.body);
  const clientSel = $('#gb-client', m.body);
  const fromInp = $('#gb-from', m.body);
  const toInp = $('#gb-to', m.body);
  const qInp = $('#gb-q', m.body);
  const offsetInp = $('#gb-offset', m.body);
  const skipFriCb = $('#gb-skip-friday', m.body);
  const startNoInp = $('#gb-start-no', m.body);
  const lastHint = $('#gb-last-hint', m.body);
  const gapMinInp = $('#gb-gap-min', m.body);
  const gapMaxInp = $('#gb-gap-max', m.body);
  const rerollBtn = $('#gb-reroll', m.body);
  const notesInp = $('#gb-notes', m.body);
  const summaryBox = $('#gb-summary', m.body);
  const tableWrap = $('#gb-table-wrap', m.body);
  const resultBox = $('#gb-result', m.body);
  const createBtn = m.el.querySelector('[data-create]');

  const regenerateRandomGaps = (count) => {
    const minG = Math.max(1, parseInt(gapMinInp.value, 10) || 1);
    const maxRaw = parseInt(gapMaxInp.value, 10);
    const maxG = Number.isFinite(maxRaw) && maxRaw > minG ? maxRaw : minG;
    randomGaps = [];
    for (let i = 0; i < Math.max(count, 200); i++) {
      randomGaps.push(maxG > minG ? minG + Math.floor(Math.random() * (maxG - minG + 1)) : minG);
    }
  };

  const renderPreview = () => {
    const items = eligibleData?.items || [];
    const existingSet = new Set(eligibleData?.existing_numbers || []);
    const offset = Math.max(0, parseInt(offsetInp.value, 10) || 0);
    const skipFriday = skipFriCb.checked;
    const minG = Math.max(1, parseInt(gapMinInp.value, 10) || 1);
    const maxRaw = parseInt(gapMaxInp.value, 10);
    const maxG = Number.isFinite(maxRaw) && maxRaw > minG ? maxRaw : minG;
    rerollBtn.style.display = maxG > minG ? 'inline-flex' : 'none';

    if (!issuerSel.value) {
      summaryBox.innerHTML = '';
      tableWrap.innerHTML = '<div class="alert alert-warn tiny">اختر المورد أولاً لعرض فواتير جميع العملاء.</div>';
      createBtn.disabled = true;
      createBtn.textContent = 'إنشاء سندات قبض الذهب';
      plannedRows = [];
      return;
    }

    if (!items.length) {
      summaryBox.innerHTML = '';
      tableWrap.innerHTML = '<div class="alert alert-warn tiny">لا توجد فواتير ذات وزن ذهب متبقٍ للقبض لهذا المورد وفق الفلاتر المحددة.</div>';
      createBtn.disabled = true;
      createBtn.textContent = 'إنشاء سندات قبض الذهب';
      plannedRows = [];
      return;
    }

    // حساب التاريخ المتوقع لكل فاتورة وفرز جميع الفواتير تصاعدياً لتوحيد التسلسل بين كل العملاء
    const enriched = items.map((inv) => {
      const dt = calcVoucherDate(inv.issue_date, offset, skipFriday);
      return { inv, voucherDate: dt.date, weekday: dt.weekday, skippedFriday: dt.skippedFriday };
    });
    enriched.sort((a, b) => (
      a.voucherDate.localeCompare(b.voucherDate)
      || a.inv.issue_date.localeCompare(b.inv.issue_date)
      || (a.inv.issue_time || '').localeCompare(b.inv.issue_time || '')
      || (a.inv.sequence_no - b.inv.sequence_no)
      || a.inv.invoice_number.localeCompare(b.inv.invoice_number)
    ));

    // استخراج نمط بداية التسلسل
    const fallbackStart = eligibleData?.suggested_start_no || '';
    const parsedDef = parseSerialPattern(fallbackStart, `G-${eligibleData?.voucher_prefix || 'RV'}`, 1, 5);
    const { prefix, startNo, pad } = parseSerialPattern(startNoInp.value, parsedDef.prefix, parsedDef.startNo, parsedDef.pad);

    if (randomGaps.length < enriched.length) {
      regenerateRandomGaps(enriched.length);
    }

    // تعيين أرقام التسلسل للفواتير المحددة فقط بالترتيب الزمني الموحد
    plannedRows = [];
    const plannedById = new Map();
    const collisions = [];
    const clientSet = new Set();
    let totalWeight = 0;
    let skippedFridayCount = 0;
    let currNo = startNo;
    let orderIdx = 0;

    for (const row of enriched) {
      if (!selectedIds.has(row.inv.id)) continue;
      if (orderIdx > 0) {
        const step = maxG > minG ? (randomGaps[orderIdx] || minG) : minG;
        currNo += step;
      }
      const voucherNumber = formatSerialPattern(prefix, currNo, pad);
      const isColliding = existingSet.has(voucherNumber);
      if (isColliding) collisions.push(voucherNumber);
      const planned = {
        order: orderIdx + 1,
        invoice_id: row.inv.id,
        invoice_number: row.inv.invoice_number,
        client_id: row.inv.client_id,
        client_name: row.inv.client_name,
        client_code: row.inv.client_code,
        issue_date: row.inv.issue_date,
        voucher_date: row.voucherDate,
        weekday: row.weekday,
        skippedFriday: row.skippedFriday,
        voucher_number: voucherNumber,
        remaining_weight: row.inv.remaining_weight,
        remaining_lines: row.inv.remaining_lines,
        isColliding,
      };
      plannedRows.push(planned);
      plannedById.set(row.inv.id, planned);
      clientSet.add(row.inv.client_id);
      totalWeight += Number(row.inv.remaining_weight || 0);
      if (row.skippedFriday) skippedFridayCount++;
      orderIdx++;
    }

    hasCollision = collisions.length > 0;
    const allSelected = enriched.length > 0 && selectedIds.size === enriched.length;
    const seqRangeText = plannedRows.length
      ? `${plannedRows[0].voucher_number} ← ${plannedRows[plannedRows.length - 1].voucher_number}`
      : '—';

    summaryBox.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:8px 12px;border-radius:8px;background:var(--card);border:1px solid var(--line)">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <button type="button" class="btn btn-sm" id="gb-sel-all">تحديد الكل (${enriched.length})</button>
          <button type="button" class="btn btn-sm btn-ghost" id="gb-sel-none">إلغاء التحديد</button>
          <span class="badge green">المحدد: <b>${plannedRows.length}</b> فاتورة</span>
          <span class="badge gray">العملاء: <b>${clientSet.size}</b> عميل</span>
          <span class="badge amber">إجمالي الوزن: <b class="mono ltr">${totalWeight.toFixed(3)}</b> جم</span>
          <span class="badge" style="background:var(--brand-light);color:var(--brand);font-weight:700">التسلسل: <span class="mono ltr">${esc(seqRangeText)}</span></span>
          ${skippedFridayCount > 0 ? `<span class="badge amber">✓ تم تجاوز ${skippedFridayCount} يوم جمعة تلقائياً</span>` : ''}
        </div>
      </div>
      ${hasCollision ? `<div class="alert alert-danger tiny mt">⚠ أرقام السندات التالية مستخدمة بالفعل لدى هذا المورد: <b class="mono ltr">${esc(collisions.slice(0, 8).join(', '))}${collisions.length > 8 ? '…' : ''}</b> — عدّل رقم بداية التسلسل أو الفارق.</div>` : ''}
    `;

    $('#gb-sel-all', summaryBox)?.addEventListener('click', () => {
      selectedIds = new Set(enriched.map((r) => r.inv.id));
      renderPreview();
    });
    $('#gb-sel-none', summaryBox)?.addEventListener('click', () => {
      selectedIds.clear();
      renderPreview();
    });

    tableWrap.innerHTML = `
      <div class="table-wrap" style="max-height:330px;overflow-y:auto;border:1px solid var(--line);border-radius:8px">
        <table class="tbl compact" style="margin:0;font-size:12.5px">
          <thead>
            <tr>
              <th style="width:32px;text-align:center"><input type="checkbox" id="gb-check-all" ${allSelected ? 'checked' : ''} title="تحديد / إلغاء تحديد الكل" /></th>
              <th style="width:36px">#</th>
              <th style="white-space:nowrap">رقم السند المتوقع</th>
              <th>العميل</th>
              <th style="white-space:nowrap">الفاتورة</th>
              <th style="white-space:nowrap">تاريخ الفاتورة</th>
              <th style="white-space:nowrap">تاريخ السند</th>
              <th>العيارات المتبقية</th>
              <th class="text-end" style="white-space:nowrap">الوزن (جم)</th>
            </tr>
          </thead>
          <tbody>
            ${enriched.map((r) => {
              const p = plannedById.get(r.inv.id);
              const checked = !!p;
              const numBadge = !checked
                ? '<span class="muted">—</span>'
                : p.isColliding
                  ? `<span class="badge red mono ltr" title="رقم مستخدم مسبقاً">${esc(p.voucher_number)} ⚠</span>`
                  : `<span class="badge mono ltr" style="background:var(--brand-light);color:var(--brand);font-weight:700">${esc(p.voucher_number)}</span>`;
              const friTag = r.skippedFriday
                ? '<span class="badge amber" style="font-size:10.5px;margin-inline-start:4px" title="صادف يوم الجمعة فتم ترحيله للسبت">تعدّى الجمعة</span>'
                : (isFridayIso(r.voucherDate) ? '<span class="badge red" style="font-size:10.5px;margin-inline-start:4px">جمعة</span>' : '');
              return `<tr class="${checked ? '' : 'row-off'}">
                <td style="text-align:center"><input type="checkbox" data-gb-pick="${esc(r.inv.id)}" ${checked ? 'checked' : ''} /></td>
                <td class="muted mono">${checked ? p.order : '—'}</td>
                <td class="nowrap">${numBadge}</td>
                <td><b>${esc(r.inv.client_name)}</b>${r.inv.client_code ? `<div class="tiny muted mono">${esc(r.inv.client_code)}</div>` : ''}</td>
                <td class="mono nowrap">${esc(r.inv.invoice_number)}</td>
                <td class="tiny nowrap"><span class="mono ltr">${esc(r.inv.issue_date)}</span> <span class="muted">(${esc(weekdayAr(r.inv.issue_date))})</span></td>
                <td class="tiny nowrap"><b><span class="mono ltr">${esc(r.voucherDate)}</span></b> <span class="muted">(${esc(r.weekday)})</span>${friTag}</td>
                <td>${formatGoldLinesBadges(r.inv.remaining_lines)}</td>
                <td class="text-end num mono"><b>${Number(r.inv.remaining_weight || 0).toFixed(3)}</b></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    $('#gb-check-all', tableWrap)?.addEventListener('change', (e) => {
      if (e.target.checked) selectedIds = new Set(enriched.map((r) => r.inv.id));
      else selectedIds.clear();
      renderPreview();
    });
    $$('[data-gb-pick]', tableWrap).forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedIds.add(cb.dataset.gbPick);
        else selectedIds.delete(cb.dataset.gbPick);
        renderPreview();
      });
    });

    createBtn.disabled = plannedRows.length === 0 || hasCollision;
    createBtn.textContent = plannedRows.length > 0
      ? `إنشاء ${plannedRows.length} سند قبض ذهب دفعة واحدة`
      : 'إنشاء سندات قبض الذهب';
  };

  const loadEligible = async (resetStartNumber = false) => {
    const issId = issuerSel.value;
    if (!issId) {
      eligibleData = null;
      selectedIds.clear();
      lastHint.textContent = '';
      renderPreview();
      return;
    }
    tableWrap.innerHTML = '<div class="alert alert-info tiny">جارٍ تحميل فواتير جميع عملاء المورد…</div>';
    createBtn.disabled = true;
    try {
      const data = await api.get(qs('/api/vouchers/gold/eligible-invoices', {
        issuer_id: issId,
        client_id: clientSel.value,
        from: fromInp.value,
        to: toInp.value,
        q: qInp.value.trim(),
      }));
      eligibleData = data;
      const issuerChanged = issId !== lastLoadedIssuer;
      lastLoadedIssuer = issId;

      if (resetStartNumber || issuerChanged || !startNoInp.value.trim()) {
        startNoInp.value = data.suggested_start_no || '';
      }
      lastHint.textContent = data.last_voucher_number
        ? `آخر سند سابق للمورد: ${data.last_voucher_number}`
        : 'لا توجد سندات ذهب سابقة لهذا المورد';

      // تحديد جميع الفواتير المؤهلة تلقائياً لسرعة الإنشاء الدفعي
      selectedIds = new Set((data.items || []).map((i) => i.id));
      regenerateRandomGaps((data.items || []).length);
      renderPreview();
    } catch (err) {
      tableWrap.innerHTML = `<div class="alert alert-danger tiny">${esc(err.message || 'تعذر تحميل الفواتير')}</div>`;
      eligibleData = null;
      plannedRows = [];
    }
  };

  issuerSel.addEventListener('change', () => loadEligible(true));
  clientSel.addEventListener('change', () => loadEligible(false));
  fromInp.addEventListener('change', () => loadEligible(false));
  toInp.addEventListener('change', () => loadEligible(false));
  qInp.addEventListener('input', debounce(() => loadEligible(false), 300));

  offsetInp.addEventListener('input', renderPreview);
  skipFriCb.addEventListener('change', renderPreview);
  startNoInp.addEventListener('input', renderPreview);
  gapMinInp.addEventListener('input', () => { regenerateRandomGaps(eligibleData?.items?.length || 100); renderPreview(); });
  gapMaxInp.addEventListener('input', () => { regenerateRandomGaps(eligibleData?.items?.length || 100); renderPreview(); });
  rerollBtn.addEventListener('click', () => { regenerateRandomGaps(eligibleData?.items?.length || 100); renderPreview(); });

  createBtn.addEventListener('click', async () => {
    if (!issuerSel.value || !plannedRows.length || hasCollision) return;
    const offset = Math.max(0, parseInt(offsetInp.value, 10) || 0);
    const minG = Math.max(1, parseInt(gapMinInp.value, 10) || 1);
    const maxRaw = parseInt(gapMaxInp.value, 10);
    const maxG = Number.isFinite(maxRaw) && maxRaw > minG ? maxRaw : minG;
    const skipFriday = skipFriCb.checked;
    const totalW = plannedRows.reduce((s, r) => s + Number(r.remaining_weight || 0), 0);
    const clientsCount = new Set(plannedRows.map((r) => r.client_id)).size;
    const gapDesc = maxG > minG ? `عشوائي من ${minG} إلى ${maxG}` : `ثابت (+${minG})`;
    const issuerName = eligibleData?.issuer_name || '';

    const ok = await confirmDialog({
      title: `تأكيد إنشاء ${plannedRows.length} سند قبض ذهب`,
      message: `المورد: ${issuerName} | عدد السندات: ${plannedRows.length} سند لـ ${clientsCount} عميل | إجمالي الوزن: ${totalW.toFixed(3)} جرام | التسلسل: ${plannedRows[0].voucher_number} ← ${plannedRows[plannedRows.length - 1].voucher_number} (الفارق: ${gapDesc}) | التاريخ: بعد ${offset} يوم${skipFriday ? ' مع تخطي يوم الجمعة أبداً' : ''}. هل تريد المتابعة؟`,
      okText: `نعم، إنشاء ${plannedRows.length} سند`,
    });
    if (!ok) return;

    createBtn.disabled = true;
    createBtn.textContent = 'جارٍ إنشاء السندات…';
    try {
      const res = await api.post('/api/vouchers/gold/batch', {
        issuer_id: issuerSel.value,
        kind: 'METAL',
        date_offset: offset,
        skip_friday: skipFriday,
        start_number: startNoInp.value.trim(),
        seq_gap_min: minG,
        seq_gap_max: maxG,
        notes_prefix: notesInp.value.trim(),
        items: plannedRows.map((p) => ({
          invoice_id: p.invoice_id,
          voucher_number: p.voucher_number,
          voucher_date: p.voucher_date,
        })),
      });

      toastOk(`تم إنشاء ${res.count} سند قبض ذهب بنجاح (${res.first_number} ← ${res.last_number})`);
      syncNotify('vouchers', 'create', res);

      summaryBox.style.display = 'none';
      tableWrap.style.display = 'none';
      resultBox.style.display = 'block';
      const createdItems = res.items || [];
      resultBox.innerHTML = `
        <div class="card" style="border:2px solid var(--success, #10b981);padding:14px;border-radius:10px">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:10px">
            <div>
              <div style="font-weight:800;font-size:15px;color:var(--success, #10b981)">
                ✓ تم إنشاء ${res.count} سند قبض ذهب بنجاح لـ ${res.client_count} عميل
              </div>
              <div class="tiny muted" style="margin-top:3px">
                التسلسل: <b class="mono ltr">${esc(res.first_number)} ← ${esc(res.last_number)}</b> ·
                إجمالي الوزن: <b class="mono ltr">${Number(res.total_weight || 0).toFixed(3)}</b> جرام
                ${res.skipped_fridays > 0 ? ` · تم ترحيل ${res.skipped_fridays} يوم جمعة تلقائياً` : ''}
              </div>
            </div>
            <button type="button" class="btn btn-primary btn-sm" id="gb-print-all">
              ${icon.printer({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })}طباعة كل السندات (${createdItems.length})
            </button>
          </div>
          <div class="table-wrap" style="max-height:280px;overflow-y:auto">
            <table class="tbl compact" style="font-size:12.5px">
              <thead><tr><th>رقم السند</th><th>العميل</th><th>الفاتورة</th><th>تاريخ السند</th><th class="text-end">الوزن (جم)</th><th></th></tr></thead>
              <tbody>
                ${createdItems.map((v) => `<tr>
                  <td class="mono ltr"><b>${esc(v.voucher_number)}</b></td>
                  <td>${esc(v.client_name)}</td>
                  <td class="mono">${esc(v.invoice_number)}</td>
                  <td class="tiny"><span class="mono ltr">${esc(v.voucher_date)}</span> <span class="muted">(${esc(weekdayAr(v.voucher_date))})</span></td>
                  <td class="text-end num mono"><b>${Number(v.total_weight || 0).toFixed(3)}</b></td>
                  <td><button type="button" class="btn btn-sm btn-ghost" data-res-show="${esc(v.id)}">عرض</button></td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      $('#gb-print-all', resultBox)?.addEventListener('click', async (ev) => {
        ev.currentTarget.disabled = true;
        try {
          await printGoldReceiptsBatch(createdItems.map((x) => x.id));
        } catch (e) {
          toastErr(e.message || 'تعذر طباعة السندات');
        } finally {
          ev.currentTarget.disabled = false;
        }
      });
      $$('[data-res-show]', resultBox).forEach((b) => b.addEventListener('click', () => showGoldReceipt(b.dataset.resShow)));

      createBtn.style.display = 'none';
      const closeBtn = m.el.querySelector('[data-close]');
      if (closeBtn) closeBtn.textContent = 'إغلاق وتحديث القائمة';
      await onDone(res);
    } catch (err) {
      toastErr(err.message || 'تعذر إنشاء السندات الدفعية');
      createBtn.disabled = false;
      createBtn.textContent = `إنشاء ${plannedRows.length} سند قبض ذهب دفعة واحدة`;
    }
  });

  if (initialIssuerId) {
    await loadEligible(true);
  } else {
    renderPreview();
  }
  return m;
}

export async function renderGoldReceipts(view) {
  await loadClients();
  const state = {
    issuer_id: store.activeIssuerId || '',
    client_id: '',
    kind: '',
    status: '',
    from: '',
    to: '',
    q: '',
    items: [],
  };
  const checkedIds = new Set();

  async function load() {
    const receipts = await api.get(qs('/api/vouchers/gold', {
      issuer_id: state.issuer_id,
      client_id: state.client_id,
      kind: state.kind,
      status: state.status,
      from: state.from,
      to: state.to,
      q: state.q,
    }));
    state.items = Array.isArray(receipts) ? receipts : [];
    const validSet = new Set(state.items.map((x) => x.id));
    for (const id of Array.from(checkedIds)) {
      if (!validSet.has(id)) checkedIds.delete(id);
    }
  }

  async function draw() {
    const activeItems = state.items.filter((v) => v.status === 'ACTIVE');
    const totalGrams = activeItems.reduce((a, v) => a + Number(v.total_weight || 0), 0);
    const karatSums = { '18': 0, '21': 0, '22': 0, '24': 0 };
    for (const v of activeItems) {
      for (const ln of v.lines || []) {
        if (karatSums[ln.karat] !== undefined) karatSums[ln.karat] += Number(ln.weight || 0);
      }
    }
    const allChecked = state.items.length > 0 && checkedIds.size === state.items.length;

    view.innerHTML = html`
      <div class="page-head">
        <div class="titles">
          <h1>${raw(icon.goldBar({ size: 24, style: 'vertical-align:middle;margin-left:8px;color:#d4af37' }))}سندات قبض الذهب</h1>
          <p>قبض معدن كسر بالجرام (دفعي لكل عملاء المورد أو مفرد) مع تخطي يوم الجمعة وتوحيد التسلسل، وقبض أجور بذهب عيار 24.</p>
        </div>
        <div class="page-actions">
          ${raw(can('vouchers.create') ? `
            <button class="btn btn-primary" id="new-gold-batch" type="button" title="إنشاء سندات قبض ذهب دفعية لجميع فواتير كل عملاء المورد بتسلسل موحد وتخطي الجمعة">
              ${icon.goldBar({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}سندات قبض ذهب دفعية (كل عملاء المورد)
            </button>
            <button class="btn" id="new-gold" type="button">سند قبض ذهب مفرد</button>
          ` : '')}
          <button class="btn" id="btn-gold-print-batch" type="button" ${raw(state.items.length ? '' : 'disabled')}>
            ${raw(icon.printer({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' }))}
            <span id="gold-print-label">${checkedIds.size > 0 ? `طباعة المحدد (${checkedIds.size})` : `طباعة المعروض (${state.items.length})`}</span>
          </button>
          <button class="btn" id="gold-exp-xls" type="button">${raw(icon.fileSpreadsheet({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' }))}Excel</button>
          <a class="btn" href="#/vouchers">سندات القبض بالريال</a>
        </div>
      </div>

      <div class="card filter-box">
        <div class="filter-row">
          <div class="field flex-2">
            <label for="g-q">بحث سريع</label>
            <input type="search" id="g-q" value="${esc(state.q)}" placeholder="رقم السند، رقم الفاتورة، اسم العميل، ملاحظات…" />
          </div>
          <div class="field">
            <label for="g-issuer">المورد (المتجر المصدر)</label>
            <select id="g-issuer">
              <option value="">كل الموردين</option>
              ${raw(store.issuers.map((i) => `<option value="${esc(i.id)}" ${i.id === state.issuer_id ? 'selected' : ''}>${esc(i.name_ar)}</option>`).join(''))}
            </select>
          </div>
          <div class="field">
            <label for="g-client">العميل</label>
            <select id="g-client">
              <option value="">كل العملاء</option>
              ${raw(store.clients.map((c) => `<option value="${esc(c.id)}" ${c.id === state.client_id ? 'selected' : ''}>${esc(c.name)}</option>`).join(''))}
            </select>
          </div>
          <div class="field field-sm">
            <label for="g-kind">النوع</label>
            <select id="g-kind">
              <option value="">الكل</option>
              <option value="METAL" ${raw(state.kind === 'METAL' ? 'selected' : '')}>قبض معدن كسر</option>
              <option value="WAGES" ${raw(state.kind === 'WAGES' ? 'selected' : '')}>قبض أجور عيار 24</option>
            </select>
          </div>
          <div class="field field-sm">
            <label for="g-status">الحالة</label>
            <select id="g-status">
              <option value="">الكل</option>
              <option value="ACTIVE" ${raw(state.status === 'ACTIVE' ? 'selected' : '')}>نشط</option>
              <option value="CANCELLED" ${raw(state.status === 'CANCELLED' ? 'selected' : '')}>ملغى</option>
            </select>
          </div>
        </div>
        <div class="filter-row" style="margin-top:.75rem">
          <div class="field field-date"><label for="g-from">من تاريخ</label><input type="date" id="g-from" value="${esc(state.from)}" /></div>
          <div class="field field-date"><label for="g-to">إلى تاريخ</label><input type="date" id="g-to" value="${esc(state.to)}" /></div>
          <div class="filter-actions-col">
            <div class="filter-btn-group">
              <button class="btn btn-sm" id="g-reset" type="button">إعادة تعيين</button>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-3">
        <div class="stat"><div style="min-width:0"><div class="stat-val num">${num(activeItems.length)}</div><div class="stat-lab">عدد السندات النشطة (الإجمالي: ${num(state.items.length)})</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="stat-val num mono ltr">${totalGrams.toFixed(3)} جم</div><div class="stat-lab">إجمالي وزن الذهب المقبوض</div></div></div>
        <div class="stat"><div style="min-width:0"><div class="tiny" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px">
          ${raw(['18', '21', '22', '24'].map((k) => `<span class="badge amber mono ltr">${k}K: ${karatSums[k].toFixed(3)}</span>`).join(''))}
        </div><div class="stat-lab">توزيع الأوزان حسب العيار (جرام)</div></div></div>
      </div>

      <div class="card pad0 mt">
        <div class="table-wrap">
          <table class="tbl vouchers-tbl">
            <thead>
              <tr>
                <th style="width:32px;text-align:center"><input type="checkbox" id="g-check-all" ${raw(allChecked ? 'checked' : '')} title="تحديد الكل للطباعة" /></th>
                <th style="white-space:nowrap">رقم السند</th>
                <th style="white-space:nowrap">التاريخ</th>
                <th>المورد / العميل</th>
                <th style="white-space:nowrap">الفاتورة</th>
                <th style="white-space:nowrap">النوع</th>
                <th>تفاصيل العيارات</th>
                <th class="text-end" style="white-space:nowrap">الوزن (جرام)</th>
                <th class="text-center" style="white-space:nowrap">الحالة</th>
                <th class="text-center" style="white-space:nowrap;min-width:175px">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              ${raw(state.items.length ? state.items.map((v) => `<tr class="${v.status === 'CANCELLED' ? 'row-off' : ''}">
                <td style="text-align:center"><input type="checkbox" data-g-pick="${esc(v.id)}" ${checkedIds.has(v.id) ? 'checked' : ''} /></td>
                <td class="nowrap"><a href="javascript:void(0)" class="mono invoice-no-link" data-show="${esc(v.id)}" style="font-weight:700">${esc(v.voucher_number)}</a></td>
                <td class="tiny nowrap"><span class="mono ltr">${esc(v.voucher_date)}</span> <span class="muted">(${esc(weekdayAr(v.voucher_date))})</span></td>
                <td>
                  <div><b>${esc(v.client_name)}</b>${v.client_code ? ` <span class="tiny muted mono">(${esc(v.client_code)})</span>` : ''}</div>
                  <div class="tiny muted">${esc(v.issuer_name)}</div>
                </td>
                <td class="mono nowrap"><a href="#/invoice-view/${esc(v.invoice_id)}">${esc(v.invoice_number)}</a></td>
                <td class="tiny nowrap"><span class="badge ${v.kind === 'WAGES' ? 'gray' : 'amber'}">${esc(kindLabel(v.kind))}</span></td>
                <td>${formatGoldLinesBadges(v.lines)}</td>
                <td class="text-end num mono nowrap"><b>${Number(v.total_weight || 0).toFixed(3)}</b></td>
                <td class="text-center nowrap">${v.status === 'ACTIVE' ? '<span class="badge green">نشط</span>' : '<span class="badge red">ملغى</span>'}</td>
                <td class="actions">
                  <div class="row-actions-group">
                    <button class="btn btn-sm btn-ghost" data-show="${esc(v.id)}" type="button" title="عرض السند" style="padding:.28rem .55rem">${icon.eye({ size: 14, style: 'vertical-align:middle' })}<span>عرض</span></button>
                    <a class="btn btn-sm btn-icon btn-primary" href="/api/vouchers/gold/${encodeURIComponent(v.id)}/pdf" title="تحميل PDF">${icon.pdf({ size: 14, style: 'vertical-align:middle' })}</a>
                    ${v.status === 'ACTIVE' && can('vouchers.edit') ? `<button class="btn btn-sm btn-icon" data-edit-gold="${esc(v.id)}" type="button" title="تعديل التاريخ أو الرقم">${icon.edit({ size: 13, style: 'vertical-align:middle' })}</button>` : ''}
                    ${v.status === 'ACTIVE' && can('vouchers.cancel') ? `<button class="btn btn-sm" data-cancel="${esc(v.id)}" type="button" title="إلغاء السند وإتاحة وزنه من جديد">إلغاء</button>` : ''}
                    ${can('vouchers.delete') ? `<button class="btn btn-sm btn-icon btn-danger" data-del-gold="${esc(v.id)}" data-num="${esc(v.voucher_number)}" type="button" title="حذف نهائي">${icon.trash({ size: 13, style: 'vertical-align:middle' })}</button>` : ''}
                  </div>
                </td>
              </tr>`).join('') : '<tr><td colspan="10" class="text-center muted" style="padding:2rem">لا توجد سندات قبض ذهب مطابقة</td></tr>')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const reload = async () => { await load(); await draw(); };

    $('#g-q', view).addEventListener('input', debounce(async (e) => { state.q = e.target.value; await reload(); }, 300));
    ['g-issuer', 'g-client', 'g-kind', 'g-status', 'g-from', 'g-to'].forEach((elId) => {
      const key = elId.replace(/^g-/, '').replace('issuer', 'issuer_id').replace('client', 'client_id');
      $(`#${elId}`, view)?.addEventListener('change', async (e) => { state[key] = e.target.value; await reload(); });
    });
    $('#g-reset', view)?.addEventListener('click', async () => {
      Object.assign(state, { issuer_id: store.activeIssuerId || '', client_id: '', kind: '', status: '', from: '', to: '', q: '' });
      checkedIds.clear();
      await reload();
    });

    const updatePrintLabel = () => {
      const lbl = $('#gold-print-label', view);
      if (lbl) lbl.textContent = checkedIds.size > 0 ? `طباعة المحدد (${checkedIds.size})` : `طباعة المعروض (${state.items.length})`;
    };
    $('#g-check-all', view)?.addEventListener('change', (e) => {
      checkedIds.clear();
      if (e.target.checked) state.items.forEach((x) => checkedIds.add(x.id));
      $$('[data-g-pick]', view).forEach((cb) => { cb.checked = e.target.checked; });
      updatePrintLabel();
    });
    $$('[data-g-pick]', view).forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) checkedIds.add(cb.dataset.gPick);
        else checkedIds.delete(cb.dataset.gPick);
        const master = $('#g-check-all', view);
        if (master) master.checked = state.items.length > 0 && checkedIds.size === state.items.length;
        updatePrintLabel();
      });
    });

    $('#btn-gold-print-batch', view)?.addEventListener('click', async (e) => {
      const ids = checkedIds.size > 0 ? Array.from(checkedIds) : state.items.map((x) => x.id);
      if (!ids.length) return toastErr('لا توجد سندات للطباعة');
      e.currentTarget.disabled = true;
      try {
        await printGoldReceiptsBatch(ids);
      } catch (err) {
        toastErr(err.message || 'تعذر الطباعة المجمعة');
      } finally {
        e.currentTarget.disabled = false;
      }
    });

    $('#gold-exp-xls', view)?.addEventListener('click', () => {
      const headers = ['رقم السند', 'التاريخ', 'اليوم', 'المورد', 'العميل', 'الفاتورة', 'النوع', 'الوزن (جرام)', 'الحالة', 'ملاحظات'];
      const rows = state.items.map((v) => [
        v.voucher_number, v.voucher_date, weekdayAr(v.voucher_date), v.issuer_name, v.client_name,
        v.invoice_number, kindLabel(v.kind), Number(v.total_weight || 0).toFixed(3),
        v.status === 'ACTIVE' ? 'نشط' : 'ملغى', v.notes || '',
      ]);
      exportExcel('سندات-قبض-الذهب', 'سندات قبض الذهب', headers, rows);
    });

    $('#new-gold-batch', view)?.addEventListener('click', () => {
      goldReceiptBatchModal({ issuerId: state.issuer_id || store.activeIssuerId, onDone: reload });
    });

    $('#new-gold', view)?.addEventListener('click', async () => {
      const targetIssuer = state.issuer_id || store.activeIssuerId || '';
      const result = await api.get(qs('/api/invoices', { issuer_id: targetIssuer, limit: 300 }));
      const invoices = (result.items || []).filter((i) => i.status !== 'CANCELLED');
      const m = modal({
        title: 'قبض ذهب مفرد من فاتورة',
        body: html`
          <div class="field"><label>الفاتورة</label>
            <select name="invoice_id">${raw(invoices.map((i) => `<option value="${esc(i.id)}">${esc(i.invoice_number)} — ${esc(i.client_name || i.buyer_name)} (${esc(i.issue_date)})</option>`).join(''))}</select>
          </div>
          <div class="field mt"><label>نوع السند</label>
            <select name="kind"><option value="METAL">قبض معدن كسر</option><option value="WAGES">قبض أجور بذهب عيار 24</option></select>
          </div>`,
        footer: '<button class="btn" data-close type="button">إلغاء</button><button class="btn btn-primary" data-next type="button">التالي</button>',
      });
      m.el.querySelector('[data-next]').addEventListener('click', async () => {
        const values = formValues(m.body);
        if (!values.invoice_id) return toastErr('اختر فاتورة');
        const invoice = await api.get(`/api/invoices/${values.invoice_id}`);
        m.close();
        await goldReceiptModal(invoice, values.kind, reload);
      });
    });

    $$('[data-show]', view).forEach((b) => b.addEventListener('click', () => showGoldReceipt(b.dataset.show, reload)));
    $$('[data-edit-gold]', view).forEach((b) => b.addEventListener('click', () => {
      const rec = state.items.find((x) => x.id === b.dataset.editGold);
      if (rec) openEditGoldReceiptModal(rec, reload);
    }));
    $$('[data-cancel]', view).forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'إلغاء سند قبض الذهب',
        message: 'سيُلغى السند ويُتاح وزنه للقبض من جديد. هل تريد المتابعة؟',
        danger: true,
        okText: 'نعم، إلغاء السند',
      });
      if (!ok) return;
      try {
        await api.post(`/api/vouchers/gold/${encodeURIComponent(b.dataset.cancel)}/cancel`, {});
        toastOk('تم إلغاء السند بنجاح');
        await reload();
      } catch (err) {
        toastErr(err.message || 'تعذر إلغاء السند');
      }
    }));
    $$('[data-del-gold]', view).forEach((b) => b.addEventListener('click', async () => {
      const numStr = b.dataset.num || '';
      const ok = await confirmDialog({
        title: `حذف سند قبض الذهب ${numStr} نهائياً`,
        message: 'هل أنت متأكد من حذف هذا السند نهائياً؟ سيُتاح وزن الفاتورة للقبض من جديد.',
        danger: true,
        okText: 'نعم، حذف نهائي',
      });
      if (!ok) return;
      try {
        await api.del(`/api/vouchers/gold/${encodeURIComponent(b.dataset.delGold)}`);
        toastOk(`تم حذف السند ${numStr} نهائياً`);
        await reload();
      } catch (err) {
        toastErr(err.message || 'تعذر حذف السند');
      }
    }));
  }

  const unsubSync = onSync((ev) => {
    if (ev.entity === 'vouchers' || ev.entity === 'voucher' || ev.entity === 'invoices') {
      load().then(draw);
    }
  });

  await load();
  await draw();
  return () => { unsubSync(); };
}

async function printCashReceiptsBatch(ids, style = '') {
  if (!Array.isArray(ids) || !ids.length) return toastErr('حدد سنداً واحداً على الأقل للطباعة');
  const chosenStyle = style || localStorage.getItem('zs.voucher_style') || '';
  const { html: batchHtml } = await api.post('/api/vouchers/batch-html', { ids, style: chosenStyle });
  printDoc(batchHtml, { flowing: true });
}

export async function cashReceiptBatchModal({ issuerId = '', onDone = () => {} } = {}) {
  await loadClients();
  const activeIssuers = store.issuers.filter((i) => i.is_active);
  const initialIssuerId = issuerId || store.activeIssuerId || activeIssuers[0]?.id || '';

  const m = modal({
    title: 'إنشاء سندات قبض ريال دفعية — لكل عملاء المورد',
    wide: true,
    body: html`
      <div class="alert alert-info tiny" style="margin-bottom:10px">
        اختر <b>المورد (المتجر المصدر)</b> لإظهار جميع الفواتير غير المسددة لكل العملاء، ثم حدّد عدد الفواتير في كل سند (مثلاً 4 فواتير لكل عميل)
        و<b>تأخير التاريخ بعد آخر فاتورة</b> مع تخطي يوم الجمعة وتوحيد التسلسل بفارق متغير لكسر النمطية.
      </div>

      <div class="form-grid-4" style="gap:10px">
        <div class="field" style="margin:0">
          <label class="req" for="cb-issuer">المورد (المتجر المصدر)</label>
          <select id="cb-issuer">
            <option value="">— اختر المورد —</option>
            ${raw(activeIssuers.map((i) => `<option value="${esc(i.id)}" ${i.id === initialIssuerId ? 'selected' : ''}>${esc(i.name_ar)}</option>`).join(''))}
          </select>
        </div>
        <div class="field" style="margin:0">
          <label for="cb-client">العميل</label>
          <select id="cb-client">
            <option value="">كل العملاء (تسلسل موحد)</option>
            ${raw(store.clients.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.client_code)})</option>`).join(''))}
          </select>
        </div>
        <div class="field" style="margin:0">
          <label for="cb-from">فواتير من تاريخ</label>
          <input type="date" id="cb-from" />
        </div>
        <div class="field" style="margin:0">
          <label for="cb-to">فواتير إلى تاريخ</label>
          <input type="date" id="cb-to" />
        </div>
      </div>

      <div class="card mt" style="padding:12px 14px;border:1.5px solid rgba(16,185,129,0.4);background:rgba(16,185,129,0.04)">
        <div class="form-grid-4" style="gap:10px">
          <div class="field" style="margin:0">
            <label for="cb-per-voucher">عدد الفواتير في كل سند</label>
            <input type="number" id="cb-per-voucher" value="4" min="1" max="100" />
            <span class="hint tiny">مثلاً: كل 4 فواتير بسند واحد</span>
          </div>
          <div class="field" style="margin:0">
            <label for="cb-offset">تاريخ السند (بعد كم يوم)</label>
            <input type="number" id="cb-offset" value="4" min="0" max="365" />
            <span class="hint tiny">بعد آخر فاتورة في المجموعة</span>
          </div>
          <div class="field" style="margin:0">
            <label for="cb-start-no">بداية التسلسل (أول رقم)</label>
            <input type="text" id="cb-start-no" class="mono ltr" placeholder="مثال: 100 أو RV-00100" />
            <span id="cb-last-hint" class="hint tiny muted"></span>
          </div>
          <div class="field" style="margin:0">
            <label for="cb-pay-type">طريقة السداد</label>
            <select id="cb-pay-type">
              <option value="TRANSFER" selected>تحويل بنكي</option>
              <option value="CASH">نقدي</option>
              <option value="CARD">بطاقة</option>
              <option value="CHEQUE">شيك</option>
            </select>
          </div>
        </div>

        <div class="form-grid-3 mt" style="gap:10px;align-items:end">
          <div class="field" style="margin:0">
            <label for="cb-gap-min">الفارق بين السندات (من)</label>
            <input type="number" id="cb-gap-min" value="1" min="1" max="1000" />
          </div>
          <div class="field" style="margin:0">
            <label for="cb-gap-max">فارق إلى (عشوائي)</label>
            <div style="display:flex;gap:4px;align-items:center">
              <input type="number" id="cb-gap-max" placeholder="تلقائي ±1" min="1" max="1000" style="flex:1;min-width:0" />
              <button type="button" id="cb-reroll" class="btn btn-sm" style="white-space:nowrap" title="إعادة توزيع الفوارق العشوائية">↻ توزيع</button>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <label class="check" style="font-weight:700;font-size:12.5px;margin:0">
              <input type="checkbox" id="cb-jitter" checked />
              تنويع الفارق تلقائياً (±1 لكسر النمطية، مثل 19-21)
            </label>
            <label class="check" style="font-weight:700;font-size:12.5px;margin:0">
              <input type="checkbox" id="cb-skip-friday" checked />
              تخطي يوم الجمعة أبداً (ترحيل تلقائي للسبت)
            </label>
          </div>
        </div>

        <div class="form-grid-2 mt" style="gap:10px">
          <input type="search" id="cb-q" placeholder="بحث سريع في الفواتير أو العملاء…" />
          <input type="text" id="cb-notes" placeholder="ملاحظة إضافية (اختياري — الافتراضي: مقابل أجور وضريبة [المؤسسة] — فواتير رقم ...)" />
        </div>
      </div>

      <div id="cb-summary" class="mt"></div>
      <div id="cb-table-wrap" class="mt"></div>
      <div id="cb-result" class="mt" style="display:none"></div>
    `,
    footer: `<button class="btn" data-close type="button">إلغاء</button>
             <button class="btn btn-primary" data-create type="button" disabled>إنشاء سندات قبض الريال</button>`,
  });

  let eligibleData = null;
  let selectedIds = new Set();
  let randomGaps = [];
  let plannedGroups = [];
  let hasCollision = false;
  let lastLoadedIssuer = '';

  const issuerSel = $('#cb-issuer', m.body);
  const clientSel = $('#cb-client', m.body);
  const fromInp = $('#cb-from', m.body);
  const toInp = $('#cb-to', m.body);
  const qInp = $('#cb-q', m.body);
  const perVoucherInp = $('#cb-per-voucher', m.body);
  const offsetInp = $('#cb-offset', m.body);
  const skipFriCb = $('#cb-skip-friday', m.body);
  const jitterCb = $('#cb-jitter', m.body);
  const startNoInp = $('#cb-start-no', m.body);
  const lastHint = $('#cb-last-hint', m.body);
  const payTypeSel = $('#cb-pay-type', m.body);
  const gapMinInp = $('#cb-gap-min', m.body);
  const gapMaxInp = $('#cb-gap-max', m.body);
  const rerollBtn = $('#cb-reroll', m.body);
  const notesInp = $('#cb-notes', m.body);
  const summaryBox = $('#cb-summary', m.body);
  const tableWrap = $('#cb-table-wrap', m.body);
  const resultBox = $('#cb-result', m.body);
  const createBtn = m.el.querySelector('[data-create]');

  const getEffectiveGapRange = () => {
    const rawMin = Math.max(1, parseInt(gapMinInp.value, 10) || 1);
    const maxRaw = parseInt(gapMaxInp.value, 10);
    if (Number.isFinite(maxRaw) && maxRaw >= rawMin) {
      return { minG: rawMin, maxG: maxRaw };
    }
    if (jitterCb.checked && rawMin > 1) {
      return { minG: Math.max(1, rawMin - 1), maxG: rawMin + 1 };
    }
    return { minG: rawMin, maxG: rawMin };
  };

  const regenerateRandomGaps = (count) => {
    const { minG, maxG } = getEffectiveGapRange();
    randomGaps = [];
    for (let i = 0; i < Math.max(count, 200); i++) {
      randomGaps.push(maxG > minG ? minG + Math.floor(Math.random() * (maxG - minG + 1)) : minG);
    }
  };

  const addDaysAdjustFriday = (isoDate, offsetDays, skipFri) => {
    if (!isoDate) return { date: '', skipped: false };
    const [y, mo, d] = isoDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, mo - 1, d + offsetDays));
    let skipped = false;
    if (skipFri && dt.getUTCDay() === 5) {
      dt.setUTCDate(dt.getUTCDate() + 1);
      skipped = true;
    }
    return { date: dt.toISOString().slice(0, 10), skipped };
  };

  const parseSerial = (pattern, defPrefix, defStart) => {
    const p = String(pattern || '').trim();
    if (!p) return { prefix: defPrefix, startNo: defStart, pad: 5 };
    const match = p.match(/^(.*?)(\d+)$/);
    if (!match) return { prefix: p.replace(/-+$/, ''), startNo: defStart, pad: 5 };
    return {
      prefix: match[1].replace(/-+$/, ''),
      startNo: Math.max(1, parseInt(match[2], 10) || defStart),
      pad: Math.max(match[2].length, 1),
    };
  };

  const formatSerial = (prefix, num, pad) => {
    const s = String(num).padStart(pad, '0');
    return prefix ? `${prefix}-${s}` : s;
  };

  const renderPreview = () => {
    const items = eligibleData?.items || [];
    const existingSet = new Set(eligibleData?.existing_numbers || []);
    const perVoucher = Math.max(1, Math.min(100, parseInt(perVoucherInp.value, 10) || 4));
    const offset = Math.max(0, parseInt(offsetInp.value, 10) || 0);
    const skipFriday = skipFriCb.checked;
    const { minG, maxG } = getEffectiveGapRange();
    rerollBtn.style.display = maxG > minG ? 'inline-flex' : 'none';

    if (!issuerSel.value) {
      summaryBox.innerHTML = '';
      tableWrap.innerHTML = '<div class="alert alert-warn tiny">اختر المورد أولاً لعرض فواتير جميع العملاء.</div>';
      createBtn.disabled = true;
      createBtn.textContent = 'إنشاء سندات قبض الريال';
      plannedGroups = [];
      return;
    }

    if (!items.length) {
      summaryBox.innerHTML = '';
      tableWrap.innerHTML = '<div class="alert alert-warn tiny">لا توجد فواتير غير مسددة لهذا المورد وفق الفلاتر المحددة.</div>';
      createBtn.disabled = true;
      createBtn.textContent = 'إنشاء سندات قبض الريال';
      plannedGroups = [];
      return;
    }

    const selectedItems = items.filter((it) => selectedIds.has(it.id));
    // Group selected invoices by client_id in chronological order
    const byClient = new Map();
    for (const it of selectedItems) {
      if (!byClient.has(it.client_id)) byClient.set(it.client_id, []);
      byClient.get(it.client_id).push(it);
    }

    const groups = [];
    for (const [cid, list] of byClient.entries()) {
      list.sort((a, b) =>
        (a.issue_date || '').localeCompare(b.issue_date || '') ||
        (a.issue_time || '').localeCompare(b.issue_time || '') ||
        (a.sequence_no - b.sequence_no) ||
        (a.invoice_number || '').localeCompare(b.invoice_number || '')
      );
      for (let i = 0; i < list.length; i += perVoucher) {
        const chunk = list.slice(i, i + perVoucher);
        const lastInv = chunk[chunk.length - 1];
        const adj = addDaysAdjustFriday(lastInv.issue_date, offset, skipFriday);
        const totalAmount = chunk.reduce((s, x) => s + Number(x.remaining_amount || 0), 0);
        const invNums = chunk.map((x) => x.invoice_number);
        const customNote = notesInp.value.trim();
        const notes = customNote
          ? `${customNote} — فواتير رقم ${invNums.join('، ')}`
          : `مقابل أجور وضريبة ${lastInv.client_name} — فواتير رقم ${invNums.join('، ')}`;
        groups.push({
          client_id: cid,
          client_name: lastInv.client_name,
          client_code: lastInv.client_code,
          invoices: chunk,
          invoice_ids: chunk.map((x) => x.id),
          invoice_numbers: invNums,
          last_issue_date: lastInv.issue_date,
          last_issue_time: lastInv.issue_time || '',
          last_sequence_no: lastInv.sequence_no || 0,
          last_invoice_number: lastInv.invoice_number,
          voucher_date: adj.date,
          skipped_friday: adj.skipped,
          total_amount: totalAmount,
          notes,
          voucher_number: '',
          collision: false,
        });
      }
    }

    groups.sort((a, b) =>
      (a.voucher_date || '').localeCompare(b.voucher_date || '') ||
      (a.last_issue_date || '').localeCompare(b.last_issue_date || '') ||
      (a.last_issue_time || '').localeCompare(b.last_issue_time || '') ||
      (a.last_sequence_no - b.last_sequence_no) ||
      (a.last_invoice_number || '').localeCompare(b.last_invoice_number || '')
    );

    const defPat = parseSerial(eligibleData?.suggested_start || '', eligibleData?.voucher_prefix || 'RV', 1);
    const pat = parseSerial(startNoInp.value.trim(), defPat.prefix, defPat.startNo);
    let currNo = pat.startNo;
    hasCollision = false;
    const seenBatch = new Set();

    for (let i = 0; i < groups.length; i++) {
      if (i > 0) {
        const step = randomGaps[i - 1] ?? minG;
        currNo += step;
      }
      const vNum = formatSerial(pat.prefix, currNo, pat.pad);
      groups[i].voucher_number = vNum;
      const isDup = existingSet.has(vNum) || seenBatch.has(vNum);
      groups[i].collision = isDup;
      if (isDup) hasCollision = true;
      seenBatch.add(vNum);
    }

    plannedGroups = groups;
    const totalAmt = groups.reduce((s, g) => s + g.total_amount, 0);
    const clientsCount = new Set(groups.map((g) => g.client_id)).size;
    const skippedCount = groups.filter((g) => g.skipped_friday).length;

    summaryBox.innerHTML = `
      <div class="card" style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;background:var(--bg-soft)">
        <div class="tiny" style="display:flex;gap:14px;flex-wrap:wrap">
          <span>الفواتير المحددة: <b>${selectedItems.length}</b> من ${items.length}</span>
          <span>عدد السندات الناتجة: <b>${groups.length}</b></span>
          <span>العملاء: <b>${clientsCount}</b></span>
          <span>الإجمالي: <b class="mono ltr">${money(totalAmt)}</b></span>
          ${groups.length ? `<span>التسلسل: <b class="mono ltr">${esc(groups[0].voucher_number)} ← ${esc(groups[groups.length - 1].voucher_number)}</b></span>` : ''}
          ${skippedCount ? `<span class="badge amber">ترحيل ${skippedCount} جمعة للسبت</span>` : ''}
        </div>
        <div style="display:flex;gap:6px">
          <button type="button" class="btn btn-sm" id="cb-sel-all">تحديد الكل</button>
          <button type="button" class="btn btn-sm" id="cb-sel-none">إلغاء الكل</button>
        </div>
      </div>
      ${hasCollision ? `<div class="alert alert-danger tiny mt">يوجد تعارض في أحد أرقام السندات مع سندات مسجلة مسبقاً — يرجى تغيير رقم بداية التسلسل.</div>` : ''}
    `;

    $('#cb-sel-all', summaryBox)?.addEventListener('click', () => {
      items.forEach((it) => selectedIds.add(it.id));
      renderPreview();
    });
    $('#cb-sel-none', summaryBox)?.addEventListener('click', () => {
      selectedIds.clear();
      renderPreview();
    });

    tableWrap.innerHTML = `
      <div class="tiny muted" style="margin-bottom:4px;font-weight:700">معاينة السندات المجمّعة (${groups.length} سند):</div>
      <div class="table-wrap" style="max-height:220px;overflow-y:auto;margin-bottom:10px">
        <table class="tbl compact" style="font-size:12px">
          <thead><tr><th>رقم السند</th><th>العميل</th><th>الفواتير (${perVoucher}/سند)</th><th>تاريخ السند</th><th class="text-end">المبلغ</th><th>البيان</th></tr></thead>
          <tbody>
            ${groups.length ? groups.map((g) => `
              <tr class="${g.collision ? 'danger-row' : ''}">
                <td class="mono ltr" style="font-weight:700;${g.collision ? 'color:var(--danger)' : ''}">${esc(g.voucher_number)}</td>
                <td>${esc(g.client_name)}</td>
                <td class="mono ltr" style="font-size:11px">${esc(g.invoice_numbers.join('، '))}</td>
                <td class="mono ltr">${esc(g.voucher_date)}${g.skipped_friday ? ' <span class="badge amber" title="تم ترحيله من الجمعة للسبت">سبت</span>' : ''}</td>
                <td class="text-end mono ltr" style="font-weight:700">${money(g.total_amount)}</td>
                <td class="tiny">${esc(g.notes)}</td>
              </tr>
            `).join('') : `<tr><td colspan="6" class="text-center muted">حدّد فاتورة واحدة على الأقل من الجدول أدناه</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="tiny muted" style="margin-bottom:4px;font-weight:700">الفواتير المؤهلة (${items.length}):</div>
      <div class="table-wrap" style="max-height:170px;overflow-y:auto">
        <table class="tbl compact" style="font-size:12px">
          <thead><tr><th style="width:30px"></th><th>الفاتورة</th><th>التاريخ</th><th>العميل</th><th class="text-end">المتبقي</th></tr></thead>
          <tbody>
            ${items.map((it) => `
              <tr>
                <td><input type="checkbox" data-cb-inv="${esc(it.id)}" ${selectedIds.has(it.id) ? 'checked' : ''} /></td>
                <td class="mono ltr">${esc(it.invoice_number)}</td>
                <td class="mono ltr">${esc(it.issue_date)}</td>
                <td>${esc(it.client_name)}</td>
                <td class="text-end mono ltr">${money(it.remaining_amount)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    $$('[data-cb-inv]', tableWrap).forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedIds.add(cb.dataset.cbInv);
        else selectedIds.delete(cb.dataset.cbInv);
        renderPreview();
      });
    });

    createBtn.disabled = !groups.length || hasCollision;
    createBtn.textContent = groups.length ? `إنشاء ${groups.length} سند قبض ريال` : 'إنشاء سندات قبض الريال';
  };

  const loadEligible = async (resetStart) => {
    if (!issuerSel.value) {
      eligibleData = null;
      selectedIds.clear();
      renderPreview();
      return;
    }
    tableWrap.innerHTML = '<div class="muted tiny">جارٍ تحميل الفواتير المؤهلة…</div>';
    try {
      const qs = new URLSearchParams({
        issuer_id: issuerSel.value,
        client_id: clientSel.value,
        from: fromInp.value,
        to: toInp.value,
        q: qInp.value.trim(),
      });
      eligibleData = await api.get(`/api/vouchers/batch/eligible-invoices?${qs.toString()}`);
      selectedIds = new Set((eligibleData.items || []).map((x) => x.id));
      if (resetStart || lastLoadedIssuer !== issuerSel.value) {
        startNoInp.value = eligibleData.suggested_start || '';
        lastLoadedIssuer = issuerSel.value;
      }
      lastHint.textContent = eligibleData.suggested_start ? `المقترح: ${eligibleData.suggested_start}` : '';
      regenerateRandomGaps(eligibleData.items?.length || 100);
      renderPreview();
    } catch (err) {
      toastErr(err.message || 'تعذر تحميل الفواتير');
    }
  };

  issuerSel.addEventListener('change', () => loadEligible(true));
  clientSel.addEventListener('change', () => loadEligible(false));
  fromInp.addEventListener('change', () => loadEligible(false));
  toInp.addEventListener('change', () => loadEligible(false));
  qInp.addEventListener('input', debounce(() => loadEligible(false), 300));

  perVoucherInp.addEventListener('input', renderPreview);
  offsetInp.addEventListener('input', renderPreview);
  skipFriCb.addEventListener('change', renderPreview);
  notesInp.addEventListener('input', renderPreview);
  startNoInp.addEventListener('input', renderPreview);
  jitterCb.addEventListener('change', () => { regenerateRandomGaps(eligibleData?.items?.length || 100); renderPreview(); });
  gapMinInp.addEventListener('input', () => { regenerateRandomGaps(eligibleData?.items?.length || 100); renderPreview(); });
  gapMaxInp.addEventListener('input', () => { regenerateRandomGaps(eligibleData?.items?.length || 100); renderPreview(); });
  rerollBtn.addEventListener('click', () => { regenerateRandomGaps(eligibleData?.items?.length || 100); renderPreview(); });

  createBtn.addEventListener('click', async () => {
    if (!issuerSel.value || !plannedGroups.length || hasCollision) return;
    const perVoucher = Math.max(1, Math.min(100, parseInt(perVoucherInp.value, 10) || 4));
    const offset = Math.max(0, parseInt(offsetInp.value, 10) || 0);
    const { minG, maxG } = getEffectiveGapRange();
    const skipFriday = skipFriCb.checked;
    const totalAmt = plannedGroups.reduce((s, g) => s + g.total_amount, 0);
    const clientsCount = new Set(plannedGroups.map((g) => g.client_id)).size;
    const gapDesc = maxG > minG ? `عشوائي من ${minG} إلى ${maxG}` : `ثابت (+${minG})`;

    const ok = await confirmDialog({
      title: `تأكيد إنشاء ${plannedGroups.length} سند قبض ريال`,
      message: `المورد: ${eligibleData?.issuer_name || ''} | السندات: ${plannedGroups.length} سند لـ ${clientsCount} عميل | الإجمالي: ${money(totalAmt)} | التسلسل: ${plannedGroups[0].voucher_number} ← ${plannedGroups[plannedGroups.length - 1].voucher_number} (الفارق: ${gapDesc}) | التاريخ: بعد ${offset} يوم من آخر فاتورة${skipFriday ? ' مع تخطي يوم الجمعة' : ''}. هل تريد المتابعة؟`,
      okText: `نعم، إنشاء ${plannedGroups.length} سند`,
    });
    if (!ok) return;

    createBtn.disabled = true;
    createBtn.textContent = 'جارٍ إنشاء السندات…';
    try {
      const res = await api.post('/api/vouchers/batch', {
        issuer_id: issuerSel.value,
        payment_type: payTypeSel.value || 'TRANSFER',
        date_offset: offset,
        skip_friday: skipFriday,
        start_number: startNoInp.value.trim(),
        seq_gap_min: minG,
        seq_gap_max: maxG,
        invoices_per_voucher: perVoucher,
        notes: notesInp.value.trim(),
        groups: plannedGroups.map((g) => ({
          client_id: g.client_id,
          invoice_ids: g.invoice_ids,
          voucher_number: g.voucher_number,
          voucher_date: g.voucher_date,
          notes: g.notes,
        })),
      });

      toastOk(`تم إنشاء ${res.count} سند قبض ريال بنجاح (${res.first_number} ← ${res.last_number})`);
      syncNotify('vouchers', 'create', res);

      summaryBox.style.display = 'none';
      tableWrap.style.display = 'none';
      resultBox.style.display = 'block';
      const createdItems = res.items || [];
      resultBox.innerHTML = `
        <div class="card" style="border:2px solid var(--success, #10b981);padding:14px;border-radius:10px">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:10px">
            <div>
              <div style="font-weight:800;font-size:15px;color:var(--success, #10b981)">
                ✓ تم إنشاء ${res.count} سند قبض ريال بنجاح لـ ${res.client_count} عميل (${res.invoice_count} فاتورة)
              </div>
              <div class="tiny muted" style="margin-top:3px">
                التسلسل: <b class="mono ltr">${esc(res.first_number)} ← ${esc(res.last_number)}</b> ·
                الإجمالي: <b class="mono ltr">${money(res.total_amount)}</b>
                ${res.skipped_fridays > 0 ? ` · تم ترحيل ${res.skipped_fridays} يوم جمعة تلقائياً` : ''}
              </div>
            </div>
            <button type="button" class="btn btn-primary btn-sm" id="cb-print-all">
              ${icon.printer({ size: 15, style: 'vertical-align:text-bottom;margin-left:4px' })}طباعة كل السندات (${createdItems.length})
            </button>
          </div>
          <div class="table-wrap" style="max-height:280px;overflow-y:auto">
            <table class="tbl compact" style="font-size:12.5px">
              <thead><tr><th>رقم السند</th><th>العميل</th><th>تاريخ السند</th><th class="text-end">المبلغ</th><th>البيان</th></tr></thead>
              <tbody>
                ${createdItems.map((v) => `<tr>
                  <td class="mono ltr" style="font-weight:700">${esc(v.voucher_number)}</td>
                  <td>${esc(v.client_name)}</td>
                  <td class="mono ltr">${esc(v.voucher_date)}</td>
                  <td class="text-end mono ltr" style="font-weight:700">${money(v.total_amount)}</td>
                  <td class="tiny">${esc(v.notes || '')}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      $('#cb-print-all', resultBox)?.addEventListener('click', () => {
        printCashReceiptsBatch(createdItems.map((x) => x.id));
      });
      createBtn.style.display = 'none';
      const closeBtn = m.el.querySelector('[data-close]');
      if (closeBtn) closeBtn.textContent = 'إغلاق';
      onDone(res);
    } catch (err) {
      toastErr(err.message || 'تعذر إنشاء السندات');
      createBtn.disabled = false;
      createBtn.textContent = `إنشاء ${plannedGroups.length} سند قبض ريال`;
    }
  });

  if (initialIssuerId) {
    loadEligible(true);
  } else {
    renderPreview();
  }
}

