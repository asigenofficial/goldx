const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/bulk.js', 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function calcLine'), source.indexOf('export async function render')), context);
for (const [mode, price] of [['PRICE_ONLY', 300], ['WAGE_ONLY', 20], ['PRICE_AND_WAGE', 320]]) {
  for (const karat of ['18', '21', '22', '24']) {
    const invoice = context.recalcInvoice({gold_invoice_type: mode, lines: [{karat, quantity: 2.5, gram_price: 300, wage: 20}]});
    assert.equal(invoice.taxable_amount, price * 2.5);
    assert.equal(invoice.tax_amount, karat === '24' ? 0 : price * 2.5 * .15);
    assert.equal(invoice.lines[0].unit, 'جرام');
  }
}
console.log('Bulk gold: all 12 mode/karat combinations passed');
const util = fs.readFileSync(__dirname + '/../core/util.js', 'utf8');
vm.runInContext(util.slice(util.indexOf('export function esc'), util.indexOf('class Raw')).replace('export ', ''), context);
vm.runInContext(util.slice(util.indexOf('function detectColumnTypeJS'), util.indexOf('function ensureItemsRowsInTbodyJS')), context);
const html = '<table><thead><tr><th>اسم الصنف</th><th>العيار</th><th>الوزن (جرام)</th><th>سعر الجرام</th><th>الأجور</th><th>نسبة الضريبة</th><th>شامل الضريبة</th></tr></thead><tbody>{{items_rows}}</tbody></table>';
const rows = context.generateSmartRowsJS(html, [{item_name:'سبيكة', unit:'جرام', karat:'24', quantity:2, gram_price:300, wage:20, unit_price:320}]);
assert(rows.includes('24') && rows.includes('300.00') && rows.includes('20.00') && rows.includes('0% (معفى)') && rows.includes('640.00'));
assert(!rows.includes('(جرام)'));
console.log('Gold template preview: karat, gram price, wages and 24K exemption passed');
