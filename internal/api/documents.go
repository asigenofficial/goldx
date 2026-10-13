package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"goldx/internal/models"
	"html"
	"net/http"
	"net/url"
	"strings"
	"time"

	"goldx/internal/db"
	"goldx/internal/services"
)

// PDF bytes are a replaceable rendering of the current document, not its accounting record.
// A revision check prevents a slow renderer from overwriting a newer edit.
func (s *Server) dirtyDocument(kind, id, issuerID string) error {
	_, err := s.db.Exec(`INSERT INTO document_pdfs(kind, document_id, issuer_id, updated_at)
		VALUES(?,?,?,?) ON CONFLICT(kind, document_id) DO UPDATE SET
		issuer_id=excluded.issuer_id, revision=revision+1, pdf=NULL,
		status='PENDING', error='', updated_at=excluded.updated_at`, kind, id, issuerID, db.NowIso())
	if err == nil {
		s.wakePDFWorker()
	}
	return err
}

func (s *Server) dirtyIssuerDocuments(issuerID string) error {
	for _, item := range []struct{ kind, table string }{{"invoice", "invoices"}, {"voucher", "receipt_vouchers"}} {
		query := fmt.Sprintf(`INSERT INTO document_pdfs(kind,document_id,issuer_id,updated_at)
			SELECT ?,id,issuer_id,? FROM %s WHERE issuer_id=?
			ON CONFLICT(kind,document_id) DO UPDATE SET revision=revision+1,pdf=NULL,
			status='PENDING',error='',updated_at=excluded.updated_at`, item.table)
		if _, err := s.db.Exec(query, item.kind, db.NowIso(), issuerID); err != nil {
			return err
		}
	}
	s.wakePDFWorker()
	return nil
}

func (s *Server) enqueueMissingPDFs() {
	for _, item := range []struct{ kind, table string }{{"invoice", "invoices"}, {"voucher", "receipt_vouchers"}} {
		query := fmt.Sprintf(`INSERT OR IGNORE INTO document_pdfs(kind,document_id,issuer_id,updated_at)
			SELECT ?,id,issuer_id,? FROM %s`, item.table)
		_, _ = s.db.Exec(query, item.kind, db.NowIso())
	}
}

func (s *Server) dirtyAllCachedDocuments() {
	_, _ = s.db.Exec(`UPDATE document_pdfs SET revision=revision+1,pdf=NULL,status='PENDING',
		error='',updated_at=?`, db.NowIso())
	s.wakePDFWorker()
}

func (s *Server) dirtyBatchDocuments(batchID string) {
	_, _ = s.db.Exec(`INSERT INTO document_pdfs(kind,document_id,issuer_id,updated_at)
		SELECT 'invoice',id,issuer_id,? FROM invoices WHERE batch_id=?
		ON CONFLICT(kind,document_id) DO UPDATE SET revision=revision+1,pdf=NULL,
		status='PENDING',error='',updated_at=excluded.updated_at`, db.NowIso(), batchID)
	_, _ = s.db.Exec(`INSERT INTO document_pdfs(kind,document_id,issuer_id,updated_at)
		SELECT DISTINCT 'voucher',v.id,v.issuer_id,? FROM receipt_vouchers v
		JOIN voucher_allocations a ON a.voucher_id=v.id JOIN invoices i ON i.id=a.invoice_id
		WHERE i.batch_id=? ON CONFLICT(kind,document_id) DO UPDATE SET revision=revision+1,pdf=NULL,
		status='PENDING',error='',updated_at=excluded.updated_at`, db.NowIso(), batchID)
	s.wakePDFWorker()
}

func (s *Server) dirtyInvoiceReceipts(invoiceID string) {
	_, _ = s.db.Exec(`INSERT INTO document_pdfs(kind,document_id,issuer_id,updated_at)
		SELECT DISTINCT 'voucher',v.id,v.issuer_id,? FROM receipt_vouchers v
		JOIN voucher_allocations a ON a.voucher_id=v.id WHERE a.invoice_id=?
		ON CONFLICT(kind,document_id) DO UPDATE SET revision=revision+1,pdf=NULL,
		status='PENDING',error='',updated_at=excluded.updated_at`, db.NowIso(), invoiceID)
	s.wakePDFWorker()
}

func (s *Server) dirtyAllocatedInvoices(voucherID string) {
	_, _ = s.db.Exec(`INSERT INTO document_pdfs(kind,document_id,issuer_id,updated_at)
		SELECT 'invoice',i.id,i.issuer_id,? FROM invoices i
		JOIN voucher_allocations a ON a.invoice_id=i.id WHERE a.voucher_id=?
		ON CONFLICT(kind,document_id) DO UPDATE SET revision=revision+1,pdf=NULL,
		status='PENDING',error='',updated_at=excluded.updated_at`, db.NowIso(), voucherID)
	s.wakePDFWorker()
}

func (s *Server) allocatedInvoiceIDs(voucherID string) []string {
	rows, err := s.db.Query("SELECT DISTINCT invoice_id FROM voucher_allocations WHERE voucher_id=?", voucherID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	return ids
}

func (s *Server) dirtyInvoicesByID(ids []string) {
	for _, id := range ids {
		var issuerID string
		if s.db.QueryRow("SELECT issuer_id FROM invoices WHERE id=?", id).Scan(&issuerID) == nil {
			_ = s.dirtyDocument("invoice", id, issuerID)
		}
	}
}

func (s *Server) deleteDocumentPDF(kind, id string) {
	_, _ = s.db.Exec("DELETE FROM document_pdfs WHERE kind=? AND document_id=?", kind, id)
}

func (s *Server) pdfStatus(w http.ResponseWriter, kind, id string) {
	var status, renderErr string
	var revision, rendered int64
	err := s.db.QueryRow(`SELECT status,error,revision,rendered_revision FROM document_pdfs
		WHERE kind=? AND document_id=?`, kind, id).Scan(&status, &renderErr, &revision, &rendered)
	if errors.Is(err, sql.ErrNoRows) {
		s.json(w, 200, map[string]any{"status": "PENDING", "revision": 0})
		return
	}
	if err != nil {
		s.err(w, 500, err.Error())
		return
	}
	if status == "FAILED" {
		// Automatically recover from temporary failures by transitioning back to PENDING and waking worker
		_, _ = s.db.Exec(`UPDATE document_pdfs SET status='PENDING',error='',updated_at=?
			WHERE kind=? AND document_id=?`, db.NowIso(), kind, id)
		s.wakePDFWorker()
		status = "PENDING"
	}
	s.json(w, 200, map[string]any{"status": status, "error": renderErr,
		"revision": revision, "rendered_revision": rendered})
}

func (s *Server) wakePDFWorker() {
	select {
	case s.pdfWake <- struct{}{}:
	default:
	}
}

func (s *Server) startPDFWorker() {
	go func() {
		// Re-queue any previously failed PDFs on startup so they re-render cleanly
		_, _ = s.db.Exec("UPDATE document_pdfs SET status='PENDING' WHERE status='FAILED'")
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			s.processPendingPDFs()
			select {
			case <-s.pdfWake:
			case <-ticker.C:
			}
		}
	}()
}

func (s *Server) processPendingPDFs() {
	for {
		var kind, id string
		var revision int64
		err := s.db.QueryRow(`SELECT kind,document_id,revision FROM document_pdfs
			WHERE status='PENDING' ORDER BY updated_at LIMIT 1`).Scan(&kind, &id, &revision)
		if err != nil {
			return
		}
		_, _ = s.renderAndSavePDF(kind, id, revision, "")
	}
}

func (s *Server) pdfStyle(kind, id, override string) string {
	table := "invoices"
	key := "template_style"
	if kind == "voucher" {
		table, key = "receipt_vouchers", "voucher_template_style"
	}
	style := override
	if style == "" {
		var settings string
		if s.db.QueryRow("SELECT issuer.print_settings FROM "+table+" doc JOIN issuers issuer ON issuer.id=doc.issuer_id WHERE doc.id=?", id).Scan(&settings) == nil {
			var cfg map[string]any
			_ = json.Unmarshal([]byte(settings), &cfg)
			style, _ = cfg[key].(string)
		}
	}
	if style != "" && style != "default" && style != "standard" {
		if s.templates == nil {
			return style
		}
		if _, err := s.templates.GetFilePath(style); err == nil {
			return style
		}
	}
	if s.templates == nil {
		return style
	}
	category := "invoices"
	if kind == "voucher" {
		category = "documents"
	}
	if selected, err := s.templates.FirstTemplateID(category); err == nil {
		return selected
	}
	return style
}

func (s *Server) currentPDF(kind, id string, styleOverride ...string) ([]byte, error) {
	requestedStyle := ""
	if len(styleOverride) > 0 {
		requestedStyle = styleOverride[0]
	}
	expectedStyle := s.pdfStyle(kind, id, requestedStyle)
	var revision, rendered int64
	var pdf []byte
	var storedStyle string
	err := s.db.QueryRow(`SELECT revision,rendered_revision,pdf,style FROM document_pdfs
		WHERE kind=? AND document_id=?`, kind, id).Scan(&revision, &rendered, &pdf, &storedStyle)
	if errors.Is(err, sql.ErrNoRows) {
		var issuerID string
		table := "invoices"
		if kind == "voucher" {
			table = "receipt_vouchers"
		}
		if err = s.db.QueryRow("SELECT issuer_id FROM "+table+" WHERE id=?", id).Scan(&issuerID); err != nil {
			return nil, err
		}
		if err = s.dirtyDocument(kind, id, issuerID); err != nil {
			return nil, err
		}
		return s.currentPDF(kind, id, requestedStyle)
	}
	if err != nil {
		return nil, err
	}
	if rendered == revision && len(pdf) > 0 && storedStyle == documentPDFStyleKey(kind, expectedStyle) {
		return pdf, nil
	}
	if rendered == revision && storedStyle != documentPDFStyleKey(kind, expectedStyle) {
		var issuerID string
		_ = s.db.QueryRow("SELECT issuer_id FROM document_pdfs WHERE kind=? AND document_id=?", kind, id).Scan(&issuerID)
		if err := s.dirtyDocument(kind, id, issuerID); err != nil {
			return nil, err
		}
		return s.currentPDF(kind, id, requestedStyle)
	}
	return s.renderAndSavePDF(kind, id, revision, "", expectedStyle)
}

func (s *Server) renderAndSavePDF(kind, id string, revision int64, suppliedHTML string, styleOverride ...string) ([]byte, error) {
	style := ""
	if len(styleOverride) > 0 {
		style = styleOverride[0]
	}
	style = s.pdfStyle(kind, id, style)
	htmlDoc := suppliedHTML
	var err error
	if strings.TrimSpace(htmlDoc) == "" {
		if kind == "invoice" {
			var inv *services.InvoiceView
			inv, err = s.invoices.GetInvoice(id)
			if err == nil {
				htmlDoc, err = s.templates.RenderInvoiceHTML(inv, style)
			}
		} else {
			htmlDoc, err = s.renderVoucherHTML(id, style)
		}
	}
	if err != nil {
		s.failPDF(kind, id, revision, err)
		return nil, err
	}
	pdf, err := services.RenderHTMLToPDF(htmlDoc)
	if err != nil {
		s.failPDF(kind, id, revision, err)
		return nil, err
	}
	result, err := s.db.Exec(`UPDATE document_pdfs SET pdf=?,rendered_revision=?,style=?,status='READY',error='',updated_at=?
		WHERE kind=? AND document_id=? AND revision=?`, pdf, revision, documentPDFStyleKey(kind, style), db.NowIso(), kind, id, revision)
	if err != nil {
		return nil, err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return s.currentPDF(kind, id, style)
	}
	return pdf, nil
}

func (s *Server) failPDF(kind, id string, revision int64, renderErr error) {
	_, _ = s.db.Exec(`UPDATE document_pdfs SET status='FAILED',error=?,updated_at=?
		WHERE kind=? AND document_id=? AND revision=?`, renderErr.Error(), db.NowIso(), kind, id, revision)
}

// Invalidate cached PDFs when their rendering rules change.
func documentPDFStyleKey(kind, style string) string {
	if kind == "voucher" {
		return style + "|amount-grouping-v1|receipt-svg-v2"
	}
	if kind == "invoice" {
		return style + "|invoice-table-fill-v7"
	}
	return style
}

func formatVoucherAmount(amount float64) string {
	parts := strings.SplitN(fmt.Sprintf("%.2f", amount), ".", 2)
	whole := parts[0]
	sign := ""
	if strings.HasPrefix(whole, "-") {
		sign, whole = "-", whole[1:]
	}
	for i := len(whole) - 3; i > 0; i -= 3 {
		whole = whole[:i] + "," + whole[i:]
	}
	return sign + whole + "." + parts[1]
}

func (s *Server) renderVoucherHTML(id, style string) (string, error) {
	v, err := s.vouchers.GetVoucher(id)
	if err != nil {
		return "", err
	}
	issuer, err := s.issuers.GetIssuer(v.IssuerID)
	if err != nil {
		return "", err
	}
	client, err := s.clients.GetClient(v.ClientID)
	if err != nil {
		return "", err
	}
	tpl, err := s.receiptTemplate(style)
	if err != nil {
		return "", err
	}
	allocations := make([]string, 0, len(v.Allocations))
	for _, a := range v.Allocations {
		allocations = append(allocations, a.InvoiceNumber)
	}
	paidFor := v.Notes
	if len(allocations) > 0 {
		paidFor = "سداد فواتير رقم " + strings.Join(allocations, "، ")
	}
	amount := formatVoucherAmount(v.TotalAmount)
	replacements := map[string]string{
		"seller_name": issuer.NameAr, "seller_name_en": issuer.NameEn,
		"seller_tax": issuer.TaxNumber, "seller_phone": issuer.Phone,
		"seller_cr": issuer.CommercialRegister, "seller_address": issuer.Street,
		"seller_address_en": issuer.AddressEn,
		"seller_meta_ar":    issuer.NameAr, "seller_meta_en": issuer.NameEn,
		"buyer_name": v.ClientName, "client_name": v.ClientName, "received_from": v.ClientName,
		"buyer_address": client.Address, "buyer_tax": client.TaxNumber,
		"voucher_number": v.VoucherNumber, "invoice_number": v.VoucherNumber,
		"voucher_date": v.VoucherDate, "issue_date": v.VoucherDate,
		"payment_method": v.PaymentLabel, "reference_no": v.ReferenceNo,
		"notes": v.Notes, "paid_for": paidFor,
		"amount": amount, "total_amount": amount, "grand_total": amount,
		"qr_code": "", "amount_in_words": services.TafqeetArabic(v.TotalAmount), "tafqeet": services.TafqeetArabic(v.TotalAmount), "receiver_name": issuer.NameAr,
	}
	for key, value := range cashReceiptLabels() {
		replacements[key] = value
	}
	blocks := map[string]string{"receipt_value": `<span class="sar-amount" dir="rtl"><bdi dir="ltr">` + amount + `</bdi>{{sar_symbol}}</span>`, "receipt_items": "", "receipt_conversion": "", "receipt_weight_summary": ""}
	return s.fillReceiptTemplate(tpl, issuer, replacements, blocks), nil
}

func injectVoucherPrintStyle(template string) string {
	style := `<style data-voucher-page>
@page { size: A4 portrait !important; margin: 10mm !important; }
html { height: auto !important; min-height: 0 !important; max-height: none !important; overflow: visible !important; }
body {
  width: 190mm !important; max-width: 190mm !important;
  height: auto !important; min-height: 276mm !important; max-height: none !important;
  margin: 0 auto !important; padding: 0 !important; box-sizing: border-box !important; overflow: visible !important;
}
body > .receipt-card, body > .receipt-container, body > .receipt-page, body > .receipt, body > .page {
  width: 190mm !important; max-width: 190mm !important;
  height: auto !important; min-height: 276mm !important; max-height: none !important;
  margin: 0 !important; box-sizing: border-box !important;
  display: flex !important; flex-direction: column !important; justify-content: flex-start !important;
  overflow: visible !important; break-inside: avoid !important; page-break-inside: avoid !important;
}
body > .receipt-card > .head, body > .receipt-container > .head, body > .receipt-page > .head { margin-bottom: 5px !important; flex-shrink: 0 !important; }
body > .receipt-card > .receipt-box, body > .receipt-container > .receipt-box { margin-top: 0 !important; flex-shrink: 0 !important; }
body > .receipt-card > footer, body > .receipt-container > footer, body > .receipt-container > .foot, body > .receipt-page > footer { margin-top: auto !important; flex-shrink: 0 !important; }
body > .receipt-page > .document-heading { margin-top: 4mm !important; margin-bottom: 4mm !important; }
body > .receipt-page > .amount-card { margin-top: 4mm !important; margin-bottom: 4mm !important; }
body > .receipt-page > .ornament { margin-top: 4mm !important; margin-bottom: 4mm !important; }
body > .receipt-page > .bottom-rule { margin-top: 4mm !important; }
body > .receipt-card > *, body > .receipt-container > *, body > .receipt-page > *, body > .receipt > *, body > .page > * { flex-shrink: 0; }
@media print {
  body { margin: 0 !important; background: #fff !important; }
  body > .receipt-card, body > .receipt-container, body > .receipt-page, body > .receipt, body > .page { box-shadow: none !important; }
}
</style>`
	if headEnd := strings.LastIndex(strings.ToLower(template), "</head>"); headEnd >= 0 {
		return template[:headEnd] + style + "\n" + template[headEnd:]
	}
	return style + "\n" + template
}

func (s *Server) registerGoldReceipts(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/vouchers/gold", func(w http.ResponseWriter, r *http.Request) {
		items, err := s.vouchers.ListGoldReceipts(r.URL.Query().Get("issuer_id"), r.URL.Query().Get("invoice_id"))
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		s.json(w, 200, items)
	})
	mux.HandleFunc("GET /api/vouchers/gold/price", func(w http.ResponseWriter, r *http.Request) {
		var price int64
		_ = s.db.QueryRow(`SELECT gold_price FROM gold_receipts WHERE issuer_id=? AND voucher_date=? AND kind='WAGES' AND status='ACTIVE' ORDER BY created_at DESC LIMIT 1`, r.URL.Query().Get("issuer_id"), r.URL.Query().Get("date")).Scan(&price)
		s.json(w, 200, map[string]any{"gold_price": models.ToMajor(price)})
	})
	mux.HandleFunc("POST /api/vouchers/gold", func(w http.ResponseWriter, r *http.Request) {
		var input services.CreateGoldReceiptInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			s.err(w, 400, "بيانات السند غير صالحة")
			return
		}
		actor := "system"
		if u := s.getSessionUser(r); u != nil {
			actor = u.Username
		}
		v, err := s.vouchers.CreateGoldReceipt(input, actor, s.clientIP(r))
		if err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.sync.Broadcast(services.SyncEvent{Type: "voucher:created", Entity: "voucher", Action: "create", Actor: actor, Data: map[string]any{"id": v.ID, "kind": v.Kind, "total_weight": v.TotalWeight}})
		s.json(w, 200, v)
	})
	mux.HandleFunc("POST /api/vouchers/gold/{id}/cancel", func(w http.ResponseWriter, r *http.Request) {
		actor := "system"
		if u := s.getSessionUser(r); u != nil {
			actor = u.Username
		}
		if err := s.vouchers.CancelGoldReceipt(r.PathValue("id"), actor, s.clientIP(r)); err != nil {
			s.err(w, 400, err.Error())
			return
		}
		s.sync.Broadcast(services.SyncEvent{Type: "voucher:updated", Entity: "voucher", Action: "cancel", Actor: actor})
		s.json(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /api/vouchers/gold/{id}/html", func(w http.ResponseWriter, r *http.Request) {
		doc, err := s.renderGoldReceiptHTML(r.PathValue("id"), r.URL.Query().Get("style"))
		if err != nil {
			s.err(w, 404, err.Error())
			return
		}
		s.json(w, 200, map[string]string{"html": doc})
	})
	mux.HandleFunc("GET /api/vouchers/gold/{id}/pdf", func(w http.ResponseWriter, r *http.Request) {
		doc, err := s.renderGoldReceiptHTML(r.PathValue("id"), r.URL.Query().Get("style"))
		if err != nil {
			s.err(w, 404, err.Error())
			return
		}
		pdf, err := services.RenderHTMLToPDF(doc)
		if err != nil {
			s.err(w, 500, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Disposition", `attachment; filename="gold-receipt.pdf"; filename*=UTF-8''`+url.PathEscape("سند_قبض_ذهب.pdf"))
		w.Write(pdf)
	})
}

func (s *Server) renderGoldReceiptHTML(id, style string) (string, error) {
	v, err := s.vouchers.GetGoldReceipt(id)
	if err != nil {
		return "", err
	}
	issuer, err := s.issuers.GetIssuer(v.IssuerID)
	if err != nil {
		return "", err
	}
	client, err := s.clients.GetClient(v.ClientID)
	if err != nil {
		return "", err
	}
	tpl, err := s.receiptTemplate(style)
	if err != nil {
		return "", err
	}
	title := "سند قبض معدن كسر"
	if v.Kind == "WAGES" {
		title = "سند قبض أجور بالذهب"
	}
	if v.Status == "CANCELLED" {
		title += " — ملغى"
	}
	replacements := map[string]string{"receipt_title": title, "receipt_subtitle": "Gold Receipt", "receipt_payment_label": "نوع القبض", "receipt_reference_label": "الفاتورة المرتبطة", "receipt_currency_label": "الوحدة / Unit", "receipt_currency": "ذهب بالجرام / Gold grams", "receipt_total_label": "إجمالي الذهب المقبوض", "receipt_unit": "جرام", "receipt_footer": "سند قبض ذهب — جميع الأوزان بالجرام", "seller_name": issuer.NameAr, "seller_name_en": issuer.NameEn, "seller_address": issuer.Street, "seller_address_en": issuer.AddressEn, "seller_tax": issuer.TaxNumber, "seller_cr": issuer.CommercialRegister, "seller_phone": issuer.Phone, "received_from": client.Name, "voucher_number": v.VoucherNumber, "voucher_date": v.VoucherDate, "payment_method": map[string]string{"METAL": "قبض معدن كسر", "WAGES": "قبض أجور بذهب عيار 24"}[v.Kind], "reference_no": v.InvoiceNumber, "paid_for": "قبض ذهب مقابل فاتورة رقم " + v.InvoiceNumber + " — " + v.Notes, "amount_in_words": ""}
	replacements["buyer_address"] = client.Address
	if client.Address == "" {
		replacements["buyer_address"] = strings.Join([]string{client.City, client.District, client.Street}, " ")
	}
	replacements["buyer_tax"] = client.TaxNumber
	weights := map[string]float64{}
	var rows strings.Builder
	for i, line := range v.Lines {
		weights[line.Karat] += line.Weight
		stockName := "ذهب عيار " + line.Karat
		if v.Kind == "METAL" {
			stockName = "ذهب كسر عيار " + line.Karat
		}
		fmt.Fprintf(&rows, `<tr><td>%d</td><td>%s</td><td dir="ltr">%.3f</td><td dir="ltr">%sK</td></tr>`, i+1, html.EscapeString(stockName), line.Weight, html.EscapeString(line.Karat))
	}
	items := `<table class="receipt-items"><thead><tr><th>#</th><th>الصنف / Stock Name</th><th>الوزن بالجرام / Weight</th><th>العيار / Purity</th></tr></thead><tbody>` + rows.String() + `</tbody></table>`
	summary := `<table class="receipt-weight-summary"><caption>ملخص القبض حسب العيار</caption><tr><th>18K</th><th>21K</th><th>22K</th><th>24K</th></tr><tr>`
	for _, k := range []string{"18", "21", "22", "24"} {
		summary += fmt.Sprintf(`<td dir="ltr">%.3f</td>`, weights[k])
	}
	summary += `</tr></table>`
	conversion := ""
	if v.Kind == "WAGES" {
		conversion = fmt.Sprintf(`<div class="receipt-conversion">إجمالي الفاتورة شامل الضريبة: <b dir="ltr">%.2f</b> ريال سعودي ÷ سعر جرام عيار 24 بتاريخ %s: <b dir="ltr">%.2f</b> ريال سعودي = <b dir="ltr">%.3f</b> جرام ذهب عيار 24</div>`, v.InvoiceTotal, html.EscapeString(v.VoucherDate), v.GoldPrice, v.TotalWeight)
	}
	return s.fillReceiptTemplate(tpl, issuer, replacements, map[string]string{"receipt_value": fmt.Sprintf(`<bdi dir="ltr">%.3f</bdi>`, v.TotalWeight), "receipt_items": items, "receipt_conversion": conversion, "receipt_weight_summary": summary}), nil
}

func cashReceiptLabels() map[string]string {
	return map[string]string{"receipt_title": "سند قبض نقدي", "receipt_subtitle": "Cash Receipt — SAR", "receipt_payment_label": "طريقة السداد", "receipt_reference_label": "مرجع السداد", "receipt_currency_label": "العملة / Currency", "receipt_currency": "ريال سعودي / SAR", "receipt_total_label": "المبلغ المستلم", "receipt_unit": "ريال سعودي", "receipt_footer": "سند قبض بمبلغ مالي بالريال السعودي."}
}

func (s *Server) receiptTemplate(style string) (string, error) {
	var err error
	if style == "" {
		style, err = s.templates.FirstTemplateID("documents")
		if err != nil {
			return "", err
		}
	}
	return s.templates.RenderTemplateHTML(style)
}

func (s *Server) fillReceiptTemplate(tpl string, issuer *models.Issuer, values map[string]string, blocks map[string]string) string {
	for key, value := range values {
		tpl = strings.ReplaceAll(tpl, "{{"+key+"}}", html.EscapeString(value))
	}
	for key, value := range blocks {
		tpl = strings.ReplaceAll(tpl, "{{"+key+"}}", value)
	}
	symbol := s.templates.SARSymbolSVG()
	tpl = strings.NewReplacer("{{sar_symbol}}", symbol, "{{currency_symbol}}", symbol).Replace(tpl)
	logo := `<span class="gold-mark">◇</span>`
	if issuer.LogoData != nil && *issuer.LogoData != "" {
		logo = `<img style="max-width:130px;max-height:80px;object-fit:contain;" src="` + html.EscapeString(*issuer.LogoData) + `" alt="شعار المتجر">`
	}
	return injectVoucherPrintStyle(strings.ReplaceAll(tpl, "{{logo}}", logo))
}
