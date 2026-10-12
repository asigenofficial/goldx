
// Preserve natural row heights and paginate the same layout in preview and PDF.
(() => {
  if (window.goldxInvoiceLayout) return;
  const set = (el,key,value) => el.style.setProperty(key,value,'important');
  const itemSelector = '.items-main-table,table.items-table,.items-table-wrapper > table,.items-table-container > table';
  const bottomSelector = '.bottom-content,.bottom-content-wrap,.bottom-wrap,.bottom-grid,.bottom-summary-grid,.bottom-layout,.bottom-layout-table,.summary-section,.summary,.totals,.footer-zone';
  const itemTable = page => page.querySelector(itemSelector) || Array.from(page.querySelectorAll('table')).find(t => /الوزن|الكمية|quantity|qty/i.test(t.tHead?.textContent || '') && /سعر|السعر|price/i.test(t.tHead?.textContent || ''));
  function layout(page,table) {
    for (const [k,v] of Object.entries({display:'flex','flex-direction':'column','justify-content':'flex-start',width:'210mm',height:'297mm','min-height':'297mm','max-height':'297mm','box-sizing':'border-box',position:'relative',overflow:'visible',flex:'0 0 auto'})) set(page,k,v);
    let branch = table;
    while (branch && branch !== page) {
      set(branch,'flex','0 0 auto'); set(branch,'height','auto'); set(branch,'min-height','0'); set(branch,'max-height','none');
      const parent = branch.parentElement;
      if (!parent || /^(TABLE|TBODY|TR|TD|TH)$/.test(parent.tagName)) break;
      set(parent,'display','flex'); set(parent,'flex-direction','column'); set(parent,'justify-content','flex-start');
      branch = parent;
    }
    set(table,'table-layout','fixed');
    for (const cell of table.querySelectorAll('td,th')) { set(cell,'overflow-wrap','anywhere'); set(cell,'vertical-align','top'); }
    for (const row of Array.from(table.tBodies).flatMap(b => Array.from(b.rows))) set(row,'height','auto');
  }
  function paginate(source) {
    const table = itemTable(source);
    if (!table?.tBodies.length || source.dataset.invoiceLayout === 'paginated') return;
    const rows = Array.from(table.tBodies).flatMap(b => Array.from(b.rows));
    const symbol = source.querySelector('.sar-amount svg');
    if (symbol) {
      const moneyColumns = Array.from(table.tHead?.rows[0]?.cells || []).map(cell => /سعر|أجور|اجور|مصنعية|قبل الضريبة|قيمة الضريبة|شامل الضريبة|خصم|price|amount|charge/i.test(cell.textContent) && !/نسبة|rate/i.test(cell.textContent));
      for (const row of rows) Array.from(row.cells).forEach((cell,index) => {
        if (!moneyColumns[index] || cell.querySelector('.sar-amount') || !/^[\d,.\s-]+$/.test(cell.textContent)) return;
        const amount = document.createElement('span'); amount.className='sar-amount'; amount.dir='rtl';
        const number = document.createElement('bdi'); number.dir='ltr'; number.textContent=cell.textContent.trim();
        amount.append(number,symbol.cloneNode(true)); cell.replaceChildren(amount);
      });
    }
    const mode = source.dataset.goldInvoiceType;
    if (mode === 'PRICE_ONLY' || mode === 'WAGE_ONLY') {
      const hidden = Array.from(table.tHead?.rows[0]?.cells || []).findIndex(cell => mode === 'PRICE_ONLY' ? /أجور|اجور|مصنعية/.test(cell.textContent) : /سعر الجرام|سعر الذهب/.test(cell.textContent));
      if (hidden >= 0) for (const row of Array.from(table.rows)) if (row.cells[hidden]) set(row.cells[hidden],'display','none');
    }
    const blueprint = source.cloneNode(true);
    const parts = Array.from(source.querySelectorAll(bottomSelector)).filter(el => !el.contains(table) && !table.contains(el) && (table.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
    const paths = parts.filter(el => !parts.some(other => other !== el && other.contains(el))).map(el => {
      const path = []; for (let n=el;n!==source;n=n.parentElement) path.unshift(Array.from(n.parentElement.children).indexOf(n)); return path;
    });
    const pages = [];
    function createPage() {
      const page = blueprint.cloneNode(true);
      const finalParts = paths.map(path => path.reduce((n,i) => n.children[i],page));
      page.querySelectorAll('.invoice-page-label,script').forEach(el => el.remove());
      const grid = itemTable(page);
      Array.from(grid.tBodies).forEach(body => body.replaceChildren());
      finalParts.forEach(el => el.remove());
      const foot = grid.tFoot; if (foot) foot.remove();
      const label = document.createElement('div'); label.className='invoice-page-label';
      label.style.cssText='margin-top:auto;flex-shrink:0;text-align:center;font-size:11px;padding-top:3mm';
      page.append(label); page.dataset.invoicePage=String(pages.length+1); page.dataset.invoiceLayout='paginated';
      source.before(page); layout(page,grid);
      const state={page,grid,body:grid.tBodies[0],parts:finalParts,foot,label}; pages.push(state); return state;
    }
    function fits(state) {
      const box=state.page.getBoundingClientRect(), css=getComputedStyle(state.page);
      const limit=box.bottom-parseFloat(css.paddingBottom || 0)-parseFloat(css.borderBottomWidth || 0)-state.label.getBoundingClientRect().height+0.5;
      return [state.grid,...state.parts.filter(el => el.isConnected)].every(el => el.getBoundingClientRect().bottom<=limit);
    }
    function addSummary(state) {
      set(state.label,'margin-top',state.parts.length ? '0' : 'auto');
      state.parts.forEach((el,index) => { set(el,'flex-shrink','0'); set(el,'margin-top',index ? '12px' : 'auto'); if (!index) set(el,'padding-top','12px'); state.label.before(el); });
      if (state.foot) state.grid.append(state.foot);
    }
    let current=createPage();
    for (const row of rows) {
      current.body.append(row.cloneNode(true));
      if (!fits(current) && current.body.rows.length>1) {
        const last=current.body.lastElementChild; last.remove(); current=createPage(); current.body.append(last);
      }
      if (!fits(current)) {
        // A row taller than an entire sheet uses native flow instead of being clipped.
        set(current.page,'height','auto'); set(current.page,'max-height','none'); current.page.dataset.invoiceOversizedRow='true';
      }
    }
    addSummary(current);
    if (!fits(current) && current.page.dataset.invoiceOversizedRow!=='true') {
      current.parts.forEach(el => el.remove()); if (current.foot) current.foot.remove();
      const previous=current; current=createPage(); addSummary(current);
      while (previous.body.rows.length) {
        const row=previous.body.lastElementChild; current.body.prepend(row);
        if (!fits(current)) { previous.body.append(row); break; }
      }
      if (!previous.body.rows.length) { previous.page.remove(); pages.splice(pages.indexOf(previous),1); }
      if (!fits(current)) { set(current.page,'height','auto'); set(current.page,'max-height','none'); }
    }
    source.remove();
    pages.forEach((state,i) => {
      state.page.dataset.invoicePage=String(i+1);
      state.label.textContent=(i<pages.length-1 ? 'متابعة الفاتورة في الصفحة التالية' : 'الإجماليات النهائية')+` — صفحة ${i+1} من ${pages.length}`;
    });
  }
  function run() {
    document.querySelectorAll('.invoice-container,.invoice-frame,[data-invoice-page]').forEach(page => {
      if (!page.parentElement.closest('.invoice-container,.invoice-frame,[data-invoice-page]')) paginate(page);
    });
    document.documentElement.dataset.invoiceLayoutReady='true';
  }
  async function ready() {
    if (document.fonts) await document.fonts.ready;
    await Promise.all(Array.from(document.images).map(img => img.complete ? Promise.resolve() : new Promise(resolve => { img.addEventListener('load',resolve,{once:true}); img.addEventListener('error',resolve,{once:true}); })));
    run();
  }
  window.goldxInvoiceLayout={run,ready};
  const style=document.createElement('style');
  style.textContent=`@page {size:A4 portrait;margin:0} [data-invoice-page] {break-after:page;page-break-after:always;margin:0 auto 18px} [data-invoice-page]:last-of-type {break-after:auto;page-break-after:auto} [data-invoice-page] tr {break-inside:avoid;page-break-inside:avoid} @media print {html,body {margin:0!important;padding:0!important;height:auto!important;overflow:visible!important} [data-invoice-page] {margin:0!important;box-shadow:none!important}}`;
  document.head.append(style);
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',ready,{once:true}); else ready();
  window.addEventListener('beforeprint',run);
})();
