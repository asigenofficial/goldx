package api

import (
	"strings"
	"testing"
)

func TestGoldReceiptRoutePermissions(t *testing.T) {
	cases := []struct {
		pattern string
		want    string
	}{
		{"GET /api/vouchers/gold", "vouchers.view"},
		{"GET /api/vouchers/gold/eligible-invoices", "vouchers.view"},
		{"POST /api/vouchers/gold", "vouchers.create"},
		{"POST /api/vouchers/gold/batch", "vouchers.create"},
		{"POST /api/vouchers/gold/batch-html", "vouchers.view"},
		{"PATCH /api/vouchers/gold/{id}", "vouchers.edit"},
		{"DELETE /api/vouchers/gold/{id}", "vouchers.delete"},
		{"POST /api/vouchers/gold/{id}/cancel", "vouchers.cancel"},
	}
	for _, tc := range cases {
		if got := routePermission(tc.pattern); got != tc.want {
			t.Fatalf("routePermission(%q) = %q, want %q", tc.pattern, got, tc.want)
		}
	}
}

func TestGregorianToHijriAndBatchHTMLHelper(t *testing.T) {
	h := gregorianToHijri("2026-11-23")
	if !strings.HasPrefix(h, "1448/") {
		t.Fatalf("expected Hijri year 1448 for 2026-11-23, got %q", h)
	}
	if gregorianToHijri("invalid") != "" {
		t.Fatalf("expected empty string for invalid date")
	}

	doc := `<!doctype html><html><head><style>.a{color:red}</style></head><body><div class="receipt">OK</div><script>alert(1)</script></body></html>`
	head, body := extractHTMLHeadAndBody(doc)
	if !strings.Contains(head, ".a{color:red}") {
		t.Fatalf("missing head styles: %q", head)
	}
	if !strings.Contains(body, "OK") || strings.Contains(body, "<script") {
		t.Fatalf("unexpected extracted body: %q", body)
	}
}
