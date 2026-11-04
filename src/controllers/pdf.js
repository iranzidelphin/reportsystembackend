const PDFDocument = require('pdfkit')
const Transaction = require('../models/Transaction')
const User = require('../models/User')
const Expense = require('../models/Expense')
const { asyncHandler, dateFilter, log } = require('../utils')

const money = (value) => `${Number(value || 0).toLocaleString()} RWF`
const shopScope = (req, query = {}) => ['ADMIN', 'OWNER'].includes(req.user.role) ? query : { ...query, $or: [{ staff: req.user._id }, { createdBy: req.user._id }] }
const expenseScope = (req, query = {}) => ['ADMIN', 'OWNER'].includes(req.user.role) ? query : { ...query, createdBy: req.user._id }

function startPdf(res, filename, title, req) {
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`)

  const doc = new PDFDocument({ margin: 36, size: 'A4' })
  doc.pipe(res)
  doc.rect(0, 0, doc.page.width, 86).fill('#101d31')
  doc.fillColor('#ffffff').fontSize(18).text('MANAGEYOURSTOCK', 36, 28)
  doc.fillColor('#9bb7e8').fontSize(10).text(title.toUpperCase(), 36, 52)
  doc.fillColor('#526175').fontSize(9)
  doc.text(`Period: ${req.query.fromDate || 'Beginning'} to ${req.query.toDate || 'Today'}`, 36, 104)
  doc.text(`Generated: ${new Date().toLocaleString()}`, 36, 119)
  return doc
}

function summary(doc, items) {
  const y = 146
  const width = 96
  items.forEach(([label, value], index) => {
    const x = 36 + (index * (width + 10))
    doc.roundedRect(x, y, width, 54, 6).fillAndStroke('#f6f8fb', '#e2e8f0')
    doc.fillColor('#718096').fontSize(8).text(label.toUpperCase(), x + 12, y + 11)
    doc.fillColor('#17233a').fontSize(14).text(value, x + 12, y + 28, { width: width - 24 })
  })
}

function drawTable(doc, columns, rows, startY = 226) {
  const left = 36
  const rowHeight = 26
  let y = startY

  const drawHeader = () => {
    doc.rect(left, y, 523, rowHeight).fill('#246bfd')
    doc.fillColor('#ffffff').fontSize(7.5)
    columns.forEach((col) => doc.text(col.label.toUpperCase(), col.x, y + 9, { width: col.width, align: col.align || 'left' }))
    y += rowHeight
  }

  drawHeader()
  doc.fontSize(8)
  rows.forEach((row, index) => {
    if (y > 760) {
      doc.addPage()
      y = 36
      drawHeader()
    }
    doc.rect(left, y, 523, rowHeight).fill(index % 2 ? '#ffffff' : '#f8fafc')
    doc.strokeColor('#e5eaf1').moveTo(left, y + rowHeight).lineTo(left + 523, y + rowHeight).stroke()
    doc.fillColor('#17233a')
    columns.forEach((col) => {
      doc.text(String(row[col.key] ?? '-'), col.x, y + 8, { width: col.width, align: col.align || 'left', ellipsis: true })
    })
    y += rowHeight
  })

  if (!rows.length) {
    doc.rect(left, y, 523, 34).fill('#f8fafc')
    doc.fillColor('#718096').fontSize(9).text('No records found for this period.', left, y + 12, { width: 523, align: 'center' })
  }
}

exports.salesPdf = asyncHandler(async (req, res) => {
  const query = shopScope(req, dateFilter(req.query))
  if (req.query.userId) {
    if (!['ADMIN', 'OWNER'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Only administrators can filter sales by user.' })
    if (!/^[a-f\d]{24}$/i.test(req.query.userId)) return res.status(400).json({ success: false, message: 'Invalid user ID.' })
    query.$or = [{ staff: req.query.userId }, { createdBy: req.query.userId }]
  }
  const transactions = await Transaction.find(query).populate('staff', 'name fullName phoneNumber').sort({ transactionDate: -1 }).limit(1000)
  const totalPaid = transactions.reduce((sum, item) => sum + item.paidAmount, 0)
  const totalCashOut = transactions.reduce((sum, item) => sum + Number(item.cashOut || 0), 0)
  const totalCashIn = transactions.reduce((sum, item) => sum + (Number(item.paidAmount || 0) - Number(item.cashOut || 0)), 0)
  const totalRest = transactions.reduce((sum, item) => sum + item.remainingAmount, 0)
  const totalCash = transactions.reduce((sum, item) => sum + (item.paymentMethod === 'CASH' ? item.paidAmount : 0), 0)
  const totalMomo = transactions.reduce((sum, item) => sum + (item.paymentMethod === 'MOMO' ? item.paidAmount : 0), 0)
  const reportUser = req.query.userId ? await User.findById(req.query.userId).select('name fullName') : null
  const reportUserName = reportUser?.fullName || reportUser?.name || transactions[0]?.staff?.fullName || transactions[0]?.staff?.name
  const doc = startPdf(res, 'sales-report.pdf', reportUserName ? `Sales report: ${reportUserName}` : 'Sales report', req)

  if (reportUserName) {
    const products = Object.values(transactions.reduce((all, item) => { const key = item.serviceOrProduct || item.productOrService || 'Product'; const row = all[key] ||= { product: key, qty: 0, revenue: 0, profit: 0 }; row.qty += Number(item.quantity || 1); row.revenue += Number(item.totalAmount ?? item.paidAmount ?? 0); row.profit += Number(item.totalAmount ?? item.paidAmount ?? 0) - Number(item.unitCost || 0) * Number(item.quantity || 1); return all }, {}))
    summary(doc, [['Total sold', money(totalPaid)], ['Total earned', money(totalCashIn)], ['Sales', transactions.length]])
    doc.fillColor('#27364c').fontSize(12).text('Products sold', 36, 177)
    drawTable(doc, [{ key: 'product', label: 'Product', x: 44, width: 200 }, { key: 'qty', label: 'Qty', x: 250, width: 60, align: 'right' }, { key: 'revenue', label: 'Revenue', x: 330, width: 100, align: 'right' }, { key: 'profit', label: 'Profit', x: 450, width: 90, align: 'right' }], products.map((item) => ({ product: item.product, qty: item.qty, revenue: money(item.revenue), profit: money(item.profit) })))
    doc.addPage(); doc.fillColor('#27364c').fontSize(12).text('Sales', 36, 104)
    drawTable(doc, [{ key: 'date', label: 'Date', x: 44, width: 74 }, { key: 'product', label: 'Product', x: 125, width: 130 }, { key: 'customer', label: 'Customer', x: 262, width: 110 }, { key: 'method', label: 'Payment', x: 379, width: 70 }, { key: 'amount', label: 'Amount', x: 456, width: 84, align: 'right' }], transactions.map((item) => ({ date: new Date(item.transactionDate || item.saleDate).toLocaleDateString('en-GB'), product: item.serviceOrProduct || '-', customer: item.customerName || '-', method: item.paymentMethod === 'MOMO' ? 'MoMo Pay' : item.paymentMethod, amount: money(item.totalAmount ?? item.paidAmount) })))
    doc.end(); await log(req.user, 'DOWNLOAD_SALES_REPORT', 'Downloaded sales PDF report'); return
  }

  summary(doc, [['Amount', money(totalPaid)], ['Cash out', money(totalCashOut)], ['Cash in', money(totalCashIn)], ['Amount rest', money(totalRest)], ['Records', transactions.length]])
  drawTable(doc, [
    { key: 'date', label: 'Date', x: 44, width: 58 },
    { key: 'user', label: 'User', x: 106, width: 64 },
    { key: 'product', label: 'Product name', x: 174, width: 82 },
    { key: 'paid', label: 'Amount', x: 260, width: 52, align: 'right' },
    { key: 'cashOut', label: 'Cash out', x: 316, width: 52, align: 'right' },
    { key: 'cashIn', label: 'Cash in', x: 372, width: 52, align: 'right' },
    { key: 'rest', label: 'Rest', x: 428, width: 50, align: 'right' },
    { key: 'method', label: 'Method', x: 484, width: 44 },
    { key: 'description', label: 'Description', x: 532, width: 26 },
  ], transactions.map((item) => ({
    date: new Date(item.transactionDate || item.saleDate).toISOString().slice(0, 10),
    user: item.staff?.fullName || item.staff?.name || '-',
    product: item.serviceOrProduct || '-',
    paid: money(item.paidAmount),
    cashOut: money(item.cashOut),
    cashIn: money(Number(item.paidAmount || 0) - Number(item.cashOut || 0)),
    rest: money(item.remainingAmount),
    method: item.paymentMethod === 'MOMO' ? 'MoMo Pay' : 'Cash',
    description: item.notes || '-',
  })))

  doc.end()
  await log(req.user, 'DOWNLOAD_SALES_REPORT', 'Downloaded sales PDF report')
})

exports.stockPdf = asyncHandler(async (req, res) => {
  const query = expenseScope(req, dateFilter(req.query, 'expenseDate'))
  const rows = await Expense.find(query).populate('createdBy', 'name fullName phoneNumber').sort({ expenseDate: -1 }).limit(1000)
  const total = rows.reduce((sum, item) => sum + item.amount, 0)
  const doc = startPdf(res, 'Imported-stock-report.pdf', 'Imported stock report', req)

  summary(doc, [['Imported stock total', money(total)], ['Records', rows.length]])
  drawTable(doc, [
    { key: 'date', label: 'Date', x: 44, width: 68 },
    { key: 'user', label: 'User', x: 118, width: 92 },
    { key: 'description', label: 'What imported', x: 216, width: 178 },
    { key: 'amount', label: 'Amount', x: 402, width: 72, align: 'right' },
    { key: 'method', label: 'Method', x: 492, width: 58 },
  ], rows.map((item) => ({
    date: new Date(item.expenseDate || item.date || item.createdAt).toISOString().slice(0, 10),
    user: item.createdBy?.fullName || item.createdBy?.name || '-',
    description: item.description || '-',
    amount: money(item.amount),
    method: item.paymentMethod === 'MOMO' ? 'MoMo Pay' : 'Cash',
  })))

  doc.end()
  await log(req.user, 'DOWNLOAD_STOCK_REPORT', 'Downloaded imported stock PDF report')
})
