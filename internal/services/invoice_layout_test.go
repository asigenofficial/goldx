package services

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"goldx/internal/models"
)

// Exercise real browser measurements, including descriptions that wrap to many lines.
func TestInvoiceLayout(t *testing.T) {
	browser := FindAvailableBrowser()
	if browser == "" {
		t.Skip("Chromium is unavailable")
	}
	files, err := filepath.Glob(filepath.Join("..", "..", "data", "templates", "invoices", "*.html"))
	if err != nil || len(files) != 8 {
		t.Fatalf("expected eight invoice designs, got %d: %v", len(files), err)
	}
	rowHTML, _ := os.ReadFile(filepath.Join("..", "..", "data", "templates", "partials", "invoice-item-row.html"))
	cellHTML, _ := os.ReadFile(filepath.Join("..", "..", "data", "templates", "partials", "invoice-item-cell.html"))
	service := &TemplateService{itemRowHTML: string(rowHTML), itemCellHTML: string(cellHTML)}
	for _, file := range files {
		name := strings.TrimSuffix(filepath.Base(file), ".html")
		for _, mode := range []string{"PRICE_AND_WAGE", "PRICE_ONLY", "WAGE_ONLY"} {
			for _, count := range []int{0, 2, 15, 40, 75} {
				t.Run(fmt.Sprintf("%s/%s/%d", name, mode, count), func(t *testing.T) {
					template, err := os.ReadFile(filepath.Join("..", "..", "data", "templates", "invoices", name+".html"))
					if err != nil {
						t.Fatal(err)
					}
					var lines []InvoiceItemView
					for i := 1; i <= count; i++ {
						description := "خاتم ذهب"
						if count >= 40 && i%3 == 0 {
							description = strings.Repeat("وصف طويل للمصوغات الذهبية مع تفاصيل القطعة والوزن والعيار ", 5)
						}
						lines = append(lines, InvoiceItemView{InvoiceItem: models.InvoiceItem{ItemName: description, Karat: "21", Unit: "جرام", Quantity: 2.5, TaxRate: 15}, GramPriceMajor: 300, WageMajor: 20, UnitPriceMajor: 320, TaxableMajor: 800, TaxAmountMajor: 120, TotalLineMajor: 920})
					}
					rows := service.generateSmartRowsSlice(string(template), lines, 0)
					index := 0
					rows = regexp.MustCompile(`<tr\b`).ReplaceAllStringFunc(rows, func(string) string { index++; return fmt.Sprintf(`<tr data-test-line="%d"`, index) })
					html := strings.Replace(string(template), "{{items_rows}}", rows, 1)
					html = strings.ReplaceAll(html, "{{gold_invoice_type}}", mode)
					html = regexp.MustCompile(`\{\{[^}]+\}\}`).ReplaceAllString(html, "بيانات تجريبية")
					html = normalizeInvoiceMeasurements(html)
					copies := 1
					if count == 75 && name == "قالب_فاتورة_ذهب_سعر_وأجور" {
						service := &TemplateService{dataDir: filepath.Join("..", "..", "data")}
						html = service.CombineHTMLDocuments([]string{html, html})
						copies = 2
					}
					html = strings.Replace(html, "</body>", `<script>
document.addEventListener('DOMContentLoaded', async () => {
  await window.goldxInvoiceLayout.ready();
  const pages = Array.from(document.querySelectorAll('[data-invoice-page]'));
  const report = {pages:pages.length, rows:[], overflow:[], summaries:document.querySelectorAll('.bottom-content').length, maxRow:0, bottomGap:0, hidden:Array.from(pages[0].querySelectorAll('.items-main-table th')).filter(el => getComputedStyle(el).display==='none').length};
  for (const page of pages) {
    const box=page.getBoundingClientRect();
    for (const row of page.querySelectorAll('[data-test-line]')) { report.rows.push(Number(row.dataset.testLine)); report.maxRow=Math.max(report.maxRow,row.getBoundingClientRect().height); if (row.getBoundingClientRect().bottom > box.bottom+1) report.overflow.push(row.dataset.testLine); }
    const bottom=page.querySelector('.bottom-content');
    if(bottom) report.bottomGap=Math.max(report.bottomGap,Math.abs(page.querySelector('.invoice-page-label').getBoundingClientRect().top-bottom.getBoundingClientRect().bottom));
    for (const bottom of page.querySelectorAll('.bottom-content')) if (bottom.getBoundingClientRect().bottom > box.bottom+1) report.overflow.push('totals');
  }
  const pre=document.createElement('pre');pre.id='layout-report';pre.textContent=JSON.stringify(report);document.body.append(pre);
});
</script></body>`, 1)
					dir := t.TempDir()
					path := filepath.Join(dir, "invoice.html")
					if err := os.WriteFile(path, []byte(html), 0600); err != nil {
						t.Fatal(err)
					}
					cmd := exec.Command(browser, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--no-first-run", "--virtual-time-budget=3000", "--user-data-dir="+filepath.Join(dir, "profile"), "--dump-dom", path)
					output, err := cmd.Output()
					if err != nil {
						t.Fatal(err)
					}
					match := regexp.MustCompile(`<pre id="layout-report">([^<]+)</pre>`).FindSubmatch(output)
					if len(match) != 2 {
						t.Fatal("layout did not complete")
					}
					var report struct {
						Pages     int
						Rows      []int
						Overflow  []string
						Summaries int
						MaxRow    float64
						BottomGap float64
						Hidden    int
					}
					if err := json.Unmarshal(match[1], &report); err != nil {
						t.Fatal(err)
					}
					if len(report.Rows) != count*copies || len(report.Overflow) > 0 || report.Summaries != copies {
						t.Fatalf("invalid layout: %+v", report)
					}
					for i, n := range report.Rows {
						if n != i%count+1 {
							t.Fatalf("row order: %+v", report.Rows)
						}
					}
					if count >= 40 && report.Pages < 2 {
						t.Fatalf("expected continuation pages: %+v", report)
					}
					if (count == 0 || count == 2) && (report.MaxRow > 60 || report.BottomGap > 1) {
						t.Fatalf("short invoices must use compact rows and bottom-aligned totals: %+v", report)
					}
					wantHidden := 0
					if mode != "PRICE_AND_WAGE" {
						wantHidden = 1
					}
					if report.Hidden != wantHidden {
						t.Fatalf("incorrect columns for mode %s: %+v", mode, report)
					}
					t.Logf("%d rows: %d pages, no overflow", count, report.Pages)
				})
			}
		}
	}
}
