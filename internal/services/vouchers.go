package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"goldx/internal/crypto"
	"goldx/internal/db"
	"goldx/internal/models"
)

type VoucherService struct {
	db      *db.DB
	issuers *IssuerService
}

func NewVoucherService(d *db.DB, iss *IssuerService) *VoucherService {
	return &VoucherService{db: d, issuers: iss}
}

type VoucherAllocationInput struct {
	InvoiceID string  `json:"invoice_id"`
	Amount    float64 `json:"amount"`
}

type CreateVoucherInput struct {
	IssuerID     string                   `json:"issuer_id"`
	ClientID     string                   `json:"client_id"`
	VoucherDate  string                   `json:"voucher_date"`
	TotalAmount  float64                  `json:"total_amount"`
	PaymentType  string                   `json:"payment_type"`
	ReferenceNo  string                   `json:"reference_no"`
	Notes        string                   `json:"notes"`
	AutoAllocate bool                     `json:"auto_allocate"`
	Allocations  []VoucherAllocationInput `json:"allocations"`
}

type UpdateVoucherInput struct {
	VoucherNumber string `json:"voucher_number"`
	VoucherDate   string `json:"voucher_date"`
	PaymentType   string `json:"payment_type"`
	ReferenceNo   string `json:"reference_no"`
	Notes         string `json:"notes"`
}

type VoucherView struct {
	ID             string                  `json:"id"`
	VoucherNumber  string                  `json:"voucher_number"`
	IssuerID       string                  `json:"issuer_id"`
	IssuerName     string                  `json:"issuer_name"`
	ClientID       string                  `json:"client_id"`
	ClientName     string                  `json:"client_name"`
	ClientCode     string                  `json:"client_code"`
	VoucherDate    string                  `json:"voucher_date"`
	TotalAmount    float64                 `json:"total_amount"`
	AllocatedTotal float64                 `json:"allocated_total"`
	Unallocated    float64                 `json:"unallocated"`
	PaymentType    string                  `json:"payment_type"`
	PaymentLabel   string                  `json:"payment_label"`
	ReferenceNo    string                  `json:"reference_no"`
	Notes          string                  `json:"notes"`
	Status         string                  `json:"status"`
	StatusLabel    string                  `json:"status_label"`
	CreatedBy      string                  `json:"created_by"`
	CreatedAt      string                  `json:"created_at"`
	UpdatedAt      string                  `json:"updated_at"`
	Allocations    []VoucherAllocationView `json:"allocations"`
}

type VoucherAllocationView struct {
	ID               string  `json:"id"`
	InvoiceID        string  `json:"invoice_id"`
	InvoiceNumber    string  `json:"invoice_number"`
	IssueDate        string  `json:"issue_date"`
	AllocatedAmount  float64 `json:"allocated_amount"`
	InvoiceTotal     float64 `json:"invoice_total"`
	InvoicePaid      float64 `json:"invoice_paid"`
	InvoiceRemaining float64 `json:"invoice_remaining"`
	InvoiceStatus    string  `json:"invoice_status"`
}

var paymentLabels = map[string]string{
	"CASH":     "نقداً",
	"TRANSFER": "تحويل بنكي",
	"CHEQUE":   "شيك",
	"CARD":     "شبكة",
}

func (s *VoucherService) CreateVoucher(input CreateVoucherInput, actor, ip string) (*VoucherView, error) {
	if input.IssuerID == "" || input.ClientID == "" {
		return nil, errors.New("المنشأة المصدرة والعميل مطلوبان")
	}
	if !validAmount(input.TotalAmount) || models.ToMinor(input.TotalAmount) <= 0 {
		return nil, errors.New("مبلغ السند يجب أن يكون أكبر من الصفر")
	}

	totalAmountMinor := models.ToMinor(input.TotalAmount)
	voucherDate := input.VoucherDate
	if voucherDate == "" {
		voucherDate = db.TodayIso()
	}
	paymentType := input.PaymentType
	if paymentType == "" {
		paymentType = "CASH"
	}
	if _, err := time.Parse("2006-01-02", voucherDate); err != nil {
		return nil, errors.New("تاريخ السند غير صالح")
	}
	if _, ok := paymentLabels[paymentType]; !ok {
		return nil, errors.New("طريقة السداد غير صالحة")
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	voucherNumber, _, err := s.issuers.NextVoucherNumber(tx, input.IssuerID)
	if err != nil {
		return nil, err
	}

	voucherID := crypto.UUID()
	now := db.NowIso()

	// Process Allocations
	type allocItem struct {
		invoiceID string
		amount    int64
	}
	var finalAllocations []allocItem
	var allocatedTotalMinor int64

	if len(input.Allocations) > 0 {
		seen := map[string]bool{}
		for _, a := range input.Allocations {
			amt := models.ToMinor(a.Amount)
			if !validAmount(a.Amount) || amt <= 0 || a.InvoiceID == "" || seen[a.InvoiceID] {
				return nil, errors.New("تخصيص غير صالح أو فاتورة مكررة")
			}
			seen[a.InvoiceID] = true
			if amt > totalAmountMinor-allocatedTotalMinor {
				return nil, errors.New("مجموع التخصيصات يتجاوز مبلغ السند")
			}
			finalAllocations = append(finalAllocations, allocItem{invoiceID: a.InvoiceID, amount: amt})
			allocatedTotalMinor += amt
		}
	} else if input.AutoAllocate {
		// FIFO oldest unpaid invoices first
		rows, err := tx.Query(`
			SELECT id, remaining_amount FROM invoices
			WHERE client_id = ? AND issuer_id = ? AND status IN ('UNPAID', 'PARTIAL')
			ORDER BY issue_date ASC, sequence_no ASC
		`, input.ClientID, input.IssuerID)
		if err != nil {
			return nil, err
		}
		{
			defer rows.Close()
			remBudget := totalAmountMinor
			for rows.Next() && remBudget > 0 {
				var invID string
				var invRem int64
				if err := rows.Scan(&invID, &invRem); err == nil {
					take := remBudget
					if take > invRem {
						take = invRem
					}
					finalAllocations = append(finalAllocations, allocItem{invoiceID: invID, amount: take})
					remBudget -= take
					allocatedTotalMinor += take
				}
			}
			if err := rows.Err(); err != nil {
				return nil, err
			}
			if err := rows.Close(); err != nil {
				return nil, err
			}
		}
	}
	for _, a := range finalAllocations {
		var remaining int64
		if err := tx.QueryRow("SELECT remaining_amount FROM invoices WHERE id=? AND issuer_id=? AND client_id=? AND status IN ('UNPAID','PARTIAL')", a.invoiceID, input.IssuerID, input.ClientID).Scan(&remaining); err != nil || a.amount > remaining {
			return nil, errors.New("الفاتورة لا تخص الشركة والعميل أو أن التخصيص يتجاوز المتبقي")
		}
	}

	_, err = tx.Exec(`
		INSERT INTO receipt_vouchers (
			id, voucher_number, issuer_id, client_id, voucher_date,
			total_amount, allocated_total, payment_type, reference_no, notes,
			status, created_by, created_at, updated_at
		) VALUES (
			?, ?, ?, ?, ?,
			?, ?, ?, ?, ?,
			'ACTIVE', ?, ?, ?
		)
	`,
		voucherID, voucherNumber, input.IssuerID, input.ClientID, voucherDate,
		totalAmountMinor, allocatedTotalMinor, paymentType, input.ReferenceNo, input.Notes,
		actor, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to insert voucher: %w", err)
	}

	// Apply allocations to invoices
	for _, a := range finalAllocations {
		_, err = tx.Exec(`
			INSERT INTO voucher_allocations (id, voucher_id, invoice_id, allocated_amount, created_at)
			VALUES (?, ?, ?, ?, ?)
		`, crypto.UUID(), voucherID, a.invoiceID, a.amount, now)
		if err != nil {
			return nil, err
		}

		// Update invoice
		var grandTotal, paidAmount int64
		if err = tx.QueryRow("SELECT grand_total, paid_amount FROM invoices WHERE id = ?", a.invoiceID).Scan(&grandTotal, &paidAmount); err != nil {
			return nil, err
		}
		newPaid := paidAmount + a.amount
		newRem := grandTotal - newPaid
		if newRem < 0 {
			newRem = 0
		}
		newStatus := "PARTIAL"
		if newRem == 0 {
			newStatus = "PAID"
		}

		_, err = tx.Exec(`
			UPDATE invoices SET paid_amount = ?, remaining_amount = ?, status = ?, updated_at = ?
			WHERE id = ?
		`, newPaid, newRem, newStatus, now, a.invoiceID)
		if err != nil {
			return nil, err
		}
	}

	// Post credit entry in client_ledger
	_, err = tx.Exec(`
		INSERT INTO client_ledger (
			id, client_id, issuer_id, doc_type, doc_id, doc_number,
			transaction_date, debit, credit, description, created_at
		) VALUES (
			?, ?, ?, 'RECEIPT', ?, ?,
			?, 0, ?, ?, ?
		)
	`, crypto.UUID(), input.ClientID, input.IssuerID, voucherID, voucherNumber, voucherDate, totalAmountMinor, fmt.Sprintf("سند قبض رقم %s", voucherNumber), now)
	if err != nil {
		return nil, fmt.Errorf("failed to post voucher ledger entry: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	s.db.Audit(actor, "VOUCHER_CREATE", "voucher", voucherID, input.IssuerID, map[string]any{
		"voucher_number": voucherNumber,
		"amount":         input.TotalAmount,
	}, ip)

	return s.GetVoucher(voucherID)
}

func (s *VoucherService) GetVoucher(id string) (*VoucherView, error) {
	var idVal, vNum, issID, clientID, vDate, pType, refNo, notes, status, createdBy, createdAt, updatedAt, issName, clientName, clientCode string
	var totalAmt, allocTotal int64
	err := s.db.QueryRow(`
		SELECT v.id, v.voucher_number, v.issuer_id, v.client_id, v.voucher_date,
		       v.total_amount, v.allocated_total, v.payment_type, v.reference_no, v.notes,
		       v.status, v.created_by, v.created_at, v.updated_at,
		       s.name_ar, c.name, c.client_code
		FROM receipt_vouchers v
		JOIN issuers s ON s.id = v.issuer_id
		JOIN clients c ON c.id = v.client_id
		WHERE v.id = ?
	`, id).Scan(
		&idVal, &vNum, &issID, &clientID, &vDate,
		&totalAmt, &allocTotal, &pType, &refNo, &notes,
		&status, &createdBy, &createdAt, &updatedAt,
		&issName, &clientName, &clientCode,
	)
	if err != nil {
		return nil, errors.New("سند القبض غير موجود")
	}

	pLabel := paymentLabels[pType]
	sLabel := "نشط"
	if status == "CANCELLED" {
		sLabel = "ملغى"
	}

	totalMajor := models.ToMajor(totalAmt)
	allocMajor := models.ToMajor(allocTotal)
	unallocMajor := models.ToMajor(totalAmt - allocTotal)

	view := &VoucherView{
		ID:             idVal,
		VoucherNumber:  vNum,
		IssuerID:       issID,
		IssuerName:     issName,
		ClientID:       clientID,
		ClientName:     clientName,
		ClientCode:     clientCode,
		VoucherDate:    vDate,
		TotalAmount:    totalMajor,
		AllocatedTotal: allocMajor,
		Unallocated:    unallocMajor,
		PaymentType:    pType,
		PaymentLabel:   pLabel,
		ReferenceNo:    refNo,
		Notes:          notes,
		Status:         status,
		StatusLabel:    sLabel,
		CreatedBy:      createdBy,
		CreatedAt:      createdAt,
		UpdatedAt:      updatedAt,
		Allocations:    make([]VoucherAllocationView, 0),
	}

	// Allocations
	rows, err := s.db.Query(`
		SELECT a.id, a.invoice_id, a.allocated_amount, i.invoice_number, i.issue_date,
		       i.grand_total, i.paid_amount, i.remaining_amount, i.status
		FROM voucher_allocations a
		JOIN invoices i ON i.id = a.invoice_id
		WHERE a.voucher_id = ?
	`, id)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var av VoucherAllocationView
			var allocMinor, totalMinor, paidMinor, remMinor int64
			if err := rows.Scan(
				&av.ID, &av.InvoiceID, &allocMinor, &av.InvoiceNumber, &av.IssueDate,
				&totalMinor, &paidMinor, &remMinor, &av.InvoiceStatus,
			); err == nil {
				av.AllocatedAmount = models.ToMajor(allocMinor)
				av.InvoiceTotal = models.ToMajor(totalMinor)
				av.InvoicePaid = models.ToMajor(paidMinor)
				av.InvoiceRemaining = models.ToMajor(remMinor)
				view.Allocations = append(view.Allocations, av)
			}
		}
	}

	return view, nil
}

type ListVouchersFilter struct {
	IssuerID    string
	ClientID    string
	Status      string
	PaymentType string
	FromDate    string
	ToDate      string
	MinAmount   float64
	MaxAmount   float64
	Search      string
	Page        int
	Limit       int
	Offset      int
}

type VoucherTotals struct {
	TotalAmount      float64 `json:"total_amount"`
	AllocatedTotal   float64 `json:"allocated_total"`
	UnallocatedTotal float64 `json:"unallocated_total"`
}

type ListVouchersResult struct {
	Items      []VoucherView `json:"items"`
	TotalCount int           `json:"total_count"`
	Total      int           `json:"total"`
	Page       int           `json:"page"`
	Limit      int           `json:"limit"`
	Totals     VoucherTotals `json:"totals"`
}

func (s *VoucherService) ListVouchers(f ListVouchersFilter) (*ListVouchersResult, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = 50
	}
	offset := f.Offset
	if offset <= 0 && f.Page > 1 {
		offset = (f.Page - 1) * limit
	}

	where := `WHERE 1=1`
	var args []any

	if f.IssuerID != "" {
		where += ` AND v.issuer_id = ?`
		args = append(args, f.IssuerID)
	}
	if f.ClientID != "" {
		where += ` AND v.client_id = ?`
		args = append(args, f.ClientID)
	}
	if f.Status != "" {
		where += ` AND v.status = ?`
		args = append(args, f.Status)
	}
	if f.PaymentType != "" {
		where += ` AND v.payment_type = ?`
		args = append(args, f.PaymentType)
	}
	if f.FromDate != "" {
		where += ` AND v.voucher_date >= ?`
		args = append(args, f.FromDate)
	}
	if f.ToDate != "" {
		where += ` AND v.voucher_date <= ?`
		args = append(args, f.ToDate)
	}
	if f.MinAmount > 0 {
		where += ` AND v.total_amount >= ?`
		args = append(args, models.ToMinor(f.MinAmount))
	}
	if f.MaxAmount > 0 {
		where += ` AND v.total_amount <= ?`
		args = append(args, models.ToMinor(f.MaxAmount))
	}
	if f.Search != "" {
		where += ` AND (v.voucher_number LIKE ? OR c.name LIKE ? OR c.client_code LIKE ? OR v.reference_no LIKE ? OR v.notes LIKE ?)`
		like := "%" + f.Search + "%"
		args = append(args, like, like, like, like, like)
	}

	totalsQuery := fmt.Sprintf(`
		SELECT COUNT(*),
		       COALESCE(SUM(v.total_amount), 0),
		       COALESCE(SUM(v.allocated_total), 0)
		FROM receipt_vouchers v
		JOIN issuers s ON s.id = v.issuer_id
		JOIN clients c ON c.id = v.client_id
		%s
	`, where)

	var totalCount int
	var sumTotalMinor, sumAllocMinor int64
	_ = s.db.QueryRow(totalsQuery, args...).Scan(&totalCount, &sumTotalMinor, &sumAllocMinor)

	sumTotal := models.ToMajor(sumTotalMinor)
	sumAlloc := models.ToMajor(sumAllocMinor)
	sumUnalloc := models.ToMajor(sumTotalMinor - sumAllocMinor)

	query := fmt.Sprintf(`
		SELECT v.id, v.voucher_number, v.issuer_id, v.client_id, v.voucher_date,
		       v.total_amount, v.allocated_total, v.payment_type, v.reference_no, v.notes,
		       v.status, v.created_by, v.created_at, v.updated_at,
		       s.name_ar, c.name, c.client_code
		FROM receipt_vouchers v
		JOIN issuers s ON s.id = v.issuer_id
		JOIN clients c ON c.id = v.client_id
		%s
		ORDER BY v.voucher_date DESC, v.created_at DESC
		LIMIT ? OFFSET ?
	`, where)

	queryArgs := append(args, limit, offset)
	rows, err := s.db.Query(query, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	page := f.Page
	if page <= 0 {
		page = (offset / limit) + 1
	}

	res := &ListVouchersResult{
		Items:      make([]VoucherView, 0),
		TotalCount: totalCount,
		Total:      totalCount,
		Page:       page,
		Limit:      limit,
		Totals: VoucherTotals{
			TotalAmount:      sumTotal,
			AllocatedTotal:   sumAlloc,
			UnallocatedTotal: sumUnalloc,
		},
	}

	for rows.Next() {
		var idVal, vNum, issID, clientID, vDate, pType, refNo, notes, status, createdBy, createdAt, updatedAt, issName, clientName, clientCode string
		var totalAmt, allocTotal int64
		if err := rows.Scan(
			&idVal, &vNum, &issID, &clientID, &vDate,
			&totalAmt, &allocTotal, &pType, &refNo, &notes,
			&status, &createdBy, &createdAt, &updatedAt,
			&issName, &clientName, &clientCode,
		); err == nil {
			pLabel := paymentLabels[pType]
			sLabel := "نشط"
			if status == "CANCELLED" {
				sLabel = "ملغى"
			}
			totMaj := models.ToMajor(totalAmt)
			allocMaj := models.ToMajor(allocTotal)
			unallocMaj := models.ToMajor(totalAmt - allocTotal)

			view := VoucherView{
				ID:             idVal,
				VoucherNumber:  vNum,
				IssuerID:       issID,
				IssuerName:     issName,
				ClientID:       clientID,
				ClientName:     clientName,
				ClientCode:     clientCode,
				VoucherDate:    vDate,
				TotalAmount:    totMaj,
				AllocatedTotal: allocMaj,
				Unallocated:    unallocMaj,
				PaymentType:    pType,
				PaymentLabel:   pLabel,
				ReferenceNo:    refNo,
				Notes:          notes,
				Status:         status,
				StatusLabel:    sLabel,
				CreatedBy:      createdBy,
				CreatedAt:      createdAt,
				UpdatedAt:      updatedAt,
			}
			res.Items = append(res.Items, view)
		}
	}

	return res, nil
}

func (s *VoucherService) CancelVoucher(id, actor, ip string) error {
	v, err := s.GetVoucher(id)
	if err != nil {
		return err
	}
	if v.Status == "CANCELLED" {
		return errors.New("سند القبض ملغى بالفعل")
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := db.NowIso()
	result, err := tx.Exec("UPDATE receipt_vouchers SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND status = 'ACTIVE'", now, id)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return errors.New("سند القبض ملغى بالفعل")
	}

	// Rollback allocations from invoices
	for _, a := range v.Allocations {
		allocMinor := models.ToMinor(a.AllocatedAmount)
		var grandTotal, paidAmount int64
		var status string
		if err := tx.QueryRow("SELECT grand_total, paid_amount, status FROM invoices WHERE id = ?", a.InvoiceID).Scan(&grandTotal, &paidAmount, &status); err != nil {
			return err
		}
		newPaid := paidAmount - allocMinor
		if newPaid < 0 {
			return errors.New("السدادات الحالية لا تطابق التخصيصات؛ يلزم مراجعة السند")
		}
		newRem := grandTotal - newPaid
		newStatus := "UNPAID"
		if newPaid > 0 && newRem > 0 {
			newStatus = "PARTIAL"
		} else if newPaid >= grandTotal {
			newStatus = "PAID"
		}

		if status == "CANCELLED" {
			newStatus = "CANCELLED"
		}
		_, err = tx.Exec(`
			UPDATE invoices SET paid_amount = ?, remaining_amount = ?, status = ?, updated_at = ?,
			payment_method = CASE WHEN payment_method = 'CASH' AND ? > 0 THEN 'CREDIT' ELSE payment_method END
			WHERE id = ?
		`, newPaid, newRem, newStatus, now, newRem, a.InvoiceID)
		if err != nil {
			return err
		}
	}

	// Reverse entry in client_ledger
	totalAmountMinor := models.ToMinor(v.TotalAmount)
	_, err = tx.Exec(`
		INSERT INTO client_ledger (
			id, client_id, issuer_id, doc_type, doc_id, doc_number,
			transaction_date, debit, credit, description, created_at
		) VALUES (
			?, ?, ?, 'RECEIPT_CANCEL', ?, ?,
			?, ?, 0, ?, ?
		)
	`, crypto.UUID(), v.ClientID, v.IssuerID, v.ID, v.VoucherNumber, db.TodayIso(), totalAmountMinor, fmt.Sprintf("إلغاء سند قبض رقم %s", v.VoucherNumber), now)
	if err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	s.db.Audit(actor, "VOUCHER_CANCEL", "voucher", id, v.IssuerID, map[string]any{
		"voucher_number": v.VoucherNumber,
		"amount":         v.TotalAmount,
	}, ip)

	return nil
}

// UpdateVoucher يعدّل حقول السند (رقم السند، التاريخ، طريقة السداد، المرجع، الملاحظات)
func (s *VoucherService) UpdateVoucher(id string, input UpdateVoucherInput, actor, ip string) (*VoucherView, error) {
	v, err := s.GetVoucher(id)
	if err != nil {
		return nil, errors.New("سند القبض غير موجود")
	}
	if v.Status == "CANCELLED" {
		return nil, errors.New("لا يمكن تعديل سند ملغى")
	}

	// التحقق من رقم السند
	newNumber := strings.TrimSpace(input.VoucherNumber)
	if newNumber == "" {
		newNumber = v.VoucherNumber
	}
	if newNumber != v.VoucherNumber {
		var exists int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM receipt_vouchers WHERE issuer_id = ? AND voucher_number = ? AND id != ?`, v.IssuerID, newNumber, id).Scan(&exists)
		if exists > 0 {
			return nil, errors.New("رقم السند مستخدم بالفعل لدى هذه المنشأة")
		}
	}

	// تطبيق القيم أو الإبقاء على الحالية
	newDate := input.VoucherDate
	if newDate == "" {
		newDate = v.VoucherDate
	}
	if _, err2 := time.Parse("2006-01-02", newDate); err2 != nil {
		return nil, errors.New("تاريخ السند غير صالح")
	}
	newPayment := input.PaymentType
	if newPayment == "" {
		newPayment = v.PaymentType
	}
	if _, ok := paymentLabels[newPayment]; !ok {
		return nil, errors.New("طريقة السداد غير صالحة")
	}

	now := db.NowIso()
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`
		UPDATE receipt_vouchers
		SET voucher_number = ?, voucher_date = ?, payment_type = ?, reference_no = ?, notes = ?, updated_at = ?
		WHERE id = ?`,
		newNumber, newDate, newPayment, input.ReferenceNo, input.Notes, now, id)
	if err != nil {
		return nil, err
	}

	// تحديث قيد كشف الحساب (تاريخ المستند ورقم السند والبيان)
	ledgerDesc := fmt.Sprintf("سند قبض رقم %s", newNumber)
	if _, err = tx.Exec(`UPDATE client_ledger SET transaction_date = ?, doc_number = ?, description = ? WHERE doc_id = ? AND doc_type = 'RECEIPT'`, newDate, newNumber, ledgerDesc, id); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}

	s.db.Audit(actor, "VOUCHER_UPDATE", "voucher", id, v.IssuerID, map[string]any{
		"old_voucher_number": v.VoucherNumber,
		"voucher_number":     newNumber,
		"payment_type":       newPayment,
		"voucher_date":       newDate,
	}, ip)

	return s.GetVoucher(id)
}

func (s *VoucherService) DeleteVoucher(id, actor, ip string) error {
	v, err := s.GetVoucher(id)
	if err != nil {
		return err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// If voucher is active, rollback allocations from invoices first
	if v.Status == "ACTIVE" {
		now := db.NowIso()
		for _, a := range v.Allocations {
			allocMinor := models.ToMinor(a.AllocatedAmount)
			var grandTotal, paidAmount int64
			var status string
			if err := tx.QueryRow("SELECT grand_total, paid_amount, status FROM invoices WHERE id = ?", a.InvoiceID).Scan(&grandTotal, &paidAmount, &status); err != nil {
				return err
			}
			newPaid := paidAmount - allocMinor
			if newPaid < 0 {
				return errors.New("السدادات الحالية لا تطابق التخصيصات؛ يلزم مراجعة السند")
			}
			newRem := grandTotal - newPaid
			newStatus := "UNPAID"
			if newPaid > 0 && newRem > 0 {
				newStatus = "PARTIAL"
			} else if newPaid >= grandTotal {
				newStatus = "PAID"
			}
			if status == "CANCELLED" {
				newStatus = "CANCELLED"
			}
			_, err = tx.Exec(`
				UPDATE invoices SET paid_amount = ?, remaining_amount = ?, status = ?, updated_at = ?,
				payment_method = CASE WHEN payment_method = 'CASH' AND ? > 0 THEN 'CREDIT' ELSE payment_method END
				WHERE id = ?
			`, newPaid, newRem, newStatus, now, newRem, a.InvoiceID)
			if err != nil {
				return err
			}
		}
	}

	// Remove ledger entries for this voucher (both RECEIPT and RECEIPT_CANCEL)
	if _, err = tx.Exec("DELETE FROM client_ledger WHERE doc_id = ? AND doc_type IN ('RECEIPT', 'RECEIPT_CANCEL')", id); err != nil {
		return err
	}
	if _, err = tx.Exec("DELETE FROM document_pdfs WHERE kind='voucher' AND document_id=?", id); err != nil {
		return err
	}

	// Delete voucher record completely from receipt_vouchers
	result, err := tx.Exec("DELETE FROM receipt_vouchers WHERE id = ?", id)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n == 0 {
		return errors.New("سند القبض غير موجود أو تم حذفه مسبقاً")
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	s.db.Audit(actor, "VOUCHER_DELETE", "voucher", id, v.IssuerID, map[string]any{
		"voucher_number": v.VoucherNumber,
		"amount":         v.TotalAmount,
	}, ip)

	return nil
}

// Bound monetary inputs before conversion, arithmetic and accumulation.
func validAmount(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0 && v <= 1e12 }

type GoldReceiptLine struct {
	Karat  string  `json:"karat"`
	Weight float64 `json:"weight"`
}
type CreateGoldReceiptInput struct {
	InvoiceID string            `json:"invoice_id"`
	Kind      string            `json:"kind"`
	GoldPrice float64           `json:"gold_price"`
	Lines     []GoldReceiptLine `json:"lines"`
	Notes     string            `json:"notes"`
}
type GoldReceipt struct {
	ID            string            `json:"id"`
	VoucherNumber string            `json:"voucher_number"`
	IssuerID      string            `json:"issuer_id"`
	ClientID      string            `json:"client_id"`
	InvoiceID     string            `json:"invoice_id"`
	InvoiceNumber string            `json:"invoice_number"`
	VoucherDate   string            `json:"voucher_date"`
	Kind          string            `json:"kind"`
	TotalWeight   float64           `json:"total_weight"`
	GoldPrice     float64           `json:"gold_price"`
	InvoiceTotal  float64           `json:"invoice_total"`
	Lines         []GoldReceiptLine `json:"lines"`
	Notes         string            `json:"notes"`
	Status        string            `json:"status"`
	IssuerName    string            `json:"issuer_name"`
	ClientName    string            `json:"client_name"`
}

func goldWeight(total, price int64) (float64, error) {
	if total <= 0 || price <= 0 {
		return 0, errors.New("إجمالي الفاتورة وسعر جرام الذهب يجب أن يكونا أكبر من الصفر")
	}
	weight := math.Round(float64(total)/float64(price)*1000) / 1000
	if weight <= 0 || weight > 1e9 {
		return 0, errors.New("وزن الذهب خارج النطاق المسموح")
	}
	return weight, nil
}

func (s *VoucherService) CreateGoldReceipt(input CreateGoldReceiptInput, actor, ip string) (*GoldReceipt, error) {
	if input.Kind != "METAL" && input.Kind != "WAGES" {
		return nil, errors.New("اختر قبض كسر أو قبض أجور بالذهب")
	}
	if !validAmount(input.GoldPrice) {
		return nil, errors.New("سعر الذهب غير صالح")
	}
	s.db.WriteLock()
	defer s.db.WriteUnlock()
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	v := GoldReceipt{ID: crypto.UUID(), InvoiceID: input.InvoiceID, Kind: input.Kind, Notes: strings.TrimSpace(input.Notes), Status: "ACTIVE"}
	var total int64
	var status string
	err = tx.QueryRow(`SELECT issuer_id,client_id,invoice_number,issue_date,grand_total,status FROM invoices WHERE id=?`, input.InvoiceID).Scan(&v.IssuerID, &v.ClientID, &v.InvoiceNumber, &v.VoucherDate, &total, &status)
	if err != nil {
		return nil, errors.New("الفاتورة غير موجودة")
	}
	if status == "CANCELLED" {
		return nil, errors.New("لا يمكن قبض ذهب لفاتورة ملغاة")
	}
	v.InvoiceTotal = models.ToMajor(total)
	price := models.ToMinor(input.GoldPrice)
	if input.Kind == "WAGES" {
		var count int
		if err = tx.QueryRow(`SELECT COUNT(*) FROM gold_receipts WHERE invoice_id=? AND kind='WAGES' AND status='ACTIVE'`, input.InvoiceID).Scan(&count); err != nil {
			return nil, err
		}
		if count > 0 {
			return nil, errors.New("يوجد سند قبض أجور ذهب نشط لهذه الفاتورة")
		}
		if price == 0 {
			_ = tx.QueryRow(`SELECT gold_price FROM gold_receipts WHERE issuer_id=? AND voucher_date=? AND kind='WAGES' AND status='ACTIVE' ORDER BY created_at DESC LIMIT 1`, v.IssuerID, v.VoucherDate).Scan(&price)
		}
		weight, e := goldWeight(total, price)
		if e != nil {
			return nil, e
		}
		v.Lines = []GoldReceiptLine{{Karat: "24", Weight: weight}}
		v.TotalWeight = weight
		v.GoldPrice = models.ToMajor(price)
	} else {
		price = 0
		available := map[string]float64{}
		rows, e := tx.Query(`SELECT COALESCE(NULLIF(karat,''),'21'),SUM(quantity) FROM invoice_items WHERE invoice_id=? GROUP BY COALESCE(NULLIF(karat,''),'21')`, input.InvoiceID)
		if e != nil {
			return nil, e
		}
		for rows.Next() {
			var k string
			var w float64
			if e = rows.Scan(&k, &w); e != nil {
				rows.Close()
				return nil, e
			}
			available[k] = math.Round(w*1000) / 1000
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
		rows, e = tx.Query(`SELECT lines FROM gold_receipts WHERE invoice_id=? AND kind='METAL' AND status='ACTIVE'`, input.InvoiceID)
		if e != nil {
			return nil, e
		}
		for rows.Next() {
			var data string
			var lines []GoldReceiptLine
			if e = rows.Scan(&data); e != nil {
				rows.Close()
				return nil, e
			}
			if e = json.Unmarshal([]byte(data), &lines); e != nil {
				rows.Close()
				return nil, e
			}
			for _, line := range lines {
				available[line.Karat] -= line.Weight
			}
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
		lines := input.Lines
		if len(lines) == 0 {
			for _, k := range []string{"18", "21", "22", "24"} {
				if w := math.Round(available[k]*1000) / 1000; w > 0 {
					lines = append(lines, GoldReceiptLine{Karat: k, Weight: w})
				}
			}
		}
		seen := map[string]bool{}
		for _, line := range lines {
			if seen[line.Karat] || (line.Karat != "18" && line.Karat != "21" && line.Karat != "22" && line.Karat != "24") || math.IsNaN(line.Weight) || math.IsInf(line.Weight, 0) || line.Weight <= 0 || line.Weight > 1e9 {
				return nil, errors.New("وزن أو عيار غير صالح")
			}
			seen[line.Karat] = true
			line.Weight = math.Round(line.Weight*1000) / 1000
			if line.Weight <= 0 || line.Weight > available[line.Karat]+0.00001 {
				return nil, fmt.Errorf("وزن عيار %s يتجاوز الوزن المتبقي للقبض في الفاتورة", line.Karat)
			}
			v.Lines = append(v.Lines, line)
			v.TotalWeight += line.Weight
		}
		v.TotalWeight = math.Round(v.TotalWeight*1000) / 1000
		if v.TotalWeight <= 0 {
			return nil, errors.New("لا يوجد وزن متبقٍ للقبض في الفاتورة")
		}
	}
	number, _, err := s.issuers.NextVoucherNumber(tx, v.IssuerID)
	if err != nil {
		return nil, err
	}
	v.VoucherNumber = "G-" + number
	data, err := json.Marshal(v.Lines)
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(`INSERT INTO gold_receipts(id,voucher_number,issuer_id,client_id,invoice_id,invoice_number,voucher_date,kind,total_weight,gold_price,invoice_total,lines,notes,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)`, v.ID, v.VoucherNumber, v.IssuerID, v.ClientID, v.InvoiceID, v.InvoiceNumber, v.VoucherDate, v.Kind, v.TotalWeight, price, total, string(data), v.Notes, actor, db.NowIso())
	if err != nil {
		return nil, err
	}
	if err = db.AuditTx(tx, actor, "GOLD_RECEIPT_CREATE", "gold_receipt", v.ID, v.IssuerID, v, ip); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetGoldReceipt(v.ID)
}

func (s *VoucherService) GetGoldReceipt(id string) (*GoldReceipt, error) {
	var v GoldReceipt
	var price, total int64
	var lines string
	err := s.db.QueryRow(`SELECT g.id,g.voucher_number,g.issuer_id,g.client_id,g.invoice_id,g.invoice_number,g.voucher_date,g.kind,g.total_weight,g.gold_price,g.invoice_total,g.lines,g.notes,g.status,i.name_ar,c.name FROM gold_receipts g JOIN issuers i ON i.id=g.issuer_id JOIN clients c ON c.id=g.client_id WHERE g.id=?`, id).Scan(&v.ID, &v.VoucherNumber, &v.IssuerID, &v.ClientID, &v.InvoiceID, &v.InvoiceNumber, &v.VoucherDate, &v.Kind, &v.TotalWeight, &price, &total, &lines, &v.Notes, &v.Status, &v.IssuerName, &v.ClientName)
	if err != nil {
		return nil, err
	}
	v.GoldPrice = models.ToMajor(price)
	v.InvoiceTotal = models.ToMajor(total)
	if err = json.Unmarshal([]byte(lines), &v.Lines); err != nil {
		return nil, err
	}
	return &v, nil
}

func (s *VoucherService) ListGoldReceipts(issuerID, invoiceID string) ([]GoldReceipt, error) {
	rows, err := s.db.Query(`SELECT id FROM gold_receipts WHERE (?='' OR issuer_id=?) AND (?='' OR invoice_id=?) ORDER BY created_at DESC LIMIT 500`, issuerID, issuerID, invoiceID, invoiceID)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	result := []GoldReceipt{}
	for _, id := range ids {
		v, e := s.GetGoldReceipt(id)
		if e != nil {
			return nil, e
		}
		result = append(result, *v)
	}
	return result, nil
}

func (s *VoucherService) CancelGoldReceipt(id, actor, ip string) error {
	s.db.WriteLock()
	defer s.db.WriteUnlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var issuer string
	if err = tx.QueryRow(`SELECT issuer_id FROM gold_receipts WHERE id=? AND status='ACTIVE'`, id).Scan(&issuer); err != nil {
		return errors.New("السند غير موجود أو ملغى")
	}
	if _, err = tx.Exec(`UPDATE gold_receipts SET status='CANCELLED' WHERE id=?`, id); err != nil {
		return err
	}
	if err = db.AuditTx(tx, actor, "GOLD_RECEIPT_CANCEL", "gold_receipt", id, issuer, nil, ip); err != nil {
		return err
	}
	return tx.Commit()
}
