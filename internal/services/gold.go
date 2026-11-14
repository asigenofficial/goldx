package services

import "errors"

func normalizeGoldInvoice(input *CreateInvoiceInput) error {
	if input.DiscountPercent < 0 || input.DiscountPercent > 100 {
		return errors.New("نسبة الخصم العام غير صالحة")
	}
	if input.GoldInvoiceType == "" {
		input.GoldInvoiceType = "PRICE_AND_WAGE"
	}
	if input.GoldInvoiceType != "PRICE_ONLY" && input.GoldInvoiceType != "WAGE_ONLY" && input.GoldInvoiceType != "PRICE_AND_WAGE" {
		return errors.New("نوع فاتورة الذهب غير صالح")
	}
	for i := range input.Lines {
		l := &input.Lines[i]
		if l.Discount == 0 && l.DiscountPercent == 0 && input.DiscountPercent > 0 {
			l.DiscountPercent = input.DiscountPercent
		}
		l.Unit = "جرام"
		switch input.GoldInvoiceType {
		case "PRICE_ONLY":
			l.Wage = 0
			if l.GramPrice == 0 {
				l.GramPrice = l.UnitPrice
			}
			l.UnitPrice = l.GramPrice
		case "WAGE_ONLY":
			l.GramPrice = 0
			if l.Wage == 0 {
				l.Wage = l.UnitPrice
			}
			l.UnitPrice = l.Wage
		default:
			if l.GramPrice == 0 && l.Wage == 0 {
				l.GramPrice = l.UnitPrice
			}
			l.UnitPrice = l.GramPrice + l.Wage
		}
	}
	return nil
}
