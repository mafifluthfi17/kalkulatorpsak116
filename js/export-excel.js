// ============================================================================
// Excel export (.xlsx) with styling, built on the ExcelJS browser bundle
// (loaded globally as window.ExcelJS via vendor/exceljs.min.js).
// ============================================================================

import { generateAllJournals } from "./journal-engine.js";
import { FREQUENCY_LABEL } from "./calc-engine.js";

const COLOR_HEADER_BG = "FF0F4C5C";
const COLOR_HEADER_TEXT = "FFFFFFFF";
const COLOR_TOTAL_BG = "FFEAF3F1";
const RP_FORMAT = '"Rp"#,##0;[Red]-"Rp"#,##0';
const DATE_FORMAT = "dd-mmm-yyyy";

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: COLOR_HEADER_TEXT } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_HEADER_BG } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FFCCCCCC" } } };
  });
  row.height = 26;
}

function autoWidth(sheet, widths) {
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
}

async function exportToExcel(result) {
  if (!window.ExcelJS) {
    throw new Error("Library Excel (ExcelJS) belum termuat. Periksa koneksi/berkas vendor/exceljs.min.js.");
  }
  const workbook = new window.ExcelJS.Workbook();
  workbook.creator = "Kalkulator Sewa PSAK 116";
  workbook.created = new Date();

  buildSummarySheet(workbook, result, "Ringkasan Kontrak");
  buildAmortizationSheet(workbook, result, "Amortisasi Liabilitas");
  buildDepreciationSheet(workbook, result, "Depresiasi ROU");
  buildJournalSheet(workbook, result, "Jurnal Akuntansi");

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const fileName = buildFileName(result);
  downloadBlob(blob, fileName);
}

/**
 * Export a consolidated workbook for the whole portfolio:
 *   Sheet 1: Ringkasan Portofolio (aggregate totals + per-contract mapping table)
 *   Then 4 sheets per contract: "K{n} Ringkasan/Amortisasi/Depresiasi/Jurnal"
 * `items` = [{ input, result }, ...] where `result` was computed with the shared
 * portfolio reporting date, so current/non-current portions are consistent.
 */
async function exportPortfolioToExcel(items, portfolioReportingDate) {
  if (!window.ExcelJS) {
    throw new Error("Library Excel (ExcelJS) belum termuat. Periksa koneksi/berkas vendor/exceljs.min.js.");
  }
  if (!items || items.length === 0) {
    throw new Error("Belum ada kontrak untuk diexport.");
  }
  const workbook = new window.ExcelJS.Workbook();
  workbook.creator = "Kalkulator Sewa PSAK 116";
  workbook.created = new Date();

  buildPortfolioSummarySheet(workbook, items, portfolioReportingDate);

  items.forEach((item, idx) => {
    const n = idx + 1;
    buildSummarySheet(workbook, item.result, `K${n} Ringkasan`);
    buildAmortizationSheet(workbook, item.result, `K${n} Amortisasi`);
    buildDepreciationSheet(workbook, item.result, `K${n} Depresiasi`);
    buildJournalSheet(workbook, item.result, `K${n} Jurnal`);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const dateStr = portfolioReportingDate || new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `PSAK116-Portofolio-${dateStr}.xlsx`);
}

function buildPortfolioSummarySheet(workbook, items, portfolioReportingDate) {
  const sheet = workbook.addWorksheet("Ringkasan Portofolio");

  sheet.mergeCells("A1:I1");
  sheet.getCell("A1").value = "RINGKASAN PORTOFOLIO SEWA - PSAK 116 / IFRS 16";
  sheet.getCell("A1").font = { bold: true, size: 14, color: { argb: COLOR_HEADER_TEXT } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_HEADER_BG } };
  sheet.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
  sheet.getRow(1).height = 28;

  sheet.getCell("A2").value = `Tanggal Pelaporan Portofolio: ${portfolioReportingDate}  |  Jumlah Kontrak: ${items.length}`;
  sheet.getCell("A2").font = { italic: true, size: 10, color: { argb: "FF808080" } };

  const totals = {
    rou: sumOverItems(items, "initialROU"),
    liability: sumOverItems(items, "initialLiability"),
    reportingBalance: sumOverItems(items, "reportingBalance"),
    current: sumOverItems(items, "currentPortion"),
    nonCurrent: sumOverItems(items, "nonCurrentPortion"),
    interest: items.reduce((s, it) => s + sumField(it.result.liabilitySchedule, "interestExpense"), 0),
    depreciation: items.reduce((s, it) => s + sumField(it.result.depreciationSchedule, "depreciationExpense"), 0),
  };

  const totalsRows = [
    ["Total Nilai Awal Aset Hak-Guna (ROU) - Seluruh Kontrak", totals.rou],
    ["Total Nilai Awal Liabilitas Sewa - Seluruh Kontrak", totals.liability],
    ["Total Saldo Liabilitas per Tanggal Pelaporan", totals.reportingBalance],
    ["Total Liabilitas - Bagian Jangka Pendek (Current)", totals.current],
    ["Total Liabilitas - Bagian Jangka Panjang (Non-Current)", totals.nonCurrent],
    ["Total Beban Bunga (seluruh masa sewa, seluruh kontrak)", totals.interest],
    ["Total Beban Amortisasi ROU (seluruh masa sewa, seluruh kontrak)", totals.depreciation],
  ];
  let r = 4;
  totalsRows.forEach(([label, value]) => {
    sheet.getCell(`A${r}`).value = label;
    sheet.getCell(`A${r}`).font = { bold: true };
    const cell = sheet.getCell(`C${r}`);
    cell.value = round2(value);
    cell.numFmt = RP_FORMAT;
    r++;
  });

  r += 1;
  const tableHeaderRow = r;
  const headers = [
    "No.",
    "Nama Aset / Kontrak",
    "Tgl Mulai Sewa",
    "Kode Sheet Detail",
    "ROU Awal",
    "Liability Awal",
    "Saldo per Tgl Pelaporan",
    "Current",
    "Non-Current",
  ];
  headers.forEach((h, i) => {
    sheet.getCell(tableHeaderRow, i + 1).value = h;
  });
  styleHeaderRow(sheet.getRow(tableHeaderRow));
  r++;

  items.forEach((item, idx) => {
    const n = idx + 1;
    const row = sheet.addRow([
      n,
      item.input.assetName,
      item.input.commencementDate,
      `K${n}-*`,
      item.result.initialROU,
      item.result.initialLiability,
      item.result.reportingBalance,
      item.result.currentPortion,
      item.result.nonCurrentPortion,
    ]);
    row.getCell(3).numFmt = DATE_FORMAT;
    [5, 6, 7, 8, 9].forEach((c) => (row.getCell(c).numFmt = RP_FORMAT));
    row.getCell(2).alignment = { horizontal: "left" };
    r++;
  });

  const noteRow = r + 1;
  sheet.mergeCells(`A${noteRow}:I${noteRow + 1}`);
  sheet.getCell(`A${noteRow}`).value =
    "Catatan: Kolom \"Kode Sheet Detail\" menunjuk ke 4 sheet rinci untuk kontrak tersebut (contoh: K1 Ringkasan, K1 Amortisasi, K1 Depresiasi, K1 Jurnal). Dokumen ini adalah hasil alat bantu hitung dan perlu direview oleh pihak yang kompeten sebelum digunakan dalam laporan keuangan resmi.";
  sheet.getCell(`A${noteRow}`).font = { italic: true, size: 9, color: { argb: "FF808080" } };
  sheet.getCell(`A${noteRow}`).alignment = { wrapText: true };

  sheet.views = [{ state: "frozen", ySplit: tableHeaderRow }];
  autoWidth(sheet, [6, 32, 14, 16, 18, 18, 20, 16, 16]);
}

function sumOverItems(items, field) {
  return round2(items.reduce((s, it) => s + it.result[field], 0));
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function buildFileName(result) {
  const safeName = (result.input.assetName || "Kontrak").replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 60);
  const dateStr = result.input.reportingDate || new Date().toISOString().slice(0, 10);
  return `PSAK116-${safeName}-${dateStr}.xlsx`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------------------
// Sheet 1: Ringkasan Kontrak
// ---------------------------------------------------------------------------
function buildSummarySheet(workbook, result, sheetName) {
  const sheet = workbook.addWorksheet(sheetName);
  const input = result.input;

  sheet.mergeCells("A1:C1");
  sheet.getCell("A1").value = "RINGKASAN KONTRAK SEWA - PSAK 116 / IFRS 16";
  sheet.getCell("A1").font = { bold: true, size: 14, color: { argb: COLOR_HEADER_TEXT } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_HEADER_BG } };
  sheet.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
  sheet.getRow(1).height = 28;

  const rows = [
    ["Nama Aset / Kontrak Sewa", input.assetName],
    ["Tanggal Mulai Sewa (Commencement Date)", input.commencementDate, "date"],
    ["Tanggal Pelaporan", input.reportingDate, "date"],
    ["Jangka Waktu Sewa (Tenor Dasar)", `${input.tenorMonths} bulan`],
    ["Opsi Perpanjangan (Reasonably Certain)", input.hasExtensionOption ? `Ya, tambahan ${input.extensionMonths} bulan` : "Tidak"],
    ["Total Masa Sewa Digunakan", `${result.meta.totalTenorMonths} bulan`],
    ["Nilai Pembayaran Sewa per Periode", input.paymentAmount, "money"],
    ["Frekuensi Pembayaran", FREQUENCY_LABEL[input.frequency]],
    ["Timing Pembayaran", input.timingLabel],
    ["Incremental Borrowing Rate (IBR) Tahunan", `${input.ibrAnnualPercent}%`],
    ["Biaya Langsung Awal (Initial Direct Cost)", input.initialDirectCost, "money"],
    ["Insentif Sewa dari Lessor", input.leaseIncentive, "money"],
    ["Nilai Residu Bergaransi (Guaranteed Residual Value)", input.guaranteedResidualValue, "money"],
    ["Transfer Kepemilikan / Opsi Beli Reasonably Certain", input.ownershipTransfer ? `Ya (umur ekonomis: ${input.usefulLifeMonths} bulan)` : "Tidak"],
    [null, null],
    ["HASIL KALKULASI", null, "section"],
    ["Nilai Awal Aset Hak-Guna (ROU Asset)", result.initialROU, "money"],
    ["Nilai Awal Liabilitas Sewa", result.initialLiability, "money"],
    ["Saldo Liabilitas Sewa per Tanggal Pelaporan", result.reportingBalance, "money"],
    ["Liabilitas Sewa - Bagian Jangka Pendek (Current)", result.currentPortion, "money"],
    ["Liabilitas Sewa - Bagian Jangka Panjang (Non-Current)", result.nonCurrentPortion, "money"],
    ["Total Jumlah Periode Pembayaran", result.meta.totalPeriods],
    ["Total Beban Bunga Selama Masa Sewa", sumField(result.liabilitySchedule, "interestExpense"), "money"],
    ["Total Beban Amortisasi ROU Asset", sumField(result.depreciationSchedule, "depreciationExpense"), "money"],
  ];

  let r = 3;
  rows.forEach((row) => {
    if (row[0] === null) {
      r++;
      return;
    }
    const [label, value, type] = row;
    if (type === "section") {
      sheet.mergeCells(`A${r}:C${r}`);
      const cell = sheet.getCell(`A${r}`);
      cell.value = label;
      cell.font = { bold: true, size: 12 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_TOTAL_BG } };
      r++;
      return;
    }
    sheet.getCell(`A${r}`).value = label;
    sheet.getCell(`A${r}`).font = { bold: true };
    const valueCell = sheet.getCell(`C${r}`);
    valueCell.value = value;
    if (type === "money") valueCell.numFmt = RP_FORMAT;
    if (type === "date") valueCell.numFmt = DATE_FORMAT;
    valueCell.alignment = { horizontal: type === "money" || type === "date" ? "right" : "left" };
    r++;
  });

  autoWidth(sheet, [45, 4, 30]);

  const noteRow = r + 1;
  sheet.mergeCells(`A${noteRow}:C${noteRow + 1}`);
  sheet.getCell(`A${noteRow}`).value =
    "Disclaimer: Dokumen ini adalah hasil alat bantu hitung dan perlu direview oleh pihak yang kompeten sebelum digunakan dalam laporan keuangan resmi.";
  sheet.getCell(`A${noteRow}`).font = { italic: true, size: 9, color: { argb: "FF808080" } };
  sheet.getCell(`A${noteRow}`).alignment = { wrapText: true };
}

function sumField(arr, field) {
  return Math.round(arr.reduce((s, r) => s + r[field], 0) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Sheet 2: Amortization schedule
// ---------------------------------------------------------------------------
function buildAmortizationSheet(workbook, result, sheetName) {
  const sheet = workbook.addWorksheet(sheetName);
  const headers = [
    "Periode",
    "Tanggal Mulai",
    "Tanggal Akhir",
    "Saldo Awal",
    "Beban Bunga",
    "Pembayaran Sewa",
    "Pelunasan Residu (GRV)",
    "Total Kas Dibayar",
    "Pengurangan Pokok",
    "Saldo Akhir",
  ];
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow);

  result.liabilitySchedule.forEach((r) => {
    const row = sheet.addRow([
      r.period,
      r.periodStartDate,
      r.periodEndDate,
      r.openingBalance,
      r.interestExpense,
      r.leasePayment,
      r.grvSettlement || 0,
      r.totalCashPayment,
      r.principalReduction,
      r.closingBalance,
    ]);
    [2, 3].forEach((c) => (row.getCell(c).numFmt = DATE_FORMAT));
    [4, 5, 6, 7, 8, 9, 10].forEach((c) => (row.getCell(c).numFmt = RP_FORMAT));
  });

  const totalRow = sheet.addRow([
    "TOTAL",
    "",
    "",
    "",
    sumField(result.liabilitySchedule, "interestExpense"),
    sumField(result.liabilitySchedule, "leasePayment"),
    sumField(result.liabilitySchedule, "grvSettlement"),
    sumField(result.liabilitySchedule, "totalCashPayment"),
    sumField(result.liabilitySchedule, "principalReduction"),
    "",
  ]);
  totalRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_TOTAL_BG } };
  });
  [5, 6, 7, 8, 9].forEach((c) => (totalRow.getCell(c).numFmt = RP_FORMAT));

  sheet.views = [{ state: "frozen", ySplit: 1 }];
  autoWidth(sheet, [8, 13, 13, 16, 14, 15, 16, 15, 16, 16]);
}

// ---------------------------------------------------------------------------
// Sheet 3: Depreciation schedule
// ---------------------------------------------------------------------------
function buildDepreciationSheet(workbook, result, sheetName) {
  const sheet = workbook.addWorksheet(sheetName);
  const headers = ["Periode", "Tanggal Mulai", "Tanggal Akhir", "Beban Amortisasi", "Akumulasi Amortisasi", "Nilai Buku Bersih (ROU)"];
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow);

  result.depreciationSchedule.forEach((r) => {
    const row = sheet.addRow([r.period, r.periodStartDate, r.periodEndDate, r.depreciationExpense, r.accumulatedDepreciation, r.netBookValue]);
    [2, 3].forEach((c) => (row.getCell(c).numFmt = DATE_FORMAT));
    [4, 5, 6].forEach((c) => (row.getCell(c).numFmt = RP_FORMAT));
  });

  const totalRow = sheet.addRow(["TOTAL", "", "", sumField(result.depreciationSchedule, "depreciationExpense"), "", ""]);
  totalRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_TOTAL_BG } };
  });
  totalRow.getCell(4).numFmt = RP_FORMAT;

  sheet.views = [{ state: "frozen", ySplit: 1 }];
  autoWidth(sheet, [8, 13, 13, 16, 18, 18]);
}

// ---------------------------------------------------------------------------
// Sheet 4: Journal entries
// ---------------------------------------------------------------------------
function buildJournalSheet(workbook, result, sheetName) {
  const sheet = workbook.addWorksheet(sheetName);
  const headers = ["Tanggal", "Keterangan", "Akun", "Debit", "Kredit"];
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow);

  const entries = generateAllJournals(result);
  let totalDebit = 0;
  let totalCredit = 0;

  entries.forEach((entry) => {
    entry.lines.forEach((line, idx) => {
      const row = sheet.addRow([entry.date, idx === 0 ? entry.description : "", line.account, line.debit || null, line.credit || null]);
      row.getCell(1).numFmt = DATE_FORMAT;
      row.getCell(4).numFmt = RP_FORMAT;
      row.getCell(5).numFmt = RP_FORMAT;
      row.getCell(3).alignment = { indent: 1 };
      if (idx === 0) {
        row.getCell(1).border = { top: { style: "thin", color: { argb: "FFCCCCCC" } } };
      }
      totalDebit += line.debit || 0;
      totalCredit += line.credit || 0;
    });
    if (entry.note) {
      const noteRow = sheet.addRow(["", `Catatan: ${entry.note}`, "", "", ""]);
      noteRow.getCell(2).font = { italic: true, size: 9, color: { argb: "FF808080" } };
    }
  });

  const totalRow = sheet.addRow(["", "TOTAL", "", Math.round(totalDebit * 100) / 100, Math.round(totalCredit * 100) / 100]);
  totalRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_TOTAL_BG } };
  });
  totalRow.getCell(4).numFmt = RP_FORMAT;
  totalRow.getCell(5).numFmt = RP_FORMAT;

  sheet.views = [{ state: "frozen", ySplit: 1 }];
  autoWidth(sheet, [13, 42, 40, 16, 16]);
}

export { exportToExcel, exportPortfolioToExcel };
