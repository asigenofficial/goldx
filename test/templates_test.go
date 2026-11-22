package templates_test

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"goldx/internal/models"
	"goldx/internal/services"
)

func TestBinShihonDynamicCompanyAddressAndBuildingNo(t *testing.T) {
	tplPath := filepath.Join("..", "data", "templates", "invoices", "قالب_فاتورة_ذهب_بن_شيهون.html")
	raw, err := os.ReadFile(tplPath)
	if err != nil {
		t.Fatalf("read template: %v", err)
	}

	inv := &services.InvoiceView{
		Invoice: models.Invoice{
			InvoiceNumber: "INV-0001",
			IssueDate:     "2026-11-18",
			IssueTime:     "15:47:00",
			InvoiceType:   "STANDARD",
		},
		IssuerSnapshot: &models.Issuer{
			NameAr:             "شركة النخبة للذهب والمجوهرات",
			NameEn:             "Elite Gold & Jewelry Co.",
			TaxNumber:          "311243241900003",
			CommercialRegister: "4030999888",
			City:               "جدة",
			District:           "حي البلد",
			Street:             "شارع المنار",
			BuildingNo:         "405",
			PostalCode:         "22234",
			Phone:              "0500000000",
			Email:              "info@elitegold.sa",
		},
		ClientSnapshot: &models.Client{
			Name:       "شركة العميل",
			City:       "الرياض",
			District:   "حي الديرة",
			Street:     "شارع الثميري",
			BuildingNo: "77",
			PostalCode: "12634",
		},
	}

	svc := &services.TemplateService{}
	rendered := svc.SubstituteInvoiceTags(string(raw), inv)

	// Verify exact cell mapping so building_no never shows district
	assertCell := func(id, want string) {
		t.Helper()
		re := regexp.MustCompile(`id="` + regexp.QuoteMeta(id) + `">([^<]*)<`)
		m := re.FindStringSubmatch(rendered)
		if len(m) < 2 {
			t.Fatalf("cell %q not found in rendered HTML", id)
		}
		if strings.TrimSpace(m[1]) != want {
			t.Fatalf("cell %q = %q, want %q", id, m[1], want)
		}
	}

	assertCell("seller-name-cell", "شركة النخبة للذهب والمجوهرات")
	assertCell("seller-addr-reg", "جدة")
	assertCell("seller-addr-city", "جدة")
	assertCell("seller-addr-dist", "حي البلد")
	assertCell("seller-addr-street", "شارع المنار")
	assertCell("seller-addr-bno", "405")
	assertCell("seller-addr-post", "22234")

	for _, forbidden := range []string{
		"شركة عالم بن شيهون للصناعة",
		"مكة المكرمة",
		"الورود",
		"طريق الملك عبدالله",
		"4030535411",
		"311085830500003",
	} {
		if strings.Contains(rendered, forbidden) {
			t.Fatalf("rendered Bin Shihon invoice still contains hardcoded %q", forbidden)
		}
	}
}

func TestN1ToN8AddressAndLogoGrid(t *testing.T) {
	svc := &services.TemplateService{}
	invWithEn := &services.InvoiceView{
		Invoice: models.Invoice{
			InvoiceNumber: "INV-1001",
			IssueDate:     "2026-11-18",
			IssueTime:     "12:00:00",
			InvoiceType:   "STANDARD",
		},
		IssuerSnapshot: &models.Issuer{
			NameAr:             "شركة النخبة للذهب",
			NameEn:             "Elite Gold Co.",
			TaxNumber:          "310000000000003",
			CommercialRegister: "1010999888",
			City:               "الرياض",
			District:           "حي الديرة",
			Street:             "شارع الثميري",
			BuildingNo:         "102",
			PostalCode:         "12634",
			AddressEn:          "Riyadh - Al-Dirah Dist. - Al-Thumairi St. - Bldg. 102 - 12634",
		},
		ClientSnapshot: &models.Client{
			Name:       "عميل تجربة",
			City:       "جدة",
			District:   "حي البلد",
			Street:     "شارع قابل",
			BuildingNo: "45",
			PostalCode: "22234",
		},
	}

	invNoEn := &services.InvoiceView{
		Invoice: invWithEn.Invoice,
		IssuerSnapshot: &models.Issuer{
			NameAr:             "شركة النخبة للذهب",
			NameEn:             "Elite Gold Co.",
			TaxNumber:          "310000000000003",
			CommercialRegister: "1010999888",
			City:               "الرياض",
			District:           "حي الديرة",
			Street:             "شارع الثميري - سوق الذهب",
			BuildingNo:         "102",
			PostalCode:         "12634",
		},
		ClientSnapshot: invWithEn.ClientSnapshot,
	}

	for _, name := range []string{"n1.html", "n2.html", "n3.html", "n4.html", "n5.html", "n6.html", "n7.html", "n8.html"} {
		raw, err := os.ReadFile(filepath.Join("..", "data", "templates", "invoices", name))
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}

		outEn := svc.SubstituteInvoiceTags(string(raw), invWithEn)
		if !strings.Contains(outEn, "الرياض - حي الديرة - شارع الثميري - مبنى 102 - 12634") {
			t.Fatalf("%s missing Arabic seller address", name)
		}
		if !strings.Contains(outEn, "جدة - حي البلد - شارع قابل - مبنى 45 - 22234") {
			t.Fatalf("%s missing Arabic buyer address", name)
		}
		if strings.Contains(string(raw), "{{seller_address_en}}") && !strings.Contains(outEn, "Riyadh - Al-Dirah Dist. - Al-Thumairi St. - Bldg. 102 - 12634") {
			t.Fatalf("%s ignored explicit AddressEn", name)
		}

		outNoEn := svc.SubstituteInvoiceTags(string(raw), invNoEn)
		if strings.Contains(outNoEn, "الديرة Dist.") || (strings.Contains(outNoEn, "الثميري") && strings.Contains(outNoEn, "St.")) {
			t.Fatalf("%s leaked raw Arabic district/street into English address", name)
		}
	}
}
