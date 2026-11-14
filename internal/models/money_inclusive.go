package models

import (
	"errors"
	"math"
	"math/big"
	"strconv"
	"strings"
)

// RatFromFloat converts a finite float64 using its exact shortest decimal representation
// into a *big.Rat so decimal fractions like 1.005 or 3600 / 1.15 never suffer IEEE-754 drift.
func RatFromFloat(v float64) *big.Rat {
	if math.IsNaN(v) || math.IsInf(v, 0) || v == 0 {
		return new(big.Rat)
	}
	s := strings.TrimSpace(strconv.FormatFloat(v, 'f', -1, 64))
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		return new(big.Rat).SetFloat64(v)
	}
	return r
}

// ratMinorHalfUp converts an exact rational value ALREADY expressed in minor units (halalas)
// into int64 using mathematical Round Half Up (half away from zero).
func ratMinorHalfUp(r *big.Rat) int64 {
	if r == nil || r.Sign() == 0 {
		return 0
	}
	sign := r.Sign()
	absR := new(big.Rat).Abs(r)
	num := new(big.Int).Set(absR.Num())
	den := absR.Denom()

	quo, rem := new(big.Int).QuoRem(num, den, new(big.Int))
	twoRem := new(big.Int).Lsh(rem, 1)
	if twoRem.Cmp(den) >= 0 {
		quo.Add(quo, big.NewInt(1))
	}
	res := quo.Int64()
	if sign < 0 {
		return -res
	}
	return res
}

// RatMajorToMinorHalfUp multiplies a rational major currency amount by 100 and rounds half-up to halalas.
func RatMajorToMinorHalfUp(major *big.Rat) int64 {
	if major == nil || major.Sign() == 0 {
		return 0
	}
	scaled := new(big.Rat).Mul(major, big.NewRat(MinorFactor, 1))
	return ratMinorHalfUp(scaled)
}

// RoundHalfUpMinor converts a major currency amount to integer minor units using Round Half Up.
func RoundHalfUpMinor(major float64) int64 {
	return RatMajorToMinorHalfUp(RatFromFloat(major))
}

func mulQtyMinorHalfUp(qty float64, unitPriceMinor int64) int64 {
	r := new(big.Rat).Mul(RatFromFloat(qty), big.NewRat(unitPriceMinor, 1))
	return ratMinorHalfUp(r)
}

func pctMinorHalfUp(amountMinor int64, ratePercent float64) int64 {
	rateFrac := new(big.Rat).Quo(RatFromFloat(ratePercent), big.NewRat(100, 1))
	r := new(big.Rat).Mul(big.NewRat(amountMinor, 1), rateFrac)
	return ratMinorHalfUp(r)
}

func netFromInclusiveMinor(inclusiveMinor int64, ratePercent float64) int64 {
	if ratePercent <= 0 {
		return inclusiveMinor
	}
	rateFrac := new(big.Rat).Quo(RatFromFloat(ratePercent), big.NewRat(100, 1))
	divisor := new(big.Rat).Add(big.NewRat(1, 1), rateFrac)
	r := new(big.Rat).Quo(big.NewRat(inclusiveMinor, 1), divisor)
	return ratMinorHalfUp(r)
}

func minorRatErr(actual int64, exactMinor *big.Rat) *big.Rat {
	diff := new(big.Rat).Sub(big.NewRat(actual, 1), exactMinor)
	return diff.Abs(diff)
}

// LineAmounts holds both tax-exclusive (ZATCA/accounting) and original tax-inclusive halala amounts
// for a single invoice line.
type LineAmounts struct {
	GramPriceNet  int64
	WageNet       int64
	UnitPriceNet  int64
	DiscountNet   int64
	GramPriceIncl int64
	WageIncl      int64
	UnitPriceIncl int64
	DiscountIncl  int64
	GrossNet      int64
	Taxable       int64
	TaxAmount     int64
	TotalLine     int64
}

// ComputeInvoiceLineAmounts calculates exact line amounts for tax-exclusive or tax-inclusive pricing.
//
// In tax-inclusive mode (e.g. qty=1 price=3600 at 15%, or qty=5 price=6315 at 15%):
//  1. Total_Inclusive = qty * inclusive_unit_price - inclusive_discount (unrounded exact decimal)
//  2. Taxable_Exact   = Total_Inclusive / (1 + rate/100)
//  3. Tax_Exact       = Taxable_Exact * (rate/100)
//  4. Final Taxable, TaxAmount, and TotalLine are rounded Half-Up to 2 decimals with zero halala loss.
func ComputeInvoiceLineAmounts(qty, gramPrice, wage, unitPrice, discount, discountPercent, taxRate float64, pricesIncludeTax bool) (LineAmounts, error) {
	var out LineAmounts

	rawUnit := unitPrice
	if rawUnit == 0 && (gramPrice > 0 || wage > 0) {
		rawUnit = gramPrice + wage
	}

	if !pricesIncludeTax {
		gramNet := RoundHalfUpMinor(gramPrice)
		wageNet := RoundHalfUpMinor(wage)
		unitNet := RoundHalfUpMinor(rawUnit)
		gross := MulQty(qty, unitNet)

		discMinor := RoundHalfUpMinor(discount)
		if discountPercent > 0 {
			discMinor = Pct(gross, discountPercent)
		}
		if discMinor > gross {
			return out, errors.New("الخصم يتجاوز قيمة البند")
		}
		taxable := gross - discMinor
		taxAmt := Pct(taxable, taxRate)
		out.GramPriceNet = gramNet
		out.WageNet = wageNet
		out.UnitPriceNet = unitNet
		out.DiscountNet = discMinor
		out.GrossNet = gross
		out.Taxable = taxable
		out.TaxAmount = taxAmt
		out.TotalLine = taxable + taxAmt
		return out, nil
	}

	qtyRat := RatFromFloat(qty)
	inclUnitRat := RatFromFloat(rawUnit)
	inclGrossRat := new(big.Rat).Mul(qtyRat, inclUnitRat)

	var inclDiscRat *big.Rat
	if discountPercent > 0 {
		pctFrac := new(big.Rat).Quo(RatFromFloat(discountPercent), big.NewRat(100, 1))
		inclDiscRat = new(big.Rat).Mul(inclGrossRat, pctFrac)
	} else {
		inclDiscRat = RatFromFloat(discount)
	}
	if inclDiscRat.Cmp(inclGrossRat) > 0 {
		return out, errors.New("الخصم يتجاوز قيمة البند")
	}

	inclTotalRat := new(big.Rat).Sub(inclGrossRat, inclDiscRat)
	totalLine := RatMajorToMinorHalfUp(inclTotalRat)

	out.UnitPriceIncl = RatMajorToMinorHalfUp(inclUnitRat)
	out.DiscountIncl = RatMajorToMinorHalfUp(inclDiscRat)
	out.GramPriceIncl = RatMajorToMinorHalfUp(RatFromFloat(gramPrice))
	out.WageIncl = RatMajorToMinorHalfUp(RatFromFloat(wage))

	if taxRate <= 0 {
		out.UnitPriceNet = out.UnitPriceIncl
		out.GramPriceNet = out.GramPriceIncl
		out.WageNet = out.WageIncl
		out.DiscountNet = out.DiscountIncl
		out.TaxAmount = 0
		out.Taxable = totalLine
		out.GrossNet = out.Taxable + out.DiscountNet
		out.TotalLine = totalLine
		return out, nil
	}

	rateFrac := new(big.Rat).Quo(RatFromFloat(taxRate), big.NewRat(100, 1))
	divisor := new(big.Rat).Add(big.NewRat(1, 1), rateFrac)

	taxableExactRat := new(big.Rat).Quo(inclTotalRat, divisor)
	taxExactRat := new(big.Rat).Mul(taxableExactRat, rateFrac)

	taxableMinor := RatMajorToMinorHalfUp(taxableExactRat)
	taxMinor := RatMajorToMinorHalfUp(taxExactRat)

	// Reconcile the rare sub-halala weight boundary carry (when inclTotal has >2 decimals)
	// so Taxable + TaxAmount == TotalLine always holds for ZATCA and print reconciliation.
	if diff := totalLine - (taxableMinor + taxMinor); diff != 0 {
		hundred := big.NewRat(MinorFactor, 1)
		taxableExactMinor := new(big.Rat).Mul(taxableExactRat, hundred)
		taxExactMinor := new(big.Rat).Mul(taxExactRat, hundred)

		candTax := taxMinor + diff
		candTaxable := taxableMinor + diff
		if candTax < 0 {
			taxableMinor = candTaxable
		} else if candTaxable < 0 {
			taxMinor = candTax
		} else {
			errTaxAdj := new(big.Rat).Add(minorRatErr(taxableMinor, taxableExactMinor), minorRatErr(candTax, taxExactMinor))
			errTaxableAdj := new(big.Rat).Add(minorRatErr(candTaxable, taxableExactMinor), minorRatErr(taxMinor, taxExactMinor))
			if errTaxableAdj.Cmp(errTaxAdj) < 0 {
				taxableMinor = candTaxable
			} else {
				taxMinor = candTax
			}
		}
	}

	discNet := RatMajorToMinorHalfUp(new(big.Rat).Quo(inclDiscRat, divisor))
	unitNet := RatMajorToMinorHalfUp(new(big.Rat).Quo(inclUnitRat, divisor))
	gramNet := RatMajorToMinorHalfUp(new(big.Rat).Quo(RatFromFloat(gramPrice), divisor))
	wageNet := RatMajorToMinorHalfUp(new(big.Rat).Quo(RatFromFloat(wage), divisor))

	if gramPrice > 0 && wage > 0 && gramNet+wageNet != unitNet && unitNet >= gramNet {
		wageNet = unitNet - gramNet
	} else if gramPrice > 0 && wage == 0 {
		gramNet = unitNet
	} else if wage > 0 && gramPrice == 0 {
		wageNet = unitNet
	}

	out.GramPriceNet = gramNet
	out.WageNet = wageNet
	out.UnitPriceNet = unitNet
	out.DiscountNet = discNet
	out.GrossNet = taxableMinor + discNet
	out.Taxable = taxableMinor
	out.TaxAmount = taxMinor
	out.TotalLine = totalLine
	return out, nil
}
