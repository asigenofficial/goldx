package services

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"goldx/internal/models"
)

func TestBatchCashReceiptsGroupedAcrossClients(t *testing.T) {
	_, issSvc, cliSvc, invSvc, vchSvc := openTestServices(t)

	supplierA := &models.Issuer{Code: "SUP-CA", NameAr: "مورد النقد الأول", VoucherPrefix: "RV"}
	if err := issSvc.CreateIssuer(supplierA); err != nil {
		t.Fatalf("create supplierA: %v", err)
	}
	supplierB := &models.Issuer{Code: "SUP-CB", NameAr: "مورد النقد الثاني", VoucherPrefix: "RV"}
	if err := issSvc.CreateIssuer(supplierB); err != nil {
		t.Fatalf("create supplierB: %v", err)
	}

	c1 := &models.Client{ClientCode: "CC-001", Name: "مؤسسة الأمل للذهب"}
	c2 := &models.Client{ClientCode: "CC-002", Name: "شركة النور للمجوهرات"}
	for _, c := range []*models.Client{c1, c2} {
		if err := cliSvc.CreateClient(c); err != nil {
			t.Fatalf("create client %s: %v", c.Name, err)
		}
	}

	makeInv := func(issID, cliID, date string) *InvoiceView {
		inv, err := invSvc.CreateInvoice(CreateInvoiceInput{
			IssuerID:        issID,
			ClientID:        cliID,
			IssueDate:       date,
			GoldInvoiceType: "WAGE_ONLY",
			Lines: []CreateInvoiceLineInput{
				{ItemName: "مشغولات ذهب", Karat: "21", Quantity: 10, GramPrice: 0, Wage: 20, TaxRate: 15},
			},
		}, "tester", "127.0.0.1")
		if err != nil {
			t.Fatalf("CreateInvoice: %v", err)
		}
		return inv
	}

	// Client 1: 5 invoices -> grouped by 4 => Group 1 (4 invs, last=2026-10-12 Mon +4 = 2026-10-16 Fri -> Sat 2026-10-17)
	//                                        Group 2 (1 inv,  last=2026-10-14 Wed +4 = 2026-10-18 Sun)
	c1Inv1 := makeInv(supplierA.ID, c1.ID, "2026-10-10")
	c1Inv2 := makeInv(supplierA.ID, c1.ID, "2026-10-11")
	c1Inv3 := makeInv(supplierA.ID, c1.ID, "2026-10-11")
	c1Inv4 := makeInv(supplierA.ID, c1.ID, "2026-10-12")
	c1Inv5 := makeInv(supplierA.ID, c1.ID, "2026-10-14")

	// Client 2: 2 invoices -> grouped by 4 => Group 3 (2 invs, last=2026-10-13 Tue +4 = 2026-10-17 Sat)
	c2Inv1 := makeInv(supplierA.ID, c2.ID, "2026-10-12")
	c2Inv2 := makeInv(supplierA.ID, c2.ID, "2026-10-13")

	// Other supplier invoice (must not appear in supplierA)
	_ = makeInv(supplierB.ID, c1.ID, "2026-10-10")

	eligible, err := vchSvc.ListEligibleCashInvoices(EligibleGoldInvoicesFilter{IssuerID: supplierA.ID})
	if err != nil {
		t.Fatalf("ListEligibleCashInvoices: %v", err)
	}
	if len(eligible.Items) != 7 {
		t.Fatalf("expected 7 eligible invoices for supplier A, got %d", len(eligible.Items))
	}

	skipFri := true
	res, err := vchSvc.CreateCashReceiptsBatch(BatchCreateCashReceiptsInput{
		IssuerID:           supplierA.ID,
		PaymentType:        "TRANSFER",
		DateOffset:         4,
		SkipFriday:         &skipFri,
		StartNumber:        "RV-00100",
		SeqGapMin:          19,
		SeqGapMax:          21,
		InvoicesPerVoucher: 4,
		InvoiceIDs:         []string{c1Inv1.ID, c1Inv2.ID, c1Inv3.ID, c1Inv4.ID, c1Inv5.ID, c2Inv1.ID, c2Inv2.ID},
	}, "tester", "127.0.0.1")
	if err != nil {
		t.Fatalf("CreateCashReceiptsBatch: %v", err)
	}

	if res.Count != 3 {
		t.Fatalf("expected 3 grouped vouchers, got %d", res.Count)
	}
	if res.ClientCount != 2 {
		t.Fatalf("expected 2 clients, got %d", res.ClientCount)
	}
	if res.InvoiceCount != 7 {
		t.Fatalf("expected 7 invoices allocated, got %d", res.InvoiceCount)
	}
	if res.SkippedFridays != 1 {
		t.Fatalf("expected 1 skipped Friday, got %d", res.SkippedFridays)
	}

	var prevNo int64
	for i, v := range res.Items {
		parsedDate, err := time.Parse("2006-01-02", v.VoucherDate)
		if err != nil {
			t.Fatalf("invalid voucher date %s: %v", v.VoucherDate, err)
		}
		if parsedDate.Weekday() == time.Friday {
			t.Fatalf("voucher %s landed on Friday %s", v.VoucherNumber, v.VoucherDate)
		}
		if !strings.HasPrefix(v.Notes, "مقابل أجور وضريبة ") || !strings.Contains(v.Notes, "فواتير رقم ") {
			t.Fatalf("unexpected notes format: %q", v.Notes)
		}
		numStr := strings.TrimPrefix(v.VoucherNumber, "RV-")
		num, err := strconv.ParseInt(numStr, 10, 64)
		if err != nil {
			t.Fatalf("parse serial %s: %v", v.VoucherNumber, err)
		}
		if i == 0 && num != 100 {
			t.Fatalf("expected first serial 100, got %d", num)
		}
		if i > 0 {
			diff := num - prevNo
			if diff < 19 || diff > 21 {
				t.Fatalf("expected serial gap in [19, 21], got %d (%d -> %d)", diff, prevNo, num)
			}
		}
		prevNo = num
	}

	// Eligible list must now be empty because all 7 invoices are PAID.
	eligibleAfter, err := vchSvc.ListEligibleCashInvoices(EligibleGoldInvoicesFilter{IssuerID: supplierA.ID})
	if err != nil {
		t.Fatalf("ListEligibleCashInvoices after: %v", err)
	}
	if len(eligibleAfter.Items) != 0 {
		t.Fatalf("expected 0 eligible invoices after batch, got %d", len(eligibleAfter.Items))
	}
}
