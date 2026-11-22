package services

import (
	"path/filepath"
	"testing"
	"time"

	"goldx/internal/config"
	"goldx/internal/db"
	"goldx/internal/models"
)

func openTestServices(t *testing.T) (*db.DB, *IssuerService, *ClientService, *InvoiceService, *VoucherService) {
	t.Helper()
	dir := t.TempDir()
	cfg := config.Load()
	cfg.DataDir = dir
	cfg.DbFile = filepath.Join(dir, "test.db")
	cfg.KeyFile = filepath.Join(dir, "secret.key")

	d, err := db.Open(cfg)
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })

	iss := NewIssuerService(d)
	cli := NewClientService(d)
	inv := NewInvoiceService(d, iss, make([]byte, 32))
	vch := NewVoucherService(d, iss)
	return d, iss, cli, inv, vch
}

func TestAdjustVoucherDate_SkipsFriday(t *testing.T) {
	// 2026-10-14 is Wednesday, 2026-10-15 is Thursday, 2026-10-16 is Friday, 2026-10-17 is Saturday.
	cases := []struct {
		issueDate  string
		offset     int
		skipFriday bool
		wantDate   string
		wantSkip   bool
	}{
		{"2026-10-14", 2, true, "2026-10-17", true},  // Wed + 2 = Fri -> Sat
		{"2026-10-15", 1, true, "2026-10-17", true},  // Thu + 1 = Fri -> Sat
		{"2026-10-15", 2, true, "2026-10-17", false}, // Thu + 2 = Sat (not Friday)
		{"2026-10-16", 0, true, "2026-10-17", true},  // Fri + 0 = Fri -> Sat
		{"2026-10-17", 0, true, "2026-10-17", false}, // Sat + 0 = Sat
		{"2026-10-14", 2, false, "2026-10-16", false},
	}

	for _, tc := range cases {
		got, skipped, err := AdjustVoucherDate(tc.issueDate, tc.offset, tc.skipFriday)
		if err != nil {
			t.Fatalf("AdjustVoucherDate(%s, %d, %v) error: %v", tc.issueDate, tc.offset, tc.skipFriday, err)
		}
		if got != tc.wantDate || skipped != tc.wantSkip {
			t.Fatalf("AdjustVoucherDate(%s, %d, %v) = (%s, %v), want (%s, %v)",
				tc.issueDate, tc.offset, tc.skipFriday, got, skipped, tc.wantDate, tc.wantSkip)
		}
		if tc.skipFriday {
			parsed, _ := time.Parse("2006-01-02", got)
			if parsed.Weekday() == time.Friday {
				t.Fatalf("returned Friday %s despite skipFriday=true", got)
			}
		}
	}

	// Exhaustive check across an entire month and offsets 0..14: never returns Friday.
	base, _ := time.Parse("2026-10-01", "2026-10-01")
	for day := 0; day < 31; day++ {
		dStr := base.AddDate(0, 0, day).Format("2006-10-02")
		for off := 0; off <= 14; off++ {
			got, _, err := AdjustVoucherDate(dStr, off, true)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			parsed, _ := time.Parse("2006-01-02", got)
			if parsed.Weekday() == time.Friday {
				t.Fatalf("date %s + %d landed on Friday %s", dStr, off, got)
			}
		}
	}
}

func TestParseVoucherSerialPattern(t *testing.T) {
	cases := []struct {
		pattern    string
		wantPrefix string
		wantStart  int64
		wantPad    int
	}{
		{"100", "", 100, 3},
		{"00100", "", 100, 5},
		{"G-RV-00100", "G-RV", 100, 5},
		{"GR-50", "GR", 50, 2},
		{"", "G-RV", 1, 5},
	}
	for _, tc := range cases {
		p, s, pad := ParseVoucherSerialPattern(tc.pattern, "G-RV", 1, 5)
		if p != tc.wantPrefix || s != tc.wantStart || pad != tc.wantPad {
			t.Fatalf("ParseVoucherSerialPattern(%q) = (%q, %d, %d), want (%q, %d, %d)",
				tc.pattern, p, s, pad, tc.wantPrefix, tc.wantStart, tc.wantPad)
		}
	}
}

func TestBatchGoldReceiptsAcrossAllClientsOfSupplier(t *testing.T) {
	_, issSvc, cliSvc, invSvc, vchSvc := openTestServices(t)

	supplierA := &models.Issuer{Code: "SUP-A", NameAr: "مورد الذهب الأول", VoucherPrefix: "RV"}
	if err := issSvc.CreateIssuer(supplierA); err != nil {
		t.Fatalf("create supplierA: %v", err)
	}
	supplierB := &models.Issuer{Code: "SUP-B", NameAr: "مورد الذهب الثاني", VoucherPrefix: "RV"}
	if err := issSvc.CreateIssuer(supplierB); err != nil {
		t.Fatalf("create supplierB: %v", err)
	}

	c1 := &models.Client{ClientCode: "C-001", Name: "عميل 1"}
	c2 := &models.Client{ClientCode: "C-002", Name: "عميل 2"}
	c3 := &models.Client{ClientCode: "C-003", Name: "عميل 3"}
	for _, c := range []*models.Client{c1, c2, c3} {
		if err := cliSvc.CreateClient(c); err != nil {
			t.Fatalf("create client %s: %v", c.Name, err)
		}
	}

	makeInv := func(issID, cliID, date, karat string, qty float64) *InvoiceView {
		inv, err := invSvc.CreateInvoice(CreateInvoiceInput{
			IssuerID:        issID,
			ClientID:        cliID,
			IssueDate:       date,
			GoldInvoiceType: "PRICE_AND_WAGE",
			Lines: []CreateInvoiceLineInput{
				{ItemName: "سبيكة ذهب", Karat: karat, Quantity: qty, GramPrice: 300, Wage: 15, TaxRate: 15},
			},
		}, "tester", "127.0.0.1")
		if err != nil {
			t.Fatalf("CreateInvoice: %v", err)
		}
		return inv
	}

	// Supplier A invoices across 3 different clients:
	// - inv1: 2026-10-12 (Mon) -> +2 = 2026-10-14 (Wed)
	// - inv2: 2026-10-14 (Wed) -> +2 = 2026-10-16 (Fri!) -> MUST shift to 2026-10-17 (Sat)
	// - inv3: 2026-10-15 (Thu) -> +2 = 2026-10-17 (Sat)
	// - inv4: 2026-10-18 (Sun) -> +2 = 2026-10-20 (Tue)
	inv1 := makeInv(supplierA.ID, c2.ID, "2026-10-12", "21", 10.5)
	inv2 := makeInv(supplierA.ID, c1.ID, "2026-10-14", "18", 20.0)
	inv3 := makeInv(supplierA.ID, c3.ID, "2026-10-15", "21", 15.25)
	inv4 := makeInv(supplierA.ID, c1.ID, "2026-10-18", "24", 5.0)
	invCancelled := makeInv(supplierA.ID, c2.ID, "2026-10-13", "21", 9.0)
	if err := invSvc.CancelInvoice(invCancelled.ID, "tester", "127.0.0.1"); err != nil {
		t.Fatalf("cancel invoice: %v", err)
	}
	// Supplier B invoice must NOT appear for Supplier A
	_ = makeInv(supplierB.ID, c1.ID, "2026-10-12", "21", 50.0)

	eligible, err := vchSvc.ListEligibleGoldInvoices(EligibleGoldInvoicesFilter{IssuerID: supplierA.ID})
	if err != nil {
		t.Fatalf("ListEligibleGoldInvoices: %v", err)
	}
	if eligible.TotalInvoices != 4 {
		t.Fatalf("expected 4 eligible invoices for supplier A, got %d", eligible.TotalInvoices)
	}
	if eligible.TotalClients != 3 {
		t.Fatalf("expected 3 clients for supplier A, got %d", eligible.TotalClients)
	}
	if eligible.TotalRemainingGrams != 50.75 {
		t.Fatalf("expected 50.75 remaining grams, got %.3f", eligible.TotalRemainingGrams)
	}

	// Create unified batch across all 3 clients of supplier A, starting at 100 with gap +3, date offset +2, skip Friday.
	skipFri := true
	batchRes, err := vchSvc.CreateGoldReceiptsBatch(BatchCreateGoldReceiptsInput{
		IssuerID:    supplierA.ID,
		Kind:        "METAL",
		DateOffset:  2,
		SkipFriday:  &skipFri,
		StartNumber: "100",
		SeqGapMin:   3,
		SeqGapMax:   3,
		InvoiceIDs:  []string{inv4.ID, inv2.ID, inv1.ID, inv3.ID}, // intentionally unsorted order
	}, "tester", "127.0.0.1")
	if err != nil {
		t.Fatalf("CreateGoldReceiptsBatch: %v", err)
	}

	if batchRes.Count != 4 || batchRes.ClientCount != 3 {
		t.Fatalf("unexpected batch counts: count=%d clients=%d", batchRes.Count, batchRes.ClientCount)
	}
	if batchRes.FirstNumber != "100" || batchRes.LastNumber != "109" {
		t.Fatalf("unexpected serial range: %s .. %s", batchRes.FirstNumber, batchRes.LastNumber)
	}
	if batchRes.SkippedFridays != 1 {
		t.Fatalf("expected 1 skipped Friday, got %d", batchRes.SkippedFridays)
	}

	wantNums := []string{"100", "103", "106", "109"}
	wantDates := []string{"2026-10-14", "2026-10-17", "2026-10-17", "2026-10-20"}
	wantInvIDs := []string{inv1.ID, inv2.ID, inv3.ID, inv4.ID}
	for i, item := range batchRes.Items {
		if item.VoucherNumber != wantNums[i] {
			t.Fatalf("item[%d].VoucherNumber = %s, want %s", i, item.VoucherNumber, wantNums[i])
		}
		if item.VoucherDate != wantDates[i] {
			t.Fatalf("item[%d].VoucherDate = %s, want %s", i, item.VoucherDate, wantDates[i])
		}
		if item.InvoiceID != wantInvIDs[i] {
			t.Fatalf("item[%d].InvoiceID = %s, want %s", i, item.InvoiceID, wantInvIDs[i])
		}
		isFri, _ := IsFridayDate(item.VoucherDate)
		if isFri {
			t.Fatalf("item[%d] landed on Friday %s", i, item.VoucherDate)
		}
	}

	// Eligible invoices should now be 0, and suggested next number should be 110.
	afterEligible, err := vchSvc.ListEligibleGoldInvoices(EligibleGoldInvoicesFilter{IssuerID: supplierA.ID})
	if err != nil {
		t.Fatalf("ListEligibleGoldInvoices after: %v", err)
	}
	if afterEligible.TotalInvoices != 0 {
		t.Fatalf("expected 0 eligible invoices after full collection, got %d", afterEligible.TotalInvoices)
	}
	if afterEligible.SuggestedStartNo != "110" {
		t.Fatalf("expected suggested start no 110, got %s", afterEligible.SuggestedStartNo)
	}

	// Updating a receipt to Friday must be rejected when skip_friday is true.
	if _, err := vchSvc.UpdateGoldReceipt(batchRes.Items[0].ID, UpdateGoldReceiptInput{
		VoucherNumber: "100",
		VoucherDate:   "2026-10-16", // Friday
		SkipFriday:    &skipFri,
	}, "tester", "127.0.0.1"); err == nil {
		t.Fatalf("expected Friday rejection on UpdateGoldReceipt")
	}

	// Updating to a valid non-Friday date and new number succeeds.
	updated, err := vchSvc.UpdateGoldReceipt(batchRes.Items[0].ID, UpdateGoldReceiptInput{
		VoucherNumber: "101",
		VoucherDate:   "2026-10-18",
		Notes:         "ملاحظة معدلة",
		SkipFriday:    &skipFri,
	}, "tester", "127.0.0.1")
	if err != nil {
		t.Fatalf("UpdateGoldReceipt valid: %v", err)
	}
	if updated.VoucherNumber != "101" || updated.VoucherDate != "2026-10-18" || updated.Notes != "ملاحظة معدلة" {
		t.Fatalf("unexpected updated receipt: %+v", updated)
	}

	// Deleting one receipt releases its invoice weight back to eligible list.
	if err := vchSvc.DeleteGoldReceipt(batchRes.Items[0].ID, "tester", "127.0.0.1"); err != nil {
		t.Fatalf("DeleteGoldReceipt: %v", err)
	}
	reEligible, err := vchSvc.ListEligibleGoldInvoices(EligibleGoldInvoicesFilter{IssuerID: supplierA.ID})
	if err != nil {
		t.Fatalf("ListEligibleGoldInvoices after delete: %v", err)
	}
	if reEligible.TotalInvoices != 1 || reEligible.Items[0].ID != inv1.ID {
		t.Fatalf("expected inv1 to become eligible again after delete, got %+v", reEligible.Items)
	}

	// Duplicate voucher number collision on batch must fail atomically.
	_, err = vchSvc.CreateGoldReceiptsBatch(BatchCreateGoldReceiptsInput{
		IssuerID:    supplierA.ID,
		Kind:        "METAL",
		DateOffset:  1,
		SkipFriday:  &skipFri,
		StartNumber: "103", // already used!
		SeqGapMin:   1,
		InvoiceIDs:  []string{inv1.ID},
	}, "tester", "127.0.0.1")
	if err == nil {
		t.Fatalf("expected duplicate voucher number error")
	}
}
