// ==========================================================================
//  محرر الفاتورة (إصدار فاتورة جديدة)
// ==========================================================================
import { api } from '../core/api.js';
import { store, loadClients, loadItems, can, invalidate } from '../core/store.js';
import * as router from '../core/router.js';

const syncNotify = (entity, action, payload) => (typeof store.syncNotify === 'function' ? store.syncNotify(entity, action, payload) : null);
import {
  html, raw, esc, money, toNum, today, nowTime, toastOk, toastErr,
  $, $$, delegate, modal, formValues, confirmDialog, icon, generateNextItemCode,
} from '../core/util.js';

const emptyLine = () => ({
  key: Math.random().toString(36).slice(2),
  item_id: '', item_code: '', item_name: '', unit: 'جرام',
  karat: '21',
  gram_price: 0,
  wage: 0,
  quantity: 1,
  unit_price: 0,
  discount: 0,
  tax_rate: 15,
});

function lineTotals(line, percent = 0) {
  const is24k = String(line.karat || '').trim() === '24';
  const effectiveTaxRate = is24k ? 0 : (line.tax_rate !== undefined ? line.tax_rate : 15);
  const gross = Math.round(line.quantity * line.unit_price * 100) / 100;
  const discount = line.discount || Math.round(gross * percent) / 100;
  const taxable = Math.max(0, Math.round((gross - discount) * 100) / 100);
  const tax = Math.round(taxable * (effectiveTaxRate / 100) * 100) / 100;
  return { gross, taxable, tax, total: Math.round((taxable + tax) * 100) / 100 };
}

const DRAFT_KEY = 'zs.invoice_draft';

function saveDraft(state) {
  if (!state || state.is_edit) return;
  try {
    const hasLines = state.lines && state.lines.some((l) => (l.item_name && l.item_name.trim()) || l.unit_price > 0 || l.gram_price > 0 || l.wage > 0);
    if (!state.client_id && !hasLines && !state.notes) {
      localStorage.removeItem(DRAFT_KEY);
      return;
    }
    const draft = {
      issuer_id: state.issuer_id,
      client_id: state.client_id,
      issue_date: state.issue_date,
      issue_time: can('invoices.backdate') ? state.issue_time : undefined,
      gold_invoice_type: state.gold_invoice_type || 'PRICE_AND_WAGE',
      invoice_type: state.invoice_type,
      payment_method: state.payment_method,
      invoice_number: state.invoice_number,
      notes: state.notes,
      cheque_no: state.cheque_no, cheque_date: state.cheque_date, due_date: state.due_date,
      auto_receipt: state.auto_receipt,
      auto_gold_receipt: state.auto_gold_receipt,
      receipt_gold_price: state.receipt_gold_price,
      print_after: state.print_after,
      header_discount_percent: state.header_discount_percent,
      lines: state.lines,
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch { /* ignore storage error */ }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.lines) && data.lines.length > 0) {
      return data;
    }
  } catch {}
  return null;
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

export async function render(view, ctx) {
  await Promise.all([loadClients(), loadItems()]);
  const query = (ctx && ctx.query) || {};
  const editId = query.edit || (ctx && ctx.params && ctx.params[0]) || null;
  let editInvoice = null;
  if (editId) {
    try {
      editInvoice = await api.get(`/api/invoices/${editId}`);
    } catch (err) {
      toastErr(`تعذر تحميل الفاتورة للتعديل: ${err.message || ''}`);
      router.go('invoices');
      return undefined;
    }
  }

  const draft = editInvoice ? null : loadDraft();
  const state = editInvoice ? {
    is_edit: true,
    edit_id: editInvoice.id,
    issuer_id: editInvoice.issuer_id,
    client_id: editInvoice.client_id,
    issue_date: editInvoice.issue_date,
    issue_time: editInvoice.issue_time || nowTime(),
    gold_invoice_type: editInvoice.gold_invoice_type || 'PRICE_AND_WAGE',
    invoice_type: editInvoice.invoice_type || 'STANDARD',
    payment_method: editInvoice.payment_method || 'CASH',
    invoice_number: editInvoice.invoice_number,
    notes: editInvoice.notes || '',
    cheque_no: editInvoice.cheque_no ?? '', cheque_date: editInvoice.cheque_date ?? '', due_date: editInvoice.due_date ?? '',
    auto_receipt: false,
    print_after: true,
    header_discount_percent: editInvoice.discount_percent || 0,
    zatca_phase: editInvoice.zatca_phase || 'PHASE1',
    lines: ((editInvoice.items || editInvoice.lines) && (editInvoice.items || editInvoice.lines).length)
      ? (editInvoice.items || editInvoice.lines).map((l) => ({
        key: Math.random().toString(36).slice(2),
        item_id: l.item_id || '',
        item_code: l.item_code || '',
        item_name: l.item_name || '',
        unit: l.unit || 'جرام',
        karat: l.karat || '21',
        gram_price: Number(l.gram_price) || 0,
        wage: Number(l.wage) || 0,
        quantity: Number(l.quantity) || 1,
        unit_price: Number(l.unit_price) || 0,
        discount: Number(l.discount) || 0,
        tax_rate: (l.karat === '24') ? 0 : (l.tax_rate !== undefined ? Number(l.tax_rate) : 15),
      }))
      : [emptyLine()],
  } : {
    is_edit: false,
    issuer_id: store.activeIssuerId,
    client_id: query.client_id || '',
    issue_date: today(),
    issue_time: nowTime(),
    gold_invoice_type: (draft && draft.gold_invoice_type) || 'PRICE_AND_WAGE',
    invoice_type: 'STANDARD',
    payment_method: 'CASH',
    invoice_number: '',
    notes: '',
    auto_receipt: false,
    print_after: true,
    header_discount_percent: 0,
    lines: [emptyLine()],
    ...(draft || {}),
  };
  let clientSearchQ = '';

  const filterClients = (q) => {
    const term = (q || '').trim().toLowerCase();
    if (!term) return store.clients;
    return store.clients.filter((c) => {
      const name = (c.name || '').toLowerCase();
      const code = (c.client_code || '').toLowerCase();
      const mob = (c.mobile || '').toLowerCase();
      const phone = (c.phone || '').toLowerCase();
      const tax = (c.tax_number || '').toLowerCase();
      const cr = (c.commercial_register || '').toLowerCase();
      return name.includes(term) || code.includes(term) || mob.includes(term) || phone.includes(term) || tax.includes(term) || cr.includes(term);
    });
  };

  if (!state.is_edit && draft) {
    if (state.client_id && !store.clients.some((c) => c.id === state.client_id)) {
      state.client_id = '';
    }
    if (Array.isArray(state.lines)) {
      state.lines.forEach((l) => {
        if (l.item_id && !store.items.some((it) => it.id === l.item_id)) {
          l.item_id = '';
        }
      });
    }
  }
  if (query.client_id && !state.is_edit) state.client_id = query.client_id;
  if (!state.lines || !state.lines.length) state.lines = [emptyLine()];

  const activeIssuers = store.issuers.filter((i) => i.is_active);
  if (!activeIssuers.length) {
    view.innerHTML = html`<div class="card"><div class="empty">
      <h3>لا يوجد متجر مصدر نشط</h3><p class="muted">أضف متجرًا مصدرًا أولاً لتتمكن من إصدار الفواتير.</p>
      <a class="btn btn-primary" href="#/issuers">إدارة المتاجر المصدرة</a></div></div>`;
    return undefined;
  }
  if (!state.issuer_id || !activeIssuers.some((i) => i.id === state.issuer_id)) state.issuer_id = activeIssuers[0].id;

  let issuerSearchQ = '';
  const filterIssuers = (q) => {
    const term = (q || '').trim().toLowerCase();
    if (!term) return activeIssuers;
    return activeIssuers.filter((i) => {
      const nameAr = (i.name_ar || '').toLowerCase();
      const nameEn = (i.name_en || '').toLowerCase();
      const tax = (i.tax_number || '').toLowerCase();
      const cr = (i.commercial_register || '').toLowerCase();
      return nameAr.includes(term) || nameEn.includes(term) || tax.includes(term) || cr.includes(term);
    });
  };

  const issuerOf = () => activeIssuers.find((i) => i.id === state.issuer_id) || activeIssuers[0];
  if (!state.zatca_phase) {
    state.zatca_phase = issuerOf().zatca_phase || 'PHASE1';
  }
  const defaultRate = () => Number(issuerOf().default_tax_rate ?? 15);
  if (state.lines[0].tax_rate === undefined) state.lines[0].tax_rate = defaultRate();

  const totals = () => {
    let subtotal = 0; let discount = 0; let taxable = 0; let tax = 0;
    for (const l of state.lines) {
      const t = lineTotals(l, state.header_discount_percent);
      subtotal += t.gross;
      discount += t.gross - t.taxable;
      taxable += t.taxable;
      tax += t.tax;
    }
    const round = (n) => Math.round(n * 100) / 100;
    return { subtotal: round(subtotal), discount: round(discount), taxable: round(taxable), tax: round(tax), grand: round(taxable + tax) };
  };

  const linesHtml = () => state.lines.map((l, i) => {
    if (!l.karat) l.karat = '21';
    const is24k = String(l.karat).trim() === '24';
    if (is24k) l.tax_rate = 0;
    else if (l.tax_rate === 0 || l.tax_rate === undefined) l.tax_rate = 15;

    const gp = Number(l.gram_price) || 0;
    const wg = Number(l.wage) || 0;
    if (state.gold_invoice_type === 'PRICE_ONLY') {
      l.unit_price = gp || l.unit_price || 0;
    } else if (state.gold_invoice_type === 'WAGE_ONLY') {
      l.unit_price = wg || l.unit_price || 0;
    } else {
      l.unit_price = (gp || wg) ? (gp + wg) : (l.unit_price || 0);
    }
    const t = lineTotals(l, state.header_discount_percent);

    const priceCols = state.gold_invoice_type === 'PRICE_AND_WAGE' ? `
      <td style="width:105px"><input type="number" data-f="gram_price" value="${l.gram_price ?? ''}" placeholder="0.00" step="0.01" min="0" title="سعر جرام الذهب" /></td>
      <td style="width:100px"><input type="number" data-f="wage" value="${l.wage ?? ''}" placeholder="0.00" step="0.01" min="0" title="أجور المصنعية للجرام" /></td>
      <td class="text-end num col-unit-price" style="width:105px;white-space:nowrap;font-weight:700;color:var(--primary);padding-inline:6px" title="إجمالي سعر الجرام">${money(l.unit_price)}</td>
    ` : state.gold_invoice_type === 'PRICE_ONLY' ? `
      <td style="width:120px"><input type="number" data-f="gram_price" value="${l.gram_price || l.unit_price || ''}" placeholder="0.00" step="0.01" min="0" title="سعر جرام الذهب" /></td>
    ` : `
      <td style="width:120px"><input type="number" data-f="wage" value="${l.wage || l.unit_price || ''}" placeholder="0.00" step="0.01" min="0" title="أجور المصنعية للجرام" /></td>
    `;

    return `<tr data-key="${l.key}">
      <td class="text-center tiny">${i + 1}</td>
      <td style="min-width:200px">
        <div class="rel">
          <input type="text" data-f="item_name" value="${esc(l.item_name)}" placeholder="اكتب اسم الصنف (خاتم، سوار، سبيكة…) أو ابحث…" autocomplete="off" />
        </div>
      </td>
      <td style="width:125px">
        <select data-f="karat" style="font-weight:700;font-size:12px;padding:4px 6px;">
          <option value="21" ${l.karat === '21' ? 'selected' : ''}>عيار 21 (15%)</option>
          <option value="18" ${l.karat === '18' ? 'selected' : ''}>عيار 18 (15%)</option>
          <option value="22" ${l.karat === '22' ? 'selected' : ''}>عيار 22 (15%)</option>
          <option value="24" ${l.karat === '24' ? 'selected' : ''}>عيار 24 (معفى 0%)</option>
        </select>
      </td>
      <td style="width:100px"><input type="number" data-f="quantity" value="${l.quantity}" step="0.001" min="0.001" placeholder="الوزن" title="الوزن بالجرام" /></td>
      ${priceCols}
      <td style="width:85px"><input type="number" data-f="discount" value="${l.discount || ''}" placeholder="0.00" step="0.01" min="0" /></td>
      <td class="text-center" style="width:85px">
        ${is24k
          ? '<span class="badge green" style="font-size:11px;font-weight:700">معفى 0%</span>'
          : '<span class="badge blue" style="font-size:11px;font-weight:700">15%</span>'}
      </td>
      <td class="text-end num col-taxable" style="width:100px;white-space:nowrap">${money(t.taxable)}</td>
      <td class="text-end num col-tax" style="width:90px;white-space:nowrap">${money(t.tax)}</td>
      <td class="text-end num col-total" style="width:105px;white-space:nowrap"><b>${money(t.total)}</b></td>
      <td class="actions" style="width:105px">
        <button class="btn btn-sm" data-act="dup" type="button" title="تكرار البند">${icon.copy({ size: 13, style: 'vertical-align:text-bottom;margin-left:2px' })}تكرار</button>
        <button class="btn btn-sm btn-danger" data-act="rm" type="button" title="حذف البند">${icon.trash({ size: 13, style: 'vertical-align:text-bottom;margin-left:2px' })}حذف</button>
      </td>
    </tr>`;
  }).join('');

  const totalsHtml = () => {
    const t = totals();
    const totalWeight = Math.round(state.lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0) * 1000) / 1000;
    return `
      <div class="line" style="color:#b8860b;font-weight:700"><span>إجمالي الوزن (جرام)</span><span class="num">${totalWeight} جرام</span></div>
      <div class="line"><span>الإجمالي قبل الخصم</span><span class="num">${money(t.subtotal)}</span></div>
      <div class="line"><span>الخصم</span><span class="num">${money(t.discount)}</span></div>
      <div class="line"><span>الإجمالي الخاضع للضريبة</span><span class="num">${money(t.taxable)}</span></div>
      <div class="line"><span>ضريبة القيمة المضافة</span><span class="num">${money(t.tax)}</span></div>
      <div class="line grand"><span>الإجمالي المستحق</span><span class="num">${money(t.grand)}</span></div>
      <div class="line tiny muted"><span>عدد البنود</span><span class="num">${state.lines.length}</span></div>`;
  };

  const draw = () => {
    const iss = issuerOf();
    const curClient = store.clients.find((c) => c.id === state.client_id);
    const displayedClients = filterClients(clientSearchQ);
    const displayedIssuers = filterIssuers(issuerSearchQ);
    view.innerHTML = html`
      <div class="page-head">
        <div class="titles">
          ${raw(state.is_edit ? `
            <h1>تعديل فاتورة الذهب <span class="mono">${esc(state.invoice_number)}</span></h1>
            <p>تعديل يدوي لبنود الفاتورة والأسعار والأجور والعميل مع إعادة احتساب الضرائب والهاش تلقائياً.</p>
          ` : `
            <h1>فاتورة ذهب جديدة</h1>
            <p>إصدار فاتورة بيع مصوغات وسبائك ذهب معتمدة لمتجر الذهب وفق متطلبات هيئة الزكاة والضريبة.${draft ? ' <span class="badge blue">تم استعادة المسودة تلقائياً</span>' : ''}</p>
          `)}
        </div>
        <div class="page-actions">
          ${raw(state.is_edit ? `
            <a class="btn" href="#/invoice-view/${esc(state.edit_id)}">إلغاء التعديل</a>
            <button class="btn btn-primary" id="save" type="button">${icon.check({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}حفظ التعديلات</button>
          ` : `
            <button class="btn" id="reset" type="button">${icon.refresh({ size: 15, style: 'vertical-align:text-bottom;margin-left:3px' })}تفريغ</button>
            <button class="btn btn-primary" id="save" type="button">${icon.check({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}حفظ وإصدار الفاتورة</button>
          `)}
        </div>
      </div>

      <!-- اختيار نمط / قالب فاتورة الذهب بأسلوب آبل فائق الأناقة -->
      <div class="card gold-mode-card" style="margin-bottom:1.2rem;background:rgba(255,253,245,0.9);backdrop-filter:blur(20px);border:1px solid rgba(212,175,55,0.35);padding:1rem 1.4rem;border-radius:18px;box-shadow:0 6px 24px rgba(212,175,55,0.08),inset 0 1px 0 rgba(255,255,255,0.95)">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="width:40px;height:40px;border-radius:12px;background:rgba(212,175,55,0.12);display:flex;align-items:center;justify-content:center;color:#b8860b;">
              ${raw(icon.sparkles({ size: 22 }))}
            </div>
            <div>
              <div style="font-weight:800;color:#78350f;font-size:15px">قالب فاتورة الذهب ونمط الحساب</div>
              <div class="muted tiny">اختر نوع الفاتورة: سعر ذهب وأجور مصنعية، أو سعر فقط، أو أجور مصنعية فقط</div>
            </div>
          </div>
          <div class="gold-type-tabs" role="group" aria-label="أجور الفاتورة" style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn btn-sm ${state.gold_invoice_type === 'PRICE_AND_WAGE' ? 'btn-primary' : ''}" data-gold-type="PRICE_AND_WAGE" aria-pressed="${state.gold_invoice_type === 'PRICE_AND_WAGE'}" style="border-radius:20px;padding:.45rem 1rem;">
              ${raw(icon.diamond({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' }))}بأجور
            </button>
            <button type="button" class="btn btn-sm ${state.gold_invoice_type === 'PRICE_ONLY' ? 'btn-primary' : ''}" data-gold-type="PRICE_ONLY" aria-pressed="${state.gold_invoice_type === 'PRICE_ONLY'}" style="border-radius:20px;padding:.45rem 1rem;">
              ${raw(icon.goldBar({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' }))}بدون أجور
            </button>
            <button type="button" class="btn btn-sm ${state.gold_invoice_type === 'WAGE_ONLY' ? 'btn-primary' : ''}" data-gold-type="WAGE_ONLY" aria-pressed="${state.gold_invoice_type === 'WAGE_ONLY'}" style="border-radius:20px;padding:.45rem 1rem;">
              ${raw(icon.stamp({ size: 14, style: 'vertical-align:text-bottom;margin-left:4px' }))}أجور فقط
            </button>
          </div>
        </div>
      </div>

      <div class="card inv-meta-card">
        <div class="inv-form-grid">
          <!-- بطاقة المنشأة المصدرة -->
          <div class="inv-form-box">
            <div class="inv-box-head">
              ${raw(icon.goldBar({ size: 17, style: 'color:var(--brand)' }))}
              <span>بيانات متجر الذهب</span>
            </div>
            <div class="field">
              <label style="margin:0;font-weight:700">المتجر المصدر</label>
                <select id="issuer" aria-label="المتجر المصدر" style="margin-top:4px">
                  ${raw(displayedIssuers.map((i) => `<option value="${esc(i.id)}" ${i.id === state.issuer_id ? 'selected' : ''}>${esc(i.name_ar)}</option>`).join(''))}
                </select>
              ${raw(can('issuers.view') ? '<a href="#/issuers" class="tiny">إدارة المتاجر المصدرة وإضافتها</a>' : '')}
              <span class="hint">رقم الفاتورة القادمة: <b class="mono" style="color:var(--primary)">${esc((iss.invoice_prefix || 'INV').replace(/[-\s]+$/, '').trim() || 'INV')}-${String(iss.invoice_next_no).padStart(iss.invoice_pad, '0')}</b></span>
            </div>
            <div class="inv-field-pair mt">
              <div class="field">
                <label>نوع الفاتورة</label>
                <select id="invoice_type">
                  <option value="STANDARD" ${raw(state.invoice_type === 'STANDARD' ? 'selected' : '')}>فاتورة ضريبية (B2B)</option>
                  <option value="SIMPLIFIED" ${raw(state.invoice_type === 'SIMPLIFIED' ? 'selected' : '')}>فاتورة مبسطة (B2C)</option>
                </select>
              </div>
              <div class="field">
                <label>طريقة الدفع</label>
                <select id="payment_method">
                  ${raw(Object.entries(store.meta.payment_methods).map(([k, v]) => `<option value="${esc(k)}" ${k === state.payment_method ? 'selected' : ''}>${esc(v)}</option>`).join(''))}
                </select>
              </div>
            </div>
          </div>

          <!-- بطاقة العميل والعنوان -->
          <div class="inv-form-box">
            <div class="inv-box-head">
              ${icon.users({ size: 16, style: 'color:var(--brand)' })}
              <span>بيانات العميل المستلم</span>
            </div>
            <div class="field">
              <div class="flex" style="align-items:center;justify-content:space-between;margin-bottom:4px">
                <label class="req" for="client" style="margin:0">العميل</label>
                <span class="tiny muted" id="client-search-hint" style="font-size:11px">
                  ${clientSearchQ ? `${displayedClients.length} مطابق` : ''}
                </span>
              </div>
              <div style="margin-bottom:6px">
                <input type="search" id="client-search" value="${esc(clientSearchQ)}" placeholder="بحث سريع في العملاء (اسم، كود، جوال، ضريبي)…" autocomplete="off" style="font-size:13px;padding:6px 9px;" />
              </div>
              <div class="flex" style="gap:.4rem">
                <select id="client" style="flex:1;min-width:0">
                  <option value="">— ${clientSearchQ ? `اختر من النتائج (${displayedClients.length})` : 'اختر العميل'} —</option>
                  ${raw(displayedClients.map((c) => `<option value="${esc(c.id)}" ${c.id === state.client_id ? 'selected' : ''}>${esc(c.name)} (${esc(c.client_code)})</option>`).join(''))}
                </select>
                ${raw(can('clients.write') ? `<button class="btn btn-sm" id="new-client" type="button" title="إضافة عميل جديد" style="flex-shrink:0">${icon.userPlus({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' })}عميل جديد</button>` : '')}
              </div>
            </div>
            <div id="client-addr-card" class="inv-addr-box${curClient ? '' : ' hidden'}">
              ${raw(curClient ? `
                <div class="inv-addr-content">
                  <span class="inv-addr-label">العنوان الوطني المعتمد:</span>
                  <span class="inv-addr-text">
                    ${[
                      curClient.city ? `المدينة: <b>${esc(curClient.city)}</b>` : '',
                      curClient.district ? `الحي: <b>${esc(curClient.district)}</b>` : '',
                      curClient.street ? `الشارع: <b>${esc(curClient.street)}</b>` : '',
                      curClient.building_no ? `مبنى: <b class="mono">${esc(curClient.building_no)}</b>` : '',
                      curClient.postal_code ? `الرمز: <b class="mono">${esc(curClient.postal_code)}</b>` : '',
                    ].filter(Boolean).join(' · ') || 'لم يُسجل عنوان وطني تفصيلي'}
                  </span>
                </div>
                ${can('clients.write') ? `<button class="btn btn-sm" id="edit-selected-client" type="button" style="padding:2px 8px;font-size:.74rem">تعديل</button>` : ''}
              ` : '')}
            </div>
          </div>

          <!-- بطاقة التوقيت وتفاصيل الفاتورة -->
          <div class="inv-form-box">
            <div class="inv-box-head">
              ${icon.calendar({ size: 16, style: 'color:var(--brand)' })}
              <span>التاريخ والإعدادات المالية</span>
            </div>
            <div class="inv-field-pair">
              <div class="field">
                <label>تاريخ الفاتورة</label>
                <input type="date" id="issue_date" value="${state.issue_date}" ${raw(can('invoices.backdate') ? '' : 'readonly title="لا تملك صلاحية تغيير التاريخ"')} />
              </div>
              <div class="field">
                <label>وقت الإصدار</label>
                <input type="time" id="issue_time" value="${state.issue_time}" step="1" ${raw(can('invoices.backdate') ? '' : 'readonly')} />
              </div>
            </div>
            <div class="inv-field-pair mt">
              <div class="field">
                <label>رقم فاتورة يدوي</label>
                <input type="text" id="invoice_number" value="${esc(state.invoice_number)}" class="ltr" placeholder="تلقائي (ZATCA)" />
              </div>
              <div class="field">
                <label>خصم عام على الفاتورة %</label>
                <input type="number" id="header_discount" value="${state.header_discount_percent}" min="0" max="100" step="0.01" placeholder="0.00" />
              </div>
            </div>
          </div>
        </div>

        <!-- خيارات إضافية (مختصرة واختيارية) -->
        <details class="advanced-options mt" style="background:rgba(0,0,0,0.02);padding:8px 12px;border-radius:6px;border:1px solid var(--line)">
          <summary class="advanced-options-head" style="cursor:pointer;font-weight:600;font-size:12px;color:var(--muted)">
            ${icon.settings({ size: 14, style: 'color:var(--brand);vertical-align:middle;margin-left:4px' })}
            خيارات إضافية: مرحلة ZATCA وتاريخ الاستحقاق (اختياري)
          </summary>
          <div class="inv-adv-grid mt" style="margin-top:10px">
            <div class="field">
              <label>مرحلة الفاتورة الإلكترونية (ZATCA Phase)</label>
              <select id="zatca_phase">
                <option value="PHASE1" ${raw(state.zatca_phase === 'PHASE1' ? 'selected' : '')}>المرحلة الأولى (5 حقول أساسية)</option>
                <option value="PHASE2" ${raw(state.zatca_phase === 'PHASE2' ? 'selected' : '')}>المرحلة الثانية (مشفّر وموقّع ZATCA)</option>
              </select>
              <span class="hint" id="phase-hint">${state.zatca_phase === 'PHASE2' ? 'يتضمن الهاش والتوقيع الرقمي وسلسلة الفواتير' : 'يتضمن الحقول الخمسة الأساسية'}</span>
            </div>
            <div class="field">
              <label for="due_date">تاريخ الاستحقاق (اختياري)</label>
              <input type="date" id="due_date" value="${esc(state.due_date || '')}" />
            </div>
            <div class="field" data-cheque>
              <label for="cheque_no">رقم الشيك</label>
              <input id="cheque_no" type="text" value="${esc(state.cheque_no || '')}" placeholder="رقم الشيك المصرفي" />
            </div>
            <div class="field" data-cheque>
              <label for="cheque_date">تاريخ الشيك</label>
              <input id="cheque_date" type="date" value="${esc(state.cheque_date || '')}" />
            </div>
          </div>
        </details>
      </div>

      <div class="card pad0">
        <div class="card-head">
          <div class="flex" style="gap:.5rem;align-items:center;">
            ${icon.goldBar({ size: 18, style: 'color:var(--brand)' })}
            <h3 style="margin:0">بنود ومصوغات الذهب</h3>
          </div>
          <div class="spacer"></div>
          <span class="tiny muted">اختر الصنف بالاسم مباشرة أو اكتب وصف القطعة والعيار والوزن بالجرام</span>
          <button class="btn btn-sm btn-primary" id="add-line" type="button">${icon.goldBar({ size: 14, style: 'vertical-align:text-bottom;margin-left:3px' })}إضافة صنف ذهب</button>
        </div>
        <div class="table-wrap">
          <table class="tbl compact" id="lines-tbl" style="min-width:1080px">
            <thead><tr>
              <th style="width:32px">#</th>
              <th style="min-width:200px">الصنف / الوصف</th>
              <th style="width:125px">العيار</th>
              <th style="width:100px">الوزن (جرام)</th>
              ${raw(state.gold_invoice_type === 'PRICE_AND_WAGE' ? `
                <th style="width:105px">سعر الجرام</th>
                <th style="width:100px">الأجور</th>
                <th style="width:105px">الإجمالي للجرام</th>
              ` : state.gold_invoice_type === 'PRICE_ONLY' ? `
                <th style="width:120px">سعر الجرام</th>
              ` : `
                <th style="width:120px">الأجور (المصنعية)</th>
              `)}
              <th style="width:85px">الخصم</th>
              <th class="text-center" style="width:85px">الضريبة</th>
              <th class="text-end" style="width:100px;white-space:nowrap">قبل الضريبة</th>
              <th class="text-end" style="width:90px;white-space:nowrap">الضريبة</th>
              <th class="text-end" style="width:105px;white-space:nowrap">الإجمالي</th>
              <th style="width:105px"></th>
            </tr></thead>
            <tbody id="lines">${raw(linesHtml())}</tbody>
          </table>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="flex" style="gap:.5rem;align-items:center;margin-bottom:.8rem">
            ${icon.fileText({ size: 16, style: 'color:var(--brand)' })}
            <h3 style="margin:0">ملاحظات وشروط الفاتورة</h3>
          </div>
          <div class="field"><label>ملاحظات تظهر في المطبوع</label>
            <textarea id="notes" style="min-height:70px" placeholder="مثال: البضاعة المباعة لا ترد ولا تستبدل بعد 3 أيام...">${esc(state.notes)}</textarea></div>
          <label class="check mt"><input type="checkbox" id="auto_receipt" ${raw(state.auto_receipt ? 'checked' : '')} />
            إنشاء سند قبض تلقائي بكامل المبلغ (للفواتير غير الآجلة)</label>
          ${raw(!state.is_edit && can('vouchers.create') ? `<div class="field mt"><label>سند قبض ذهب مع الفاتورة الجديدة</label><select id="auto_gold_receipt"><option value="">بدون سند ذهب</option><option value="METAL" ${state.auto_gold_receipt==='METAL'?'selected':''}>قبض معدن كسر بأوزان الفاتورة</option><option value="WAGES" ${state.auto_gold_receipt==='WAGES'?'selected':''}>قبض أجور بذهب عيار 24</option></select></div><div class="field ${state.auto_gold_receipt==='WAGES'?'':'hidden'}" id="receipt-gold-price-field"><label>سعر جرام عيار 24 في تاريخ الفاتورة (ريال سعودي)</label><input id="receipt_gold_price" type="number" min="0.01" step="0.01" value="${esc(state.receipt_gold_price||'')}" /></div>` : '')}
          <label class="check"><input type="checkbox" id="print_after" ${raw(state.print_after ? 'checked' : '')} />
            الانتقال لشاشة الفاتورة للتحميل والمشاركة بعد الحفظ</label>
        </div>
        <div class="card">
          <div class="flex" style="gap:.5rem;align-items:center;margin-bottom:.8rem">
            ${icon.calculator({ size: 16, style: 'color:var(--brand)' })}
            <h3 style="margin:0">ملخص الإجماليات</h3>
          </div>
          <div class="totals-box" id="totals">${raw(totalsHtml())}</div>
          <button class="btn btn-primary btn-block mt" id="save2" type="button">${icon.check({ size: 16, style: 'vertical-align:text-bottom;margin-left:4px' })}${state.is_edit ? 'حفظ التعديلات على الفاتورة' : 'حفظ وإصدار الفاتورة'}</button>
        </div>
      </div>`;

    for (const id of ['due_date', 'cheque_no', 'cheque_date']) {
      const inp = view.querySelector('#' + id);
      if (inp) inp.addEventListener('change', e => { state[id] = e.target.value; saveDraft(state); });
    }
    view.querySelectorAll('[data-cheque]').forEach(el => el.classList.toggle('hidden', state.payment_method !== 'CHEQUE'));
    bind();
  };

  const refreshLines = () => {
    $('#lines', view).innerHTML = linesHtml();
    $('#totals', view).innerHTML = totalsHtml();
    saveDraft(state);
  };
  const refreshTotals = () => {
    $('#totals', view).innerHTML = totalsHtml();
    saveDraft(state);
  };

  function applyItem(line, item) {
    line.item_id = item.id;
    line.item_code = item.item_code;
    line.item_name = item.name_ar;
    line.unit = item.unit || 'جرام';
    line.karat = item.karat || line.karat || '21';
    line.wage = Number(item.wage) || 0;
    if (String(line.karat).trim() === '24') {
      line.tax_rate = 0;
    } else {
      line.tax_rate = item.tax_rate !== undefined ? Number(item.tax_rate) : 15;
    }

    if (state.gold_invoice_type === 'PRICE_ONLY') {
      line.gram_price = Number(item.sale_price) || 0;
      line.wage = 0;
      line.unit_price = line.gram_price;
    } else if (state.gold_invoice_type === 'WAGE_ONLY') {
      line.gram_price = 0;
      line.wage = Number(item.wage) || Number(item.sale_price) || 0;
      line.unit_price = line.wage;
    } else {
      line.gram_price = Number(item.sale_price) || 0;
      line.wage = Number(item.wage) || 0;
      line.unit_price = line.gram_price + line.wage;
    }
    saveDraft(state);
  }

  function bind() {
    // تبديل قالب / نمط فاتورة الذهب (سعر وأجور، سعر فقط، أجور فقط)
    view.querySelectorAll('[data-gold-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.gold_invoice_type = btn.dataset.goldType;
        state.lines.forEach((l) => {
          const gp = Number(l.gram_price) || 0;
          const wg = Number(l.wage) || 0;
          if (state.gold_invoice_type === 'PRICE_ONLY') {
            l.unit_price = gp || l.unit_price || 0;
          } else if (state.gold_invoice_type === 'WAGE_ONLY') {
            l.unit_price = wg || l.unit_price || 0;
          } else {
            l.unit_price = (gp || wg) ? (gp + wg) : (l.unit_price || 0);
          }
        });
        saveDraft(state);
        draw();
      });
    });

    const curClient = store.clients.find(c => c.id === state.client_id);
    $('#issuer', view)?.addEventListener('change', (e) => {
      state.issuer_id = e.target.value;
      const newIss = activeIssuers.find((i) => i.id === state.issuer_id);
      if (newIss) state.zatca_phase = newIss.zatca_phase || 'PHASE1';
      saveDraft(state);
      draw();
    });

    const issuerSearchInput = $('#issuer-search', view);
    const issuerSelect = $('#issuer', view);
    const issuerHint = $('#issuer-search-hint', view);

    if (issuerSearchInput && issuerSelect) {
      issuerSearchInput.addEventListener('input', (e) => {
        issuerSearchQ = e.target.value;
        const matched = filterIssuers(issuerSearchQ);
        if (issuerHint) {
          issuerHint.textContent = issuerSearchQ.trim() ? `${matched.length} مطابق` : '';
        }
        issuerSelect.innerHTML = `<option value="">— ${issuerSearchQ.trim() ? `اختر من النتائج (${matched.length})` : 'اختر المتجر المصدر'} —</option>` +
          matched.map((i) => `<option value="${esc(i.id)}" ${i.id === state.issuer_id ? 'selected' : ''}>${esc(i.name_ar)}</option>`).join('');
      });

      issuerSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const matched = filterIssuers(issuerSearchQ);
          if (matched.length > 0) {
            state.issuer_id = matched[0].id;
            const newIss = activeIssuers.find((i) => i.id === state.issuer_id);
            if (newIss) state.zatca_phase = newIss.zatca_phase || 'PHASE1';
            saveDraft(state);
            draw();
          }
        }
      });
    }

    $('#client', view).addEventListener('change', (e) => { state.client_id = e.target.value; saveDraft(state); draw(); });

    const clientSearchInput = $('#client-search', view);
    const clientSelect = $('#client', view);
    const clientHint = $('#client-search-hint', view);

    if (clientSearchInput && clientSelect) {
      clientSearchInput.addEventListener('input', (e) => {
        clientSearchQ = e.target.value;
        const matched = filterClients(clientSearchQ);
        if (clientHint) {
          clientHint.textContent = clientSearchQ.trim() ? `${matched.length} مطابق` : '';
        }
        clientSelect.innerHTML = `<option value="">— ${clientSearchQ.trim() ? `اختر من النتائج (${matched.length})` : 'اختر العميل'} —</option>` +
          matched.map((c) => `<option value="${esc(c.id)}" ${c.id === state.client_id ? 'selected' : ''}>${esc(c.name)} (${esc(c.client_code)})</option>`).join('');
      });

      clientSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const matched = filterClients(clientSearchQ);
          if (matched.length > 0) {
            state.client_id = matched[0].id;
            saveDraft(state);
            draw();
          }
        }
      });
    }

    $('#invoice_type', view).addEventListener('change', (e) => { state.invoice_type = e.target.value; saveDraft(state); });
    $('#zatca_phase', view)?.addEventListener('change', (e) => {
      state.zatca_phase = e.target.value;
      saveDraft(state);
      const hint = $('#phase-hint', view);
      if (hint) {
        hint.textContent = state.zatca_phase === 'PHASE2' ? 'يتضمن الهاش والتوقيع الرقمي وسلسلة الفواتير' : 'يتضمن الحقول الخمسة الأساسية فقط';
      }
    });
    $('#issue_date', view).addEventListener('change', (e) => { state.issue_date = e.target.value; saveDraft(state); });
    $('#issue_time', view).addEventListener('change', (e) => { state.issue_time = e.target.value; saveDraft(state); });
    $('#payment_method', view).addEventListener('change', (e) => { state.payment_method = e.target.value; view.querySelectorAll('[data-cheque]').forEach(el => el.classList.toggle('hidden', state.payment_method !== 'CHEQUE')); saveDraft(state); });
    $('#due_date', view)?.addEventListener('change', (e) => { state.due_date = e.target.value; saveDraft(state); });
    $('#cheque_no', view)?.addEventListener('input', (e) => { state.cheque_no = e.target.value; saveDraft(state); });
    $('#cheque_date', view)?.addEventListener('change', (e) => { state.cheque_date = e.target.value; saveDraft(state); });
    $('#invoice_number', view).addEventListener('input', (e) => { state.invoice_number = e.target.value; saveDraft(state); });
    $('#header_discount', view).addEventListener('input', (e) => { state.header_discount_percent = toNum(e.target.value); refreshLines(); });
    $('#notes', view).addEventListener('input', (e) => { state.notes = e.target.value; saveDraft(state); });
    $('#auto_receipt', view).addEventListener('change', (e) => { state.auto_receipt = e.target.checked; saveDraft(state); });
    $('#auto_gold_receipt',view)?.addEventListener('change',e=>{state.auto_gold_receipt=e.target.value;saveDraft(state);draw()});
    $('#receipt_gold_price',view)?.addEventListener('input',e=>{state.receipt_gold_price=Number(e.target.value);saveDraft(state)});
    $('#print_after', view).addEventListener('change', (e) => { state.print_after = e.target.checked; saveDraft(state); });
    $('#add-line', view).addEventListener('click', () => {
      const l = emptyLine();
      l.tax_rate = defaultRate();
      l.item_code = generateNextItemCode(state.lines, store.items);
      state.lines.push(l);
      refreshLines();
      const inputs = $$('#lines tr [data-f=item_name]', view);
      if (inputs.length) inputs[inputs.length - 1].focus();
    });
    $('#reset', view)?.addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'تفريغ الفاتورة', message: 'سيتم مسح كل البنود والبيانات المدخلة.' })) return;
      clearDraft();
      state.lines = [emptyLine()];
      state.lines[0].tax_rate = defaultRate();
      state.notes = '';
      state.invoice_number = '';
      draw();
    });
    const newClientBtn = $('#new-client', view);
    if (newClientBtn) {
      newClientBtn.addEventListener('click', () => {
        const m = modal({
          title: 'عميل جديد (سريع)',
          slim: true,
          body: html`
            <div class="field"><label class="req">اسم العميل</label><input type="text" name="name" /></div>
            <div class="row mt">
              <div class="field"><label>الجوال</label><input type="text" name="mobile" class="ltr" /></div>
              <div class="field"><label>الرقم الضريبي</label><input type="text" name="tax_number" class="ltr" maxlength="15" /></div>
            </div>
            <div class="row mt">
              <div class="field"><label>المدينة</label><input type="text" name="city" placeholder="الرياض" /></div>
              <div class="field"><label>الحي</label><input type="text" name="district" placeholder="الملز" /></div>
              <div class="field"><label>الشارع</label><input type="text" name="street" placeholder="شارع صلاح الدين" /></div>
            </div>
            <div class="row mt">
              <div class="field" style="max-width:130px"><label>رقم المبنى</label><input type="text" name="building_no" class="ltr" placeholder="1234" /></div>
              <div class="field" style="max-width:150px"><label>الرمز البريدي</label><input type="text" name="postal_code" class="ltr" placeholder="12345" /></div>
              <div class="field"><label>العنوان الكامل</label><input type="text" name="address" placeholder="العنوان التفصيلي" /></div>
            </div>`,
          footer: `<button class="btn" data-close type="button">إلغاء</button>
                   <button class="btn btn-primary" data-ok type="button">إضافة</button>`,
        });
        m.el.querySelector('[data-ok]').addEventListener('click', async (e) => {
          const values = formValues(m.body);
          if (!values.name || !values.name.trim()) return toastErr('اسم العميل مطلوب');
          values.is_active = 1;
          e.target.disabled = true;
          try {
            const created = await api.post('/api/clients', values);
            invalidate('clients');
            await loadClients(true);
            state.client_id = created.id;
            m.close();
            toastOk('تمت إضافة العميل');
            draw();
          } catch { e.target.disabled = false; }
          return undefined;
        });
      });
    }

    const editClientBtn = $('#edit-selected-client', view);
    if (editClientBtn && curClient) {
      editClientBtn.addEventListener('click', () => {
        const m = modal({
          title: `تعديل العنوان الوطني: ${curClient.name}`,
          slim: true,
          body: html`
            <div class="field"><label class="req">اسم العميل</label><input type="text" name="name" value="${esc(curClient.name)}" /></div>
            <div class="row mt">
              <div class="field"><label>الجوال</label><input type="text" name="mobile" class="ltr" value="${esc(curClient.mobile || '')}" /></div>
              <div class="field"><label>الرقم الضريبي</label><input type="text" name="tax_number" class="ltr" maxlength="15" value="${esc(curClient.tax_number || '')}" /></div>
            </div>
            <div class="row mt">
              <div class="field"><label>المدينة</label><input type="text" name="city" value="${esc(curClient.city || '')}" placeholder="الرياض" /></div>
              <div class="field"><label>الحي</label><input type="text" name="district" value="${esc(curClient.district || '')}" placeholder="الملز" /></div>
              <div class="field"><label>الشارع</label><input type="text" name="street" value="${esc(curClient.street || '')}" placeholder="شارع صلاح الدين" /></div>
            </div>
            <div class="row mt">
              <div class="field" style="max-width:130px"><label>رقم المبنى</label><input type="text" name="building_no" class="ltr" value="${esc(curClient.building_no || '')}" placeholder="1234" /></div>
              <div class="field" style="max-width:150px"><label>الرمز البريدي</label><input type="text" name="postal_code" class="ltr" value="${esc(curClient.postal_code || '')}" placeholder="12345" /></div>
              <div class="field"><label>العنوان الكامل</label><input type="text" name="address" value="${esc(curClient.address || '')}" placeholder="العنوان التفصيلي" /></div>
            </div>`,
          footer: `<button class="btn" data-close type="button">إلغاء</button>
                   <button class="btn btn-primary" data-ok type="button">حفظ التعديلات</button>`,
        });
        m.el.querySelector('[data-ok]').addEventListener('click', async (e) => {
          const values = formValues(m.body);
          if (!values.name) return toastErr('اسم العميل مطلوب');
          e.target.disabled = true;
          try {
            await api.put(`/api/clients/${curClient.id}`, values);
            invalidate('clients');
            await loadClients(true);
            m.close();
            toastOk('تم تحديث العنوان الوطني للعميل');
            draw();
          } catch { e.target.disabled = false; }
          return undefined;
        });
      });
    }

    // تغيير العيار
    delegate($('#lines', view), 'change', 'select[data-f="karat"]', (e, sel) => {
      const key = sel.closest('tr').dataset.key;
      const line = state.lines.find((l) => l.key === key);
      if (!line) return;
      line.karat = sel.value;
      if (String(line.karat).trim() === '24') {
        line.tax_rate = 0;
      } else {
        line.tax_rate = 15;
      }
      refreshLines();
    });

    // تعديل حقول البنود
    delegate($('#lines', view), 'input', 'input[data-f]', (e, input) => {
      const key = input.closest('tr').dataset.key;
      const line = state.lines.find((l) => l.key === key);
      if (!line) return;
      const field = input.dataset.f;
      if (field === 'item_name') {
        line.item_name = input.value;
        line.item_id = line.item_id && input.value ? line.item_id : '';
        if (!line.item_code && line.item_name.trim()) {
          line.item_code = generateNextItemCode(state.lines, store.items);
        }
        showSuggestions(input, line);
        return;
      }
      if (field === 'item_code') {
        line.item_code = input.value;
        saveDraft(state);
        return;
      }
      if (field === 'unit') {
        line.unit = input.value;
      } else if (field === 'gram_price' || field === 'wage') {
        line[field] = toNum(input.value);
        const gp = Number(line.gram_price) || 0;
        const wg = Number(line.wage) || 0;
        if (state.gold_invoice_type === 'PRICE_ONLY') {
          line.unit_price = gp;
        } else if (state.gold_invoice_type === 'WAGE_ONLY') {
          line.unit_price = wg;
        } else {
          line.unit_price = gp + wg;
        }
        const tr = input.closest('tr');
        const cellUnitPrice = tr?.querySelector('.col-unit-price');
        if (cellUnitPrice) cellUnitPrice.textContent = money(line.unit_price);
      } else {
        line[field] = toNum(input.value);
      }

      // تحديث خلايا الإجماليات لهذا الصف فقط
      const t = lineTotals(line, state.header_discount_percent);
      const tr = input.closest('tr');
      const cellTaxable = tr.querySelector('.col-taxable');
      const cellTax = tr.querySelector('.col-tax');
      const cellTotal = tr.querySelector('.col-total');
      if (cellTaxable) cellTaxable.textContent = money(t.taxable);
      if (cellTax) cellTax.textContent = money(t.tax);
      if (cellTotal) cellTotal.innerHTML = `<b>${money(t.total)}</b>`;
      refreshTotals();
    });

    delegate($('#lines', view), 'click', '[data-act]', (e, btn) => {
      const key = btn.closest('tr').dataset.key;
      const idx = state.lines.findIndex((l) => l.key === key);
      if (idx < 0) return;
      if (btn.dataset.act === 'rm') {
        if (state.lines.length === 1) {
          state.lines = [emptyLine()];
          state.lines[0].tax_rate = defaultRate();
        } else state.lines.splice(idx, 1);
      } else if (btn.dataset.act === 'dup') {
        const dupLine = { ...state.lines[idx], key: Math.random().toString(36).slice(2) };
        if (!dupLine.item_id) {
          dupLine.item_code = generateNextItemCode(state.lines, store.items);
        }
        state.lines.splice(idx + 1, 0, dupLine);
      }
      refreshLines();
    });

    // اختصارات لوحة المفاتيح والتحكم الذكي بالأسهم و Enter
    delegate($('#lines', view), 'keydown', 'input', (e, input) => {
      const box = document.getElementById('global-item-search-popover');
      const isPopoverOpen = box && !box.classList.contains('hidden');

      if (input.dataset.f === 'item_name' && isPopoverOpen) {
        const items = [...box.querySelectorAll('.popover-item')];
        if (items.length) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            activePopoverIdx = (activePopoverIdx + 1) % items.length;
            items.forEach((it, i) => it.classList.toggle('sel', i === activePopoverIdx));
            items[activePopoverIdx]?.scrollIntoView({ block: 'nearest' });
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            activePopoverIdx = (activePopoverIdx - 1 + items.length) % items.length;
            items.forEach((it, i) => it.classList.toggle('sel', i === activePopoverIdx));
            items[activePopoverIdx]?.scrollIntoView({ block: 'nearest' });
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            const sel = items[activePopoverIdx] || items[0];
            if (sel) {
              const item = store.items.find((x) => x.id === sel.dataset.id);
              const key = input.closest('tr')?.dataset.key;
              const line = state.lines.find((l) => l.key === key);
              if (item && line) {
                applyItem(line, item);
                closePopover();
                refreshLines();
                setTimeout(() => {
                  const tr = view.querySelector(`tr[data-key="${key}"]`);
                  tr?.querySelector('input[data-f="quantity"]')?.focus();
                }, 40);
                return;
              }
            }
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            closePopover();
            return;
          }
        }
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        closePopover();
        $('#add-line', view).click();
      }
    });

    const onWindowReposition = () => {
      if (activeFloatingInput && document.body.contains(activeFloatingInput)) {
        const box = document.getElementById('global-item-search-popover');
        if (box && !box.classList.contains('hidden')) {
          positionPopover(activeFloatingInput, box);
        }
      } else {
        closePopover();
      }
    };

    const onGlobalClick = (e) => {
      const box = document.getElementById('global-item-search-popover');
      if (!box || box.classList.contains('hidden')) return;
      if (box.contains(e.target) || (activeFloatingInput && activeFloatingInput.contains(e.target))) return;
      closePopover();
    };

    window.addEventListener('scroll', onWindowReposition, { passive: true });
    window.addEventListener('resize', onWindowReposition, { passive: true });
    document.addEventListener('mousedown', onGlobalClick);

    $('#save', view).addEventListener('click', save);
    $('#save2', view).addEventListener('click', save);
  }

  let activeFloatingInput = null;
  let activeFloatingLine = null;
  let activePopoverIdx = -1;

  function getOrCreatePopover() {
    let box = document.getElementById('global-item-search-popover');
    if (!box) {
      box = document.createElement('div');
      box.id = 'global-item-search-popover';
      box.className = 'global-item-search-popover hidden';
      document.body.appendChild(box);
    }
    return box;
  }

  function closePopover() {
    const box = document.getElementById('global-item-search-popover');
    if (box) {
      box.classList.add('hidden');
      box.innerHTML = '';
    }
    activeFloatingInput = null;
    activeFloatingLine = null;
    activePopoverIdx = -1;
  }

  function positionPopover(input, box) {
    if (!input || !document.body.contains(input)) {
      closePopover();
      return;
    }
    const rect = input.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 440), window.innerWidth - 24);

    let left = rect.right - width;
    if (left < 12) left = 12;
    if (left + width > window.innerWidth - 12) {
      left = window.innerWidth - width - 12;
    }

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const popoverHeight = Math.min(360, box.offsetHeight || 300);

    let top;
    if (spaceBelow < 220 && spaceAbove > spaceBelow) {
      // فتح إلى الأعلى (Drop-up) في حال عدم وجود مساحة كافية بالأسفل
      top = Math.max(10, rect.top - popoverHeight - 6);
    } else {
      // فتح إلى الأسفل طافياً فوق أي عنصر خارج الجدول بدون قص
      top = rect.bottom + 6;
    }

    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
    box.style.width = `${Math.round(width)}px`;
  }

  function showSuggestions(input, line) {
    activeFloatingInput = input;
    activeFloatingLine = line;
    const box = getOrCreatePopover();
    const q = input.value.trim().toLowerCase();
    if (q.length < 1) {
      closePopover();
      return;
    }

    const matches = store.items.filter((it) => it.name_ar.toLowerCase().includes(q)
      || (it.name_en || '').toLowerCase().includes(q)
      || (it.item_code || '').toLowerCase().includes(q)
      || (it.barcode || '').includes(q)).slice(0, 10);

    if (!matches.length) {
      box.innerHTML = `
        <div class="popover-empty">
          <span>لا يوجد صنف مطابق لـ "<b>${esc(input.value)}</b>"</span>
          <small class="muted">يمكنك المتابعة واستخدام هذا الوصف كبند حر</small>
        </div>
      `;
      box.classList.remove('hidden');
      positionPopover(input, box);
      activePopoverIdx = -1;
      return;
    }

    activePopoverIdx = 0;

    box.innerHTML = `
      <div class="popover-head">
        <span class="popover-title">الأصناف المطابقة (${matches.length})</span>
        <span class="popover-hint">↑↓ للتنقل · Enter للاختيار</span>
      </div>
      <div class="popover-list">
        ${matches.map((it, idx) => `
          <div class="popover-item ${idx === 0 ? 'sel' : ''}" data-id="${esc(it.id)}" data-idx="${idx}">
            <div class="popover-item-main">
              <div class="popover-item-name">${esc(it.name_ar)}</div>
              ${it.name_en ? `<div class="popover-item-sub">${esc(it.name_en)}</div>` : ''}
            </div>
            <div class="popover-item-meta">
              <div class="popover-item-badges">
                <span class="badge mono gray tiny">${esc(it.item_code)}</span>
                ${it.barcode ? `<span class="badge mono blue tiny">${esc(it.barcode)}</span>` : ''}
              </div>
              <div class="popover-item-price">
                <strong>${money(it.sale_price)}</strong> <small class="muted">ر.س / ${esc(it.unit || 'حبة')}</small>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    box.classList.remove('hidden');
    positionPopover(input, box);

    box.querySelectorAll('.popover-item').forEach((el) => {
      el.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        const item = store.items.find((x) => x.id === el.dataset.id);
        if (item) {
          applyItem(line, item);
          closePopover();
          refreshLines();
          setTimeout(() => {
            const tr = view.querySelector(`tr[data-key="${line.key}"]`);
            tr?.querySelector('input[data-f="quantity"]')?.focus();
          }, 40);
        }
      });
      el.addEventListener('mouseenter', () => {
        box.querySelectorAll('.popover-item').forEach(x => x.classList.remove('sel'));
        el.classList.add('sel');
        activePopoverIdx = Number(el.dataset.idx);
      });
    });
  }

  async function save(e) {
    const btn = e.currentTarget;
    if (state.saving) return;
    if (!state.client_id) return toastErr('اختر العميل أولاً');
    if (state.payment_method === 'CHEQUE' && !state.cheque_no?.trim()) return toastErr('أدخل رقم الشيك');
    if (state.lines.some(l => !l.item_name.trim() || !Number.isFinite(l.quantity) || l.quantity <= 0 || l.unit_price < 0 || l.discount < 0 || l.tax_rate < 0 || l.tax_rate > 100)) return toastErr('راجع البنود: الاسم والكمية والسعر والضريبة مطلوبة بقيم صحيحة');
    const lines = state.lines
      .filter((l) => l.item_name.trim() && l.quantity > 0)
      .map((l) => {
        let gramPrice = Number(l.gram_price) || 0;
        let wage = Number(l.wage) || 0;
        let unitPrice = Number(l.unit_price) || 0;
        if (state.gold_invoice_type === 'PRICE_ONLY') {
          wage = 0;
          unitPrice = gramPrice || unitPrice;
        } else if (state.gold_invoice_type === 'WAGE_ONLY') {
          gramPrice = 0;
          unitPrice = wage || unitPrice;
        } else {
          unitPrice = (gramPrice || wage) ? (gramPrice + wage) : unitPrice;
        }
        const karat = String(l.karat || '21').trim();
        const taxRate = karat === '24' ? 0 : (l.tax_rate !== undefined ? Number(l.tax_rate) : 15);
        return {
          item_id: (l.item_id && store.items.some((it) => it.id === l.item_id)) ? l.item_id : null,
          item_code: (l.item_code && l.item_code.trim()) ? l.item_code.trim() : generateNextItemCode(state.lines, store.items),
          item_name: l.item_name.trim(),
          unit: l.unit || 'جرام',
          karat,
          gram_price: gramPrice,
          wage,
          quantity: Number(l.quantity) || 1,
          unit_price: unitPrice,
          discount: Number(l.discount) || 0,
          tax_rate: taxRate,
        };
      });
    if (!lines.length) return toastErr('أضف بنداً واحداً على الأقل مع اسم وكمية');

    state.saving = true;
    $$('#save, #save2', view).forEach(b => { b.disabled = true; });
    const dueDateVal = ($('#due_date', view)?.value ?? state.due_date ?? '').trim() || null;
    const chequeNoVal = ($('#cheque_no', view)?.value ?? state.cheque_no ?? '').trim();
    const chequeDateVal = ($('#cheque_date', view)?.value ?? state.cheque_date ?? '').trim() || null;
    try {
      if (state.is_edit) {
        const invoice = await api.put(`/api/invoices/${state.edit_id}`, {
          issuer_id: state.issuer_id,
          client_id: state.client_id,
          issue_date: state.issue_date,
          issue_time: can('invoices.backdate') ? state.issue_time : undefined,
          due_date: dueDateVal,
          cheque_date: chequeDateVal,
          cheque_no: chequeNoVal,
          gold_invoice_type: state.gold_invoice_type || 'PRICE_AND_WAGE',
          invoice_type: state.invoice_type,
          zatca_phase: state.zatca_phase,
          payment_method: state.payment_method,
          invoice_number: state.invoice_number || undefined,
          discount_percent: state.header_discount_percent || undefined,
          notes: state.notes,
          lines,
        });
        toastOk(`تم حفظ وتحديث الفاتورة ${invoice.invoice_number} بنجاح`);
        syncNotify('invoices', 'update', invoice);
        syncNotify('clients', 'update', invoice.client_id);
        syncNotify('issuers', 'update', invoice.issuer_id);
        router.go(`invoice-view/${invoice.id}`);
        return undefined;
      }

      if(state.auto_gold_receipt==='WAGES' && !(Number(state.receipt_gold_price)>0)) return toastErr('أدخل سعر جرام عيار 24 في تاريخ الفاتورة لسند الذهب');
      const invoice = await api.post('/api/invoices', {
        issuer_id: state.issuer_id,
        client_id: state.client_id,
        issue_date: state.issue_date,
        issue_time: can('invoices.backdate') ? state.issue_time : undefined,
        due_date: dueDateVal,
        cheque_date: chequeDateVal,
        cheque_no: chequeNoVal,
        gold_invoice_type: state.gold_invoice_type || 'PRICE_AND_WAGE',
        invoice_type: state.invoice_type,
        zatca_phase: state.zatca_phase,
        payment_method: state.payment_method,
        invoice_number: state.invoice_number || undefined,
        discount_percent: state.header_discount_percent || undefined,
        notes: state.notes,
        auto_receipt: state.auto_receipt,
        lines,
      });
      clearDraft();
      toastOk(`تم إصدار الفاتورة ${invoice.invoice_number} بمبلغ ${money(invoice.grand_total)}`);
      if(state.auto_gold_receipt){
        try{await api.post('/api/vouchers/gold',{invoice_id:invoice.id,kind:state.auto_gold_receipt,gold_price:Number(state.receipt_gold_price||0)});syncNotify('vouchers','create');toastOk('تم إنشاء سند قبض الذهب للفاتورة')}
        catch(error){toastErr(`الفاتورة محفوظة، لكن تعذر إنشاء سند الذهب: ${error.message||''}`);router.go(`invoice-view/${invoice.id}`);return}
      }
      syncNotify('invoices', 'create', invoice);
      syncNotify('clients', 'update', invoice.client_id);
      syncNotify('issuers', 'update', invoice.issuer_id);
      if (state.auto_receipt) syncNotify('vouchers', 'create');
      if (state.print_after) {
        router.go(`invoice-view/${invoice.id}`);
      } else {
        state.lines = [emptyLine()];
        state.lines[0].tax_rate = defaultRate();
        state.invoice_number = '';
        state.notes = '';
        draw();
      }
    } catch {
      btn.disabled = false;
    } finally {
      state.saving = false;
      $$('#save, #save2', view).forEach(b => { b.disabled = false; });
    }
    return undefined;
  }

  draw();
  return undefined;
}


