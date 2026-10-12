package services

import (
	"testing"
)

func TestGoldInvoiceCalculations(t *testing.T) {
	tests := []struct {
		name            string
		lines           []CreateInvoiceLineInput
		expectedTaxRate float64
		expectedTaxable int64 // in halalas
		expectedTax     int64 // in halalas
		expectedTotal   int64 // in halalas
	}{
		{
			name: "24K is tax exempt (0% VAT)",
			lines: []CreateInvoiceLineInput{
				{
					ItemName:  "سبيكة ذهب سويسري",
					Karat:     "24",
					GramPrice: 350.0,
					Wage:      0.0,
					Quantity:  10.0, // 10 grams * 350 = 3500 SAR = 350000 halalas
				},
			},
			expectedTaxRate: 0.0,
			expectedTaxable: 350000,
			expectedTax:     0,
			expectedTotal:   350000,
		},
		{
			name: "21K with 15% VAT - Price and Wage",
			lines: []CreateInvoiceLineInput{
				{
					ItemName:  "طقم ذهب بحريني عيار 21",
					Karat:     "21",
					GramPrice: 300.0,
					Wage:      30.0, // Total gram price = 330.0
					Quantity:  10.0, // 10 * 330 = 3300 SAR = 330000 halalas
				},
			},
			expectedTaxRate: 15.0,
			expectedTaxable: 330000,
			expectedTax:     49500, // 3300 * 0.15 = 495 SAR = 49500 halalas
			expectedTotal:   379500,
		},
		{
			name: "18K - Wage Only (making fee only)",
			lines: []CreateInvoiceLineInput{
				{
					ItemName:  "أجور صياغة خاتم عيار 18",
					Karat:     "18",
					GramPrice: 0.0,
					Wage:      50.0,
					Quantity:  5.0, // 5 * 50 = 250 SAR = 25000 halalas
				},
			},
			expectedTaxRate: 15.0,
			expectedTaxable: 25000,
			expectedTax:     3750, // 250 * 0.15 = 37.5 SAR = 3750 halalas
			expectedTotal:   28750,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			computed, subtotal, discount, taxable, tax, grand, err := computeInvoiceLines(tt.lines, false, 15.0)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(computed) != 1 {
				t.Fatalf("expected 1 line, got %d", len(computed))
			}
			line := computed[0]
			if line.TaxRate != tt.expectedTaxRate {
				t.Errorf("taxRate: got %f, want %f", line.TaxRate, tt.expectedTaxRate)
			}
			if taxable != tt.expectedTaxable {
				t.Errorf("taxable: got %d, want %d", taxable, tt.expectedTaxable)
			}
			if tax != tt.expectedTax {
				t.Errorf("tax: got %d, want %d", tax, tt.expectedTax)
			}
			if grand != tt.expectedTotal {
				t.Errorf("grand: got %d, want %d", grand, tt.expectedTotal)
			}
			_ = subtotal
			_ = discount
		})
	}
}

func TestGoldRatesAndValidation(t *testing.T) {
	for _, karat := range []string{"18", "21", "22", "24"} {
		lines, _, _, _, tax, _, err := computeInvoiceLines([]CreateInvoiceLineInput{{ItemName: "ذهب", Karat: karat, Quantity: 2.5, GramPrice: 300, Wage: 20, TaxRate: 5}}, false, 7)
		want := int64(12000)
		if karat == "24" {
			want = 0
		}
		if err != nil || tax != want || lines[0].Unit != "جرام" {
			t.Fatalf("karat %s: tax=%d err=%v", karat, tax, err)
		}
	}
	for _, line := range []CreateInvoiceLineInput{
		{ItemName: "ذهب", Karat: "20", Quantity: 1, UnitPrice: 100},
		{ItemName: "ذهب", Karat: "21", Quantity: 1, GramPrice: -1},
		{ItemName: "ذهب", Karat: "21", Quantity: 1, Wage: -1},
	} {
		if _, _, _, _, _, _, err := computeInvoiceLines([]CreateInvoiceLineInput{line}, false, 15); err == nil {
			t.Fatal("invalid gold line accepted")
		}
	}
}

func TestGoldInvoiceModes(t *testing.T) {
	for mode, want := range map[string]float64{"PRICE_ONLY": 300, "WAGE_ONLY": 20, "PRICE_AND_WAGE": 320} {
		input := CreateInvoiceInput{GoldInvoiceType: mode, Lines: []CreateInvoiceLineInput{{ItemName: "ذهب", Karat: "22", Quantity: 2, GramPrice: 300, Wage: 20, UnitPrice: 999}}}
		if err := normalizeGoldInvoice(&input); err != nil {
			t.Fatal(err)
		}
		if input.Lines[0].UnitPrice != want || input.Lines[0].Unit != "جرام" {
			t.Fatalf("mode %s: %+v", mode, input.Lines[0])
		}
		if mode == "PRICE_ONLY" && input.Lines[0].Wage != 0 || mode == "WAGE_ONLY" && input.Lines[0].GramPrice != 0 {
			t.Fatal("inactive component retained")
		}
	}
}
