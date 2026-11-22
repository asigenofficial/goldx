package services

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"slices"
	"strconv"
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
	InvoiceID     string            `json:"invoice_id"`
	Kind          string            `json:"kind"`
	VoucherDate   string            `json:"voucher_date"`
	DateOffset    int               `json:"date_offset"`
	SkipFriday    *bool             `json:"skip_friday"`
	VoucherNumber string            `json:"voucher_number"`
	GoldPrice     float64           `json:"gold_price"`
	Lines         []GoldReceiptLine `json:"lines"`
	Notes         string            `json:"notes"`
}
type UpdateGoldReceiptInput struct {
	VoucherNumber string `json:"voucher_number"`
	VoucherDate   string `json:"voucher_date"`
	Notes         string `json:"notes"`
	SkipFriday    *bool  `json:"skip_friday"`
}
type GoldReceipt struct {
	ID            string            `json:"id"`
	VoucherNumber string            `json:"voucher_number"`
	IssuerID      string            `json:"issuer_id"`
	ClientID      string            `json:"client_id"`
	ClientCode    string            `json:"client_code"`
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
	CreatedBy     string            `json:"created_by"`
	CreatedAt     string            `json:"created_at"`
}

type ListGoldReceiptsFilter struct {
	IssuerID  string
	ClientID  string
	InvoiceID string
	Kind      string
	Status    string
	FromDate  string
	ToDate    string
	Search    string
	Limit     int
}

type EligibleGoldInvoicesFilter struct {
	IssuerID string
	ClientID string
	FromDate string
	ToDate   string
	Search   string
}

type EligibleGoldInvoice struct {
	ID              string            `json:"id"`
	InvoiceNumber   string            `json:"invoice_number"`
	SequenceNo      int64             `json:"sequence_no"`
	IssueDate       string            `json:"issue_date"`
	IssueTime       string            `json:"issue_time"`
	IssuerID        string            `json:"issuer_id"`
	IssuerName      string            `json:"issuer_name"`
	ClientID        string            `json:"client_id"`
	ClientName      string            `json:"client_name"`
	ClientCode      string            `json:"client_code"`
	GrandTotal      float64           `json:"grand_total"`
	GoldInvoiceType string            `json:"gold_invoice_type"`
	Status          string            `json:"status"`
	TotalWeight     float64           `json:"total_weight"`
	CollectedWeight float64           `json:"collected_weight"`
	RemainingWeight float64           `json:"remaining_weight"`
	RemainingLines  []GoldReceiptLine `json:"remaining_lines"`
}

type EligibleGoldInvoicesResult struct {
	IssuerID            string                `json:"issuer_id"`
	IssuerName          string                `json:"issuer_name"`
	VoucherPrefix       string                `json:"voucher_prefix"`
	SuggestedStartNo    string                `json:"suggested_start_no"`
	LastVoucherNumber   string                `json:"last_voucher_number"`
	ExistingNumbers     []string              `json:"existing_numbers"`
	TotalInvoices       int                   `json:"total_invoices"`
	TotalClients        int                   `json:"total_clients"`
	TotalRemainingGrams float64               `json:"total_remaining_grams"`
	Items               []EligibleGoldInvoice `json:"items"`
}

type BatchGoldReceiptItemInput struct {
	InvoiceID     string            `json:"invoice_id"`
	VoucherNumber string            `json:"voucher_number,omitempty"`
	VoucherDate   string            `json:"voucher_date,omitempty"`
	Lines         []GoldReceiptLine `json:"lines,omitempty"`
	Notes         string            `json:"notes,omitempty"`
}

type BatchCreateGoldReceiptsInput struct {
	IssuerID    string                      `json:"issuer_id"`
	Kind        string                      `json:"kind"`
	DateOffset  int                         `json:"date_offset"`
	SkipFriday  *bool                       `json:"skip_friday"`
	StartNumber string                      `json:"start_number"`
	SeqGapMin   int                         `json:"seq_gap_min"`
	SeqGapMax   int                         `json:"seq_gap_max"`
	NotesPrefix string                      `json:"notes_prefix"`
	InvoiceIDs  []string                    `json:"invoice_ids,omitempty"`
	Items       []BatchGoldReceiptItemInput `json:"items,omitempty"`
}

type BatchCreateGoldReceiptsResult struct {
	Count          int           `json:"count"`
	ClientCount    int           `json:"client_count"`
	TotalWeight    float64       `json:"total_weight"`
	FirstNumber    string        `json:"first_number"`
	LastNumber     string        `json:"last_number"`
	SkippedFridays int           `json:"skipped_fridays"`
	Items          []GoldReceipt `json:"items"`
}

// AdjustVoucherDate adds offsetDays to issueDate (YYYY-MM-DD) and, when skipFriday is true,
// shifts any Friday result forward to Saturday so no voucher ever falls on Friday.
func AdjustVoucherDate(issueDate string, offsetDays int, skipFriday bool) (string, bool, error) {
	if offsetDays < 0 || offsetDays > 3650 {
		return "", false, errors.New("عدد أيام التأخير غير صالح")
	}
	base, err := time.Parse("2006-01-02", strings.TrimSpace(issueDate))
	if err != nil {
		return "", false, errors.New("تاريخ الفاتورة غير صالح")
	}
	d := base.AddDate(0, 0, offsetDays)
	skipped := false
	if skipFriday && d.Weekday() == time.Friday {
		d = d.AddDate(0, 0, 1)
		skipped = true
	}
	return d.Format("2006-01-02"), skipped, nil
}

// IsFridayDate reports whether an ISO YYYY-MM-DD date falls on a Friday.
func IsFridayDate(dateStr string) (bool, error) {
	d, err := time.Parse("2006-01-02", strings.TrimSpace(dateStr))
	if err != nil {
		return false, errors.New("تاريخ السند غير صالح")
	}
	return d.Weekday() == time.Friday, nil
}

// ParseVoucherSerialPattern extracts (prefix, startNo, pad) from a user-supplied start serial
// such as "100", "00100", "GR-50", or "G-RV-00100". Empty input falls back to defaults.
func ParseVoucherSerialPattern(pattern, defaultPrefix string, defaultStartNo int64, defaultPad int) (prefix string, startNo int64, pad int) {
	pattern = strings.TrimSpace(pattern)
	if defaultStartNo <= 0 {
		defaultStartNo = 1
	}
	if defaultPad <= 0 {
		defaultPad = 5
	}
	if pattern == "" {
		p := strings.TrimRight(strings.TrimSpace(defaultPrefix), "-")
		if p == "" {
			p = "G-RV"
		}
		return p, defaultStartNo, defaultPad
	}
	i := len(pattern) - 1
	for i >= 0 && pattern[i] >= '0' && pattern[i] <= '9' {
		i--
	}
	digits := pattern[i+1:]
	rawPrefix := strings.TrimRight(strings.TrimSpace(pattern[:i+1]), "-")
	if digits == "" {
		return rawPrefix, defaultStartNo, defaultPad
	}
	num, err := strconv.ParseInt(digits, 10, 64)
	if err != nil || num < 0 {
		return rawPrefix, defaultStartNo, len(digits)
	}
	return rawPrefix, num, len(digits)
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

func remainingMetalWeightsTx(tx *sql.Tx, invoiceID string) (map[string]float64, error) {
	available := map[string]float64{}
	rows, err := tx.Query(`SELECT COALESCE(NULLIF(karat,''),'21'), SUM(quantity) FROM invoice_items WHERE invoice_id=? GROUP BY COALESCE(NULLIF(karat,''),'21')`, invoiceID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var k string
		var w float64
		if err = rows.Scan(&k, &w); err != nil {
			rows.Close()
			return nil, err
		}
		available[k] = math.Round(w*1000) / 1000
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	rows, err = tx.Query(`SELECT lines FROM gold_receipts WHERE invoice_id=? AND kind='METAL' AND status='ACTIVE'`, invoiceID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var data string
		var lines []GoldReceiptLine
		if err = rows.Scan(&data); err != nil {
			rows.Close()
			return nil, err
		}
		if err = json.Unmarshal([]byte(data), &lines); err != nil {
			rows.Close()
			return nil, err
		}
		for _, line := range lines {
			available[line.Karat] = math.Round((available[line.Karat]-line.Weight)*1000) / 1000
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	return available, nil
}

func (s *VoucherService) CreateGoldReceipt(input CreateGoldReceiptInput, actor, ip string) (*GoldReceipt, error) {
	if input.Kind != "METAL" && input.Kind != "WAGES" {
		return nil, errors.New("اختر قبض كسر أو قبض أجور بالذهب")
	}
	if !validAmount(input.GoldPrice) {
		return nil, errors.New("سعر الذهب غير صالح")
	}
	skipFriday := false
	if input.SkipFriday != nil {
		skipFriday = *input.SkipFriday
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
	var status, issueDate string
	err = tx.QueryRow(`SELECT issuer_id,client_id,invoice_number,issue_date,grand_total,status FROM invoices WHERE id=?`, input.InvoiceID).Scan(&v.IssuerID, &v.ClientID, &v.InvoiceNumber, &issueDate, &total, &status)
	if err != nil {
		return nil, errors.New("الفاتورة غير موجودة")
	}
	if status == "CANCELLED" {
		return nil, errors.New("لا يمكن قبض ذهب لفاتورة ملغاة")
	}
	if strings.TrimSpace(input.VoucherDate) != "" {
		isFri, errDate := IsFridayDate(input.VoucherDate)
		if errDate != nil {
			return nil, errDate
		}
		if skipFriday && isFri {
			return nil, errors.New("لا يمكن إصدار سند قبض ذهب يوم الجمعة؛ اختر تاريخاً آخر")
		}
		v.VoucherDate = strings.TrimSpace(input.VoucherDate)
	} else {
		vDate, _, errDate := AdjustVoucherDate(issueDate, input.DateOffset, skipFriday)
		if errDate != nil {
			return nil, errDate
		}
		v.VoucherDate = vDate
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
			_ = tx.QueryRow(`SELECT gold_price FROM gold_receipts WHERE issuer_id=? AND voucher_date IN (?,?) AND kind='WAGES' AND status='ACTIVE' ORDER BY created_at DESC LIMIT 1`, v.IssuerID, v.VoucherDate, issueDate).Scan(&price)
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
		available, e := remainingMetalWeightsTx(tx, input.InvoiceID)
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
	customNumber := strings.TrimSpace(input.VoucherNumber)
	if customNumber != "" {
		var exists int
		if err = tx.QueryRow(`SELECT COUNT(*) FROM gold_receipts WHERE issuer_id=? AND voucher_number=?`, v.IssuerID, customNumber).Scan(&exists); err != nil {
			return nil, err
		}
		if exists > 0 {
			return nil, fmt.Errorf("رقم السند %s مستخدم بالفعل لدى هذا المتجر", customNumber)
		}
		v.VoucherNumber = customNumber
	} else {
		number, _, err := s.issuers.NextVoucherNumber(tx, v.IssuerID)
		if err != nil {
			return nil, err
		}
		v.VoucherNumber = "G-" + number
	}
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

func (s *VoucherService) ListEligibleGoldInvoices(f EligibleGoldInvoicesFilter) (*EligibleGoldInvoicesResult, error) {
	issuerID := strings.TrimSpace(f.IssuerID)
	if issuerID == "" {
		return nil, errors.New("يرجى اختيار المورد (المتجر المصدر) أولاً")
	}

	var issuerName, voucherPrefix string
	var voucherNextNo int64
	if err := s.db.QueryRow(`SELECT name_ar, voucher_prefix, voucher_next_no FROM issuers WHERE id=?`, issuerID).Scan(&issuerName, &voucherPrefix, &voucherNextNo); err != nil {
		return nil, errors.New("المورد / المتجر المصدر غير موجود")
	}
	cleanVPrefix := strings.TrimRight(strings.TrimSpace(voucherPrefix), "-")
	if cleanVPrefix == "" {
		cleanVPrefix = "RV"
	}

	// Load existing gold receipt numbers for collision checks and smart next-number suggestion.
	existingNumbers := make([]string, 0)
	var lastNumber string
	exRows, err := s.db.Query(`SELECT voucher_number FROM gold_receipts WHERE issuer_id=? ORDER BY created_at DESC`, issuerID)
	if err != nil {
		return nil, err
	}
	for exRows.Next() {
		var num string
		if err = exRows.Scan(&num); err == nil {
			if lastNumber == "" {
				lastNumber = num
			}
			existingNumbers = append(existingNumbers, num)
		}
	}
	exRows.Close()

	suggestedStart := crypto.FormatSerial("G-"+cleanVPrefix, voucherNextNo, 5)
	if lastNumber != "" {
		p, _, pad := ParseVoucherSerialPattern(lastNumber, "G-"+cleanVPrefix, voucherNextNo, 5)
		maxNo := int64(0)
		for _, ex := range existingNumbers {
			ep, en, _ := ParseVoucherSerialPattern(ex, "G-"+cleanVPrefix, 0, pad)
			if ep == p && en > maxNo {
				maxNo = en
			}
		}
		if maxNo > 0 {
			suggestedStart = crypto.FormatSerial(p, maxNo+1, pad)
		}
	}

	// Fetch all non-cancelled invoices for this supplier (all clients unless filtered).
	where := `WHERE i.issuer_id = ? AND i.status != 'CANCELLED'`
	args := []any{issuerID}
	if strings.TrimSpace(f.ClientID) != "" {
		where += ` AND i.client_id = ?`
		args = append(args, strings.TrimSpace(f.ClientID))
	}
	if strings.TrimSpace(f.FromDate) != "" {
		where += ` AND i.issue_date >= ?`
		args = append(args, strings.TrimSpace(f.FromDate))
	}
	if strings.TrimSpace(f.ToDate) != "" {
		where += ` AND i.issue_date <= ?`
		args = append(args, strings.TrimSpace(f.ToDate))
	}
	if strings.TrimSpace(f.Search) != "" {
		where += ` AND (i.invoice_number LIKE ? OR c.name LIKE ? OR c.client_code LIKE ?)`
		like := "%" + strings.TrimSpace(f.Search) + "%"
		args = append(args, like, like, like)
	}

	invQuery := fmt.Sprintf(`
		SELECT i.id, i.invoice_number, i.sequence_no, i.issue_date, i.issue_time,
		       i.issuer_id, s.name_ar, i.client_id, c.name, c.client_code,
		       i.grand_total, COALESCE(i.gold_invoice_type, 'PRICE_AND_WAGE'), i.status
		FROM invoices i
		JOIN issuers s ON s.id = i.issuer_id
		JOIN clients c ON c.id = i.client_id
		%s
		ORDER BY i.issue_date ASC, i.issue_time ASC, i.sequence_no ASC, i.invoice_number ASC
	`, where)

	invRows, err := s.db.Query(invQuery, args...)
	if err != nil {
		return nil, err
	}
	rawInvoices := make([]EligibleGoldInvoice, 0)
	for invRows.Next() {
		var it EligibleGoldInvoice
		var grandMinor int64
		if err = invRows.Scan(
			&it.ID, &it.InvoiceNumber, &it.SequenceNo, &it.IssueDate, &it.IssueTime,
			&it.IssuerID, &it.IssuerName, &it.ClientID, &it.ClientName, &it.ClientCode,
			&grandMinor, &it.GoldInvoiceType, &it.Status,
		); err != nil {
			invRows.Close()
			return nil, err
		}
		it.GrandTotal = models.ToMajor(grandMinor)
		rawInvoices = append(rawInvoices, it)
	}
	err = invRows.Err()
	invRows.Close()
	if err != nil {
		return nil, err
	}

	// Aggregate total item weights per (invoice_id, karat) for this issuer in one query.
	invWeights := map[string]map[string]float64{}
	wRows, err := s.db.Query(`
		SELECT ii.invoice_id, COALESCE(NULLIF(ii.karat,''),'21'), SUM(ii.quantity)
		FROM invoice_items ii
		JOIN invoices i ON i.id = ii.invoice_id
		WHERE i.issuer_id = ? AND i.status != 'CANCELLED'
		GROUP BY ii.invoice_id, COALESCE(NULLIF(ii.karat,''),'21')
	`, issuerID)
	if err != nil {
		return nil, err
	}
	for wRows.Next() {
		var invID, k string
		var w float64
		if err = wRows.Scan(&invID, &k, &w); err != nil {
			wRows.Close()
			return nil, err
		}
		if invWeights[invID] == nil {
			invWeights[invID] = map[string]float64{}
		}
		invWeights[invID][k] = math.Round(w*1000) / 1000
	}
	err = wRows.Err()
	wRows.Close()
	if err != nil {
		return nil, err
	}

	// Aggregate already collected METAL gold weights per (invoice_id, karat) in one query.
	collectedWeights := map[string]map[string]float64{}
	cRows, err := s.db.Query(`SELECT invoice_id, lines FROM gold_receipts WHERE issuer_id=? AND kind='METAL' AND status='ACTIVE'`, issuerID)
	if err != nil {
		return nil, err
	}
	for cRows.Next() {
		var invID, linesJSON string
		if err = cRows.Scan(&invID, &linesJSON); err != nil {
			cRows.Close()
			return nil, err
		}
		var lines []GoldReceiptLine
		if json.Unmarshal([]byte(linesJSON), &lines) == nil {
			if collectedWeights[invID] == nil {
				collectedWeights[invID] = map[string]float64{}
			}
			for _, ln := range lines {
				collectedWeights[invID][ln.Karat] = math.Round((collectedWeights[invID][ln.Karat]+ln.Weight)*1000) / 1000
			}
		}
	}
	err = cRows.Err()
	cRows.Close()
	if err != nil {
		return nil, err
	}

	eligible := make([]EligibleGoldInvoice, 0, len(rawInvoices))
	clientSet := map[string]bool{}
	var totalRemainingGrams float64

	for _, it := range rawInvoices {
		totMap := invWeights[it.ID]
		if len(totMap) == 0 {
			continue
		}
		colMap := collectedWeights[it.ID]
		var totalW, colW, remW float64
		remLines := make([]GoldReceiptLine, 0, 4)
		for _, k := range []string{"18", "21", "22", "24"} {
			tw := math.Round(totMap[k]*1000) / 1000
			cw := math.Round(colMap[k]*1000) / 1000
			rw := math.Round((tw-cw)*1000) / 1000
			if rw < 0 {
				rw = 0
			}
			totalW += tw
			colW += cw
			if rw > 0 {
				remLines = append(remLines, GoldReceiptLine{Karat: k, Weight: rw})
				remW += rw
			}
		}
		remW = math.Round(remW*1000) / 1000
		if remW <= 0 || len(remLines) == 0 {
			continue
		}
		it.TotalWeight = math.Round(totalW*1000) / 1000
		it.CollectedWeight = math.Round(colW*1000) / 1000
		it.RemainingWeight = remW
		it.RemainingLines = remLines
		eligible = append(eligible, it)
		clientSet[it.ClientID] = true
		totalRemainingGrams += remW
	}

	return &EligibleGoldInvoicesResult{
		IssuerID:            issuerID,
		IssuerName:          issuerName,
		VoucherPrefix:       cleanVPrefix,
		SuggestedStartNo:    suggestedStart,
		LastVoucherNumber:   lastNumber,
		ExistingNumbers:     existingNumbers,
		TotalInvoices:       len(eligible),
		TotalClients:        len(clientSet),
		TotalRemainingGrams: math.Round(totalRemainingGrams*1000) / 1000,
		Items:               eligible,
	}, nil
}

// CreateGoldReceiptsBatch creates METAL gold receipt vouchers across all clients of a supplier
// in one atomic transaction with unified sequential numbering, configurable gap, date offset,
// and Friday exclusion.
func (s *VoucherService) CreateGoldReceiptsBatch(input BatchCreateGoldReceiptsInput, actor, ip string) (*BatchCreateGoldReceiptsResult, error) {
	issuerID := strings.TrimSpace(input.IssuerID)
	if issuerID == "" {
		return nil, errors.New("المورد (المتجر المصدر) مطلوب")
	}
	kind := strings.TrimSpace(input.Kind)
	if kind == "" {
		kind = "METAL"
	}
	if kind != "METAL" {
		return nil, errors.New("الإصدار الدفعي حالياً مخصص لسندات قبض الذهب (معدن كسر)")
	}
	if input.DateOffset < 0 || input.DateOffset > 3650 {
		return nil, errors.New("عدد أيام تأخير التاريخ غير صالح")
	}
	skipFriday := true
	if input.SkipFriday != nil {
		skipFriday = *input.SkipFriday
	}
	gapMin := input.SeqGapMin
	if gapMin <= 0 {
		gapMin = 1
	}
	gapMax := input.SeqGapMax
	if gapMax <= 0 {
		gapMax = gapMin
	}
	if gapMin > 10000 || gapMax > 10000 || gapMax < gapMin {
		return nil, errors.New("قيمة الفارق بين السندات غير صالحة")
	}

	rawItems := input.Items
	if len(rawItems) == 0 && len(input.InvoiceIDs) > 0 {
		rawItems = make([]BatchGoldReceiptItemInput, 0, len(input.InvoiceIDs))
		for _, id := range input.InvoiceIDs {
			rawItems = append(rawItems, BatchGoldReceiptItemInput{InvoiceID: id})
		}
	}
	if len(rawItems) == 0 {
		return nil, errors.New("حدد فاتورة واحدة على الأقل لإنشاء السندات")
	}
	if len(rawItems) > 2000 {
		return nil, errors.New("الحد الأقصى للدفعة الواحدة هو 2000 سند")
	}

	s.db.WriteLock()
	defer s.db.WriteUnlock()
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var voucherPrefix string
	var voucherNextNo int64
	if err = tx.QueryRow(`SELECT voucher_prefix, voucher_next_no FROM issuers WHERE id=?`, issuerID).Scan(&voucherPrefix, &voucherNextNo); err != nil {
		return nil, errors.New("المورد / المتجر المصدر غير موجود")
	}
	cleanVPrefix := strings.TrimRight(strings.TrimSpace(voucherPrefix), "-")
	if cleanVPrefix == "" {
		cleanVPrefix = "RV"
	}

	type preparedItem struct {
		in            BatchGoldReceiptItemInput
		clientID      string
		invoiceNumber string
		sequenceNo    int64
		issueDate     string
		issueTime     string
		grandTotal    int64
		voucherDate   string
		voucherNumber string
		skippedFriday bool
	}

	seenInv := map[string]bool{}
	prepared := make([]preparedItem, 0, len(rawItems))
	allHaveExplicitNumbers := true
	skippedFridays := 0

	for _, it := range rawItems {
		invID := strings.TrimSpace(it.InvoiceID)
		if invID == "" {
			return nil, errors.New("معرّف الفاتورة مفقود في أحد العناصر")
		}
		if seenInv[invID] {
			return nil, errors.New("توجد فاتورة مكررة في نفس الدفعة")
		}
		seenInv[invID] = true

		var invIssuerID, clientID, invNumber, issueDate, issueTime, status string
		var seqNo, grandTotal int64
		err = tx.QueryRow(`SELECT issuer_id, client_id, invoice_number, sequence_no, issue_date, issue_time, grand_total, status FROM invoices WHERE id=?`, invID).Scan(
			&invIssuerID, &clientID, &invNumber, &seqNo, &issueDate, &issueTime, &grandTotal, &status,
		)
		if err != nil {
			return nil, fmt.Errorf("الفاتورة غير موجودة (%s)", invID)
		}
		if invIssuerID != issuerID {
			return nil, fmt.Errorf("الفاتورة %s لا تتبع المورد المحدد", invNumber)
		}
		if status == "CANCELLED" {
			return nil, fmt.Errorf("لا يمكن قبض ذهب للفاتورة الملغاة %s", invNumber)
		}

		vDate := strings.TrimSpace(it.VoucherDate)
		skipped := false
		if vDate != "" {
			isFri, errDate := IsFridayDate(vDate)
			if errDate != nil {
				return nil, fmt.Errorf("تاريخ السند للفاتورة %s غير صالح", invNumber)
			}
			if skipFriday && isFri {
				return nil, fmt.Errorf("تاريخ السند (%s) للفاتورة %s يوافق يوم الجمعة ولا يُسمح بإصدار سندات يوم الجمعة", vDate, invNumber)
			}
			if skipFriday {
				if adj, adjSkipped, errAdj := AdjustVoucherDate(issueDate, input.DateOffset, true); errAdj == nil && adjSkipped && adj == vDate {
					skipped = true
					skippedFridays++
				}
			}
		} else {
			var errDate error
			vDate, skipped, errDate = AdjustVoucherDate(issueDate, input.DateOffset, skipFriday)
			if errDate != nil {
				return nil, errDate
			}
			if skipped {
				skippedFridays++
			}
		}

		vNum := strings.TrimSpace(it.VoucherNumber)
		if vNum == "" {
			allHaveExplicitNumbers = false
		}

		prepared = append(prepared, preparedItem{
			in:            it,
			clientID:      clientID,
			invoiceNumber: invNumber,
			sequenceNo:    seqNo,
			issueDate:     issueDate,
			issueTime:     issueTime,
			grandTotal:    grandTotal,
			voucherDate:   vDate,
			voucherNumber: vNum,
			skippedFriday: skipped,
		})
	}

	// Assign sequential numbers across all clients in chronological order when not explicitly pre-numbered.
	if !allHaveExplicitNumbers {
		slices.SortFunc(prepared, func(a, b preparedItem) int {
			if c := strings.Compare(a.voucherDate, b.voucherDate); c != 0 {
				return c
			}
			if c := strings.Compare(a.issueDate, b.issueDate); c != 0 {
				return c
			}
			if c := strings.Compare(a.issueTime, b.issueTime); c != 0 {
				return c
			}
			if a.sequenceNo != b.sequenceNo {
				if a.sequenceNo < b.sequenceNo {
					return -1
				}
				return 1
			}
			return strings.Compare(a.invoiceNumber, b.invoiceNumber)
		})

		defaultStart := voucherNextNo
		if strings.TrimSpace(input.StartNumber) == "" {
			// Ensure default auto-numbering stays above existing serials.
			rows, e := tx.Query(`SELECT voucher_number FROM receipt_vouchers WHERE issuer_id=? UNION ALL SELECT substr(voucher_number,3) FROM gold_receipts WHERE issuer_id=?`, issuerID, issuerID)
			if e != nil {
				return nil, e
			}
			serialPrefix := cleanVPrefix + "-"
			for rows.Next() {
				var ex string
				if rows.Scan(&ex) == nil && strings.HasPrefix(ex, serialPrefix) {
					if n, parseErr := strconv.ParseInt(strings.TrimPrefix(ex, serialPrefix), 10, 64); parseErr == nil && n >= defaultStart {
						defaultStart = n + 1
					}
				}
			}
			rows.Close()
		}

		prefix, currNo, pad := ParseVoucherSerialPattern(input.StartNumber, "G-"+cleanVPrefix, defaultStart, 5)
		rng := rand.New(rand.NewSource(time.Now().UnixNano()))
		for i := range prepared {
			if i > 0 {
				step := gapMin
				if gapMax > gapMin {
					step = gapMin + rng.Intn(gapMax-gapMin+1)
				}
				currNo += int64(step)
			}
			prepared[i].voucherNumber = crypto.FormatSerial(prefix, currNo, pad)
		}
	}

	// Validate uniqueness of all voucher numbers (both within batch and against existing gold_receipts).
	existingSet := map[string]bool{}
	exRows, err := tx.Query(`SELECT voucher_number FROM gold_receipts WHERE issuer_id=?`, issuerID)
	if err != nil {
		return nil, err
	}
	for exRows.Next() {
		var ex string
		if exRows.Scan(&ex) == nil {
			existingSet[ex] = true
		}
	}
	exRows.Close()

	batchNumSet := map[string]bool{}
	for _, p := range prepared {
		if p.voucherNumber == "" {
			return nil, fmt.Errorf("رقم السند للفاتورة %s فارغ", p.invoiceNumber)
		}
		if batchNumSet[p.voucherNumber] {
			return nil, fmt.Errorf("رقم السند %s مكرر داخل نفس الدفعة", p.voucherNumber)
		}
		if existingSet[p.voucherNumber] {
			return nil, fmt.Errorf("رقم السند %s مستخدم بالفعل لدى هذا المتجر؛ اختر رقم بداية آخر", p.voucherNumber)
		}
		batchNumSet[p.voucherNumber] = true
	}

	now := db.NowIso()
	createdIDs := make([]string, 0, len(prepared))
	clientSet := map[string]bool{}
	var grandTotalWeight float64
	defaultGoldSeriesPrefix := "G-" + cleanVPrefix + "-"
	var maxSeriesNo int64

	for _, p := range prepared {
		available, e := remainingMetalWeightsTx(tx, p.in.InvoiceID)
		if e != nil {
			return nil, e
		}
		lines := p.in.Lines
		if len(lines) == 0 {
			for _, k := range []string{"18", "21", "22", "24"} {
				if w := math.Round(available[k]*1000) / 1000; w > 0 {
					lines = append(lines, GoldReceiptLine{Karat: k, Weight: w})
				}
			}
		}
		finalLines := make([]GoldReceiptLine, 0, len(lines))
		seenKarat := map[string]bool{}
		var totalW float64
		for _, ln := range lines {
			if seenKarat[ln.Karat] || (ln.Karat != "18" && ln.Karat != "21" && ln.Karat != "22" && ln.Karat != "24") || math.IsNaN(ln.Weight) || math.IsInf(ln.Weight, 0) || ln.Weight <= 0 || ln.Weight > 1e9 {
				return nil, fmt.Errorf("وزن أو عيار غير صالح في الفاتورة %s", p.invoiceNumber)
			}
			seenKarat[ln.Karat] = true
			ln.Weight = math.Round(ln.Weight*1000) / 1000
			if ln.Weight <= 0 || ln.Weight > available[ln.Karat]+0.00001 {
				return nil, fmt.Errorf("وزن عيار %s في الفاتورة %s يتجاوز الوزن المتبقي للقبض", ln.Karat, p.invoiceNumber)
			}
			finalLines = append(finalLines, ln)
			totalW += ln.Weight
		}
		totalW = math.Round(totalW*1000) / 1000
		if totalW <= 0 {
			return nil, fmt.Errorf("لا يوجد وزن متبقٍ للقبض في الفاتورة %s", p.invoiceNumber)
		}

		notes := strings.TrimSpace(p.in.Notes)
		if notes == "" {
			tpl := strings.TrimSpace(input.NotesPrefix)
			if tpl != "" {
				if strings.Contains(tpl, "{invoice_number}") {
					notes = strings.ReplaceAll(tpl, "{invoice_number}", p.invoiceNumber)
				} else {
					notes = tpl + " — فاتورة رقم " + p.invoiceNumber
				}
			} else {
				notes = "قبض ذهب مقابل فاتورة رقم " + p.invoiceNumber
			}
		}

		data, e := json.Marshal(finalLines)
		if e != nil {
			return nil, e
		}
		recID := crypto.UUID()
		_, e = tx.Exec(
			`INSERT INTO gold_receipts(id,voucher_number,issuer_id,client_id,invoice_id,invoice_number,voucher_date,kind,total_weight,gold_price,invoice_total,lines,notes,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?,?,?,'ACTIVE',?,?)`,
			recID, p.voucherNumber, issuerID, p.clientID, p.in.InvoiceID, p.invoiceNumber, p.voucherDate, kind, totalW, p.grandTotal, string(data), notes, actor, now,
		)
		if e != nil {
			return nil, e
		}
		if strings.HasPrefix(p.voucherNumber, defaultGoldSeriesPrefix) {
			if n, parseErr := strconv.ParseInt(strings.TrimPrefix(p.voucherNumber, defaultGoldSeriesPrefix), 10, 64); parseErr == nil && n > maxSeriesNo {
				maxSeriesNo = n
			}
		}
		createdIDs = append(createdIDs, recID)
		clientSet[p.clientID] = true
		grandTotalWeight += totalW
	}

	if maxSeriesNo >= voucherNextNo {
		if _, err = tx.Exec(`UPDATE issuers SET voucher_next_no = ? WHERE id = ?`, maxSeriesNo+1, issuerID); err != nil {
			return nil, err
		}
	}

	firstNum := prepared[0].voucherNumber
	lastNum := prepared[len(prepared)-1].voucherNumber
	grandTotalWeight = math.Round(grandTotalWeight*1000) / 1000

	if err = db.AuditTx(tx, actor, "GOLD_RECEIPT_BATCH_CREATE", "gold_receipt", firstNum, issuerID, map[string]any{
		"count":           len(createdIDs),
		"client_count":    len(clientSet),
		"total_weight":    grandTotalWeight,
		"first_number":    firstNum,
		"last_number":     lastNum,
		"date_offset":     input.DateOffset,
		"skip_friday":     skipFriday,
		"skipped_fridays": skippedFridays,
	}, ip); err != nil {
		return nil, err
	}

	if err = tx.Commit(); err != nil {
		return nil, err
	}

	created := make([]GoldReceipt, 0, len(createdIDs))
	for _, id := range createdIDs {
		v, e := s.GetGoldReceipt(id)
		if e != nil {
			return nil, e
		}
		created = append(created, *v)
	}

	return &BatchCreateGoldReceiptsResult{
		Count:          len(created),
		ClientCount:    len(clientSet),
		TotalWeight:    grandTotalWeight,
		FirstNumber:    firstNum,
		LastNumber:     lastNum,
		SkippedFridays: skippedFridays,
		Items:          created,
	}, nil
}

func (s *VoucherService) UpdateGoldReceipt(id string, input UpdateGoldReceiptInput, actor, ip string) (*GoldReceipt, error) {
	skipFriday := true
	if input.SkipFriday != nil {
		skipFriday = *input.SkipFriday
	}
	s.db.WriteLock()
	defer s.db.WriteUnlock()
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var issuerID, curNum, curDate, curNotes, status string
	if err = tx.QueryRow(`SELECT issuer_id, voucher_number, voucher_date, notes, status FROM gold_receipts WHERE id=?`, id).Scan(&issuerID, &curNum, &curDate, &curNotes, &status); err != nil {
		return nil, errors.New("سند قبض الذهب غير موجود")
	}
	if status == "CANCELLED" {
		return nil, errors.New("لا يمكن تعديل سند ملغى")
	}

	newNum := strings.TrimSpace(input.VoucherNumber)
	if newNum == "" {
		newNum = curNum
	}
	if newNum != curNum {
		var exists int
		if err = tx.QueryRow(`SELECT COUNT(*) FROM gold_receipts WHERE issuer_id=? AND voucher_number=? AND id!=?`, issuerID, newNum, id).Scan(&exists); err != nil {
			return nil, err
		}
		if exists > 0 {
			return nil, fmt.Errorf("رقم السند %s مستخدم بالفعل لدى هذا المتجر", newNum)
		}
	}

	newDate := strings.TrimSpace(input.VoucherDate)
	if newDate == "" {
		newDate = curDate
	}
	isFri, errDate := IsFridayDate(newDate)
	if errDate != nil {
		return nil, errDate
	}
	if skipFriday && isFri {
		return nil, errors.New("لا يمكن تعيين تاريخ السند ليوم الجمعة")
	}

	newNotes := strings.TrimSpace(input.Notes)
	if _, err = tx.Exec(`UPDATE gold_receipts SET voucher_number=?, voucher_date=?, notes=? WHERE id=?`, newNum, newDate, newNotes, id); err != nil {
		return nil, err
	}
	if err = db.AuditTx(tx, actor, "GOLD_RECEIPT_UPDATE", "gold_receipt", id, issuerID, map[string]any{
		"old_voucher_number": curNum,
		"voucher_number":     newNum,
		"old_voucher_date":   curDate,
		"voucher_date":       newDate,
	}, ip); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetGoldReceipt(id)
}

func (s *VoucherService) DeleteGoldReceipt(id, actor, ip string) error {
	s.db.WriteLock()
	defer s.db.WriteUnlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var issuer, num string
	if err = tx.QueryRow(`SELECT issuer_id, voucher_number FROM gold_receipts WHERE id=?`, id).Scan(&issuer, &num); err != nil {
		return errors.New("سند قبض الذهب غير موجود")
	}
	if _, err = tx.Exec(`DELETE FROM gold_receipts WHERE id=?`, id); err != nil {
		return err
	}
	if err = db.AuditTx(tx, actor, "GOLD_RECEIPT_DELETE", "gold_receipt", id, issuer, map[string]any{"voucher_number": num}, ip); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *VoucherService) GetGoldReceipt(id string) (*GoldReceipt, error) {
	var v GoldReceipt
	var price, total int64
	var lines string
	err := s.db.QueryRow(`SELECT g.id,g.voucher_number,g.issuer_id,g.client_id,c.client_code,g.invoice_id,g.invoice_number,g.voucher_date,g.kind,g.total_weight,g.gold_price,g.invoice_total,g.lines,g.notes,g.status,i.name_ar,c.name,g.created_by,g.created_at FROM gold_receipts g JOIN issuers i ON i.id=g.issuer_id JOIN clients c ON c.id=g.client_id WHERE g.id=?`, id).Scan(&v.ID, &v.VoucherNumber, &v.IssuerID, &v.ClientID, &v.ClientCode, &v.InvoiceID, &v.InvoiceNumber, &v.VoucherDate, &v.Kind, &v.TotalWeight, &price, &total, &lines, &v.Notes, &v.Status, &v.IssuerName, &v.ClientName, &v.CreatedBy, &v.CreatedAt)
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
	return s.ListGoldReceiptsFiltered(ListGoldReceiptsFilter{IssuerID: issuerID, InvoiceID: invoiceID})
}

func (s *VoucherService) ListGoldReceiptsFiltered(f ListGoldReceiptsFilter) ([]GoldReceipt, error) {
	limit := f.Limit
	if limit <= 0 || limit > 2000 {
		limit = 1000
	}
	where := `WHERE 1=1`
	var args []any
	if strings.TrimSpace(f.IssuerID) != "" {
		where += ` AND g.issuer_id = ?`
		args = append(args, strings.TrimSpace(f.IssuerID))
	}
	if strings.TrimSpace(f.ClientID) != "" {
		where += ` AND g.client_id = ?`
		args = append(args, strings.TrimSpace(f.ClientID))
	}
	if strings.TrimSpace(f.InvoiceID) != "" {
		where += ` AND g.invoice_id = ?`
		args = append(args, strings.TrimSpace(f.InvoiceID))
	}
	if strings.TrimSpace(f.Kind) != "" {
		where += ` AND g.kind = ?`
		args = append(args, strings.TrimSpace(f.Kind))
	}
	if strings.TrimSpace(f.Status) != "" {
		where += ` AND g.status = ?`
		args = append(args, strings.TrimSpace(f.Status))
	}
	if strings.TrimSpace(f.FromDate) != "" {
		where += ` AND g.voucher_date >= ?`
		args = append(args, strings.TrimSpace(f.FromDate))
	}
	if strings.TrimSpace(f.ToDate) != "" {
		where += ` AND g.voucher_date <= ?`
		args = append(args, strings.TrimSpace(f.ToDate))
	}
	if strings.TrimSpace(f.Search) != "" {
		where += ` AND (g.voucher_number LIKE ? OR g.invoice_number LIKE ? OR c.name LIKE ? OR c.client_code LIKE ? OR g.notes LIKE ?)`
		like := "%" + strings.TrimSpace(f.Search) + "%"
		args = append(args, like, like, like, like, like)
	}
	args = append(args, limit)

	query := fmt.Sprintf(`
		SELECT g.id, g.voucher_number, g.issuer_id, g.client_id, c.client_code, g.invoice_id,
		       g.invoice_number, g.voucher_date, g.kind, g.total_weight, g.gold_price, g.invoice_total,
		       g.lines, g.notes, g.status, i.name_ar, c.name, g.created_by, g.created_at
		FROM gold_receipts g
		JOIN issuers i ON i.id = g.issuer_id
		JOIN clients c ON c.id = g.client_id
		%s
		ORDER BY g.voucher_date DESC, g.created_at DESC
		LIMIT ?
	`, where)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]GoldReceipt, 0)
	for rows.Next() {
		var v GoldReceipt
		var price, total int64
		var lines string
		if err = rows.Scan(&v.ID, &v.VoucherNumber, &v.IssuerID, &v.ClientID, &v.ClientCode, &v.InvoiceID, &v.InvoiceNumber, &v.VoucherDate, &v.Kind, &v.TotalWeight, &price, &total, &lines, &v.Notes, &v.Status, &v.IssuerName, &v.ClientName, &v.CreatedBy, &v.CreatedAt); err != nil {
			return nil, err
		}
		v.GoldPrice = models.ToMajor(price)
		v.InvoiceTotal = models.ToMajor(total)
		if err = json.Unmarshal([]byte(lines), &v.Lines); err != nil {
			v.Lines = []GoldReceiptLine{}
		}
		result = append(result, v)
	}
	if err = rows.Err(); err != nil {
		return nil, err
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
