import { calculateLease, validateLeaseInput, FREQUENCY_LABEL } from "./calc-engine.js";
import { generateAllJournals } from "./journal-engine.js";
import { exportToExcel, exportPortfolioToExcel } from "./export-excel.js";
import { listContracts, upsertContract, deleteContract, getContract, getLastMode, setLastMode } from "./storage.js";

const TOTAL_STEPS = 5;
const SCREENS = ["modeSelect", "portfolio", "wizard", "results"];

let currentStep = 1;
let appMode = null; // "single" | "multiple" | null
let editingContractId = null; // set when the wizard is editing a saved contract
let lastResult = null;
let lastInputRaw = null;
let portfolioReportingDateValue = null;
let lastPortfolioItems = [];

const fmtCurrency = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});
const fmtDate = (iso) => {
  if (!iso) return "-";
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
};
const fmtPercent = (n) => `${Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;

const STEP_FIELDS = {
  1: ["assetName", "commencementDate", "reportingDate"],
  2: ["tenorMonths", "paymentAmount", "frequency", "timing", "extensionMonths"],
  3: ["ibrAnnualPercent"],
  4: ["initialDirectCost", "leaseIncentive", "guaranteedResidualValue", "usefulLifeMonths"],
  5: [],
};

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const modeBar = document.getElementById("modeBar");
const modeBarLabel = document.getElementById("modeBarLabel");
const btnSwitchMode = document.getElementById("btnSwitchMode");

const modeSelectSection = document.getElementById("modeSelect");
const portfolioSection = document.getElementById("portfolio");
const portfolioEmptyState = document.getElementById("portfolioEmptyState");
const portfolioContentEl = document.getElementById("portfolioContent");
const portfolioReportingDateInput = document.getElementById("portfolioReportingDate");
const portfolioSummaryCardsEl = document.getElementById("portfolioSummaryCards");
const tblPortfolio = document.getElementById("tblPortfolio");
const btnAddContract = document.getElementById("btnAddContract");
const btnExportPortfolio = document.getElementById("btnExportPortfolio");

const wizardSection = document.getElementById("wizard");
const btnWizardBack = document.getElementById("btnWizardBack");
const form = document.getElementById("lease-form");
const btnPrev = document.getElementById("btnPrev");
const btnNext = document.getElementById("btnNext");
const btnCalculate = document.getElementById("btnCalculate");
const extensionCheckbox = document.getElementById("hasExtensionOption");
const extensionFieldWrap = document.getElementById("extensionFieldWrap");
const ownershipCheckbox = document.getElementById("ownershipTransfer");
const usefulLifeFieldWrap = document.getElementById("usefulLifeFieldWrap");
const ibrGuidanceToggle = document.getElementById("ibrGuidanceToggle");
const ibrGuidancePanel = document.getElementById("ibrGuidancePanel");

const resultsSection = document.getElementById("results");
const btnResultsBack = document.getElementById("btnResultsBack");
const btnNewCalc = document.getElementById("btnNewCalc");
const btnSaveToPortfolio = document.getElementById("btnSaveToPortfolio");
const btnGoPortfolio = document.getElementById("btnGoPortfolio");
const savedIndicator = document.getElementById("savedIndicator");
const resultsContractName = document.getElementById("resultsContractName");
const btnExportExcel = document.getElementById("btnExportExcel");

const toastEl = document.getElementById("toast");

init();

function init() {
  document.querySelectorAll(".mode-card").forEach((card) => {
    card.addEventListener("click", () => selectMode(card.dataset.mode));
  });
  btnSwitchMode.addEventListener("click", () => {
    appMode = null;
    showScreen("modeSelect");
  });

  btnAddContract.addEventListener("click", () => {
    editingContractId = null;
    resetWizardForm();
    showScreen("wizard");
  });
  portfolioReportingDateInput.addEventListener("change", () => {
    portfolioReportingDateValue = portfolioReportingDateInput.value;
    renderPortfolio();
  });
  btnExportPortfolio.addEventListener("click", onExportPortfolio);
  tblPortfolio.addEventListener("click", onPortfolioTableClick);

  btnWizardBack.addEventListener("click", () => {
    if (appMode === "multiple") {
      renderPortfolio();
      showScreen("portfolio");
    } else {
      appMode = null;
      showScreen("modeSelect");
    }
  });

  extensionCheckbox.addEventListener("change", () => {
    extensionFieldWrap.hidden = !extensionCheckbox.checked;
  });
  ownershipCheckbox.addEventListener("change", () => {
    usefulLifeFieldWrap.hidden = !ownershipCheckbox.checked;
  });
  ibrGuidanceToggle.addEventListener("click", () => {
    const expanded = ibrGuidanceToggle.getAttribute("aria-expanded") === "true";
    ibrGuidanceToggle.setAttribute("aria-expanded", String(!expanded));
    ibrGuidancePanel.hidden = expanded;
  });
  btnNext.addEventListener("click", onClickNext);
  btnPrev.addEventListener("click", () => goToStep(currentStep - 1));
  form.addEventListener("submit", onSubmit);

  btnResultsBack.addEventListener("click", () => showScreen("wizard"));
  btnNewCalc.addEventListener("click", () => {
    editingContractId = null;
    resetWizardForm();
    showScreen("wizard");
  });
  btnSaveToPortfolio.addEventListener("click", onSaveToPortfolio);
  btnGoPortfolio.addEventListener("click", () => {
    renderPortfolio();
    showScreen("portfolio");
  });
  btnExportExcel.addEventListener("click", onExportExcel);

  document.querySelectorAll(".tabs__btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  const lastMode = getLastMode();
  if (lastMode === "single" || lastMode === "multiple") {
    appMode = lastMode;
    if (appMode === "multiple") {
      renderPortfolio();
      showScreen("portfolio");
    } else {
      resetWizardForm();
      showScreen("wizard");
    }
  } else {
    showScreen("modeSelect");
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch((err) => console.warn("SW registration failed:", err));
    });
  }
}

function selectMode(mode) {
  appMode = mode;
  setLastMode(mode);
  if (mode === "multiple") {
    renderPortfolio();
    showScreen("portfolio");
  } else {
    editingContractId = null;
    resetWizardForm();
    showScreen("wizard");
  }
}

function showScreen(name) {
  SCREENS.forEach((s) => {
    document.getElementById(s).hidden = s !== name;
  });
  modeBar.hidden = name === "modeSelect" || !appMode;
  if (appMode) {
    modeBarLabel.textContent = appMode === "single" ? "Mode: Satu Kontrak" : "Mode: Multi-Kontrak (Portofolio)";
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------------------------------------------------------------------------
// Wizard: form <-> data helpers
// ---------------------------------------------------------------------------

function collectRawFormData() {
  const fd = new FormData(form);
  const tenorUnit = fd.get("tenorUnit");
  const tenorValue = Number(fd.get("tenorValue") || 0);
  const extensionUnit = fd.get("extensionUnit");
  const extensionValue = Number(fd.get("extensionValue") || 0);
  const usefulLifeUnit = fd.get("usefulLifeUnit");
  const usefulLifeValue = Number(fd.get("usefulLifeValue") || 0);

  return {
    assetName: (fd.get("assetName") || "").trim(),
    commencementDate: fd.get("commencementDate"),
    reportingDate: fd.get("reportingDate"),
    tenorMonths: tenorValue > 0 ? tenorValue * (tenorUnit === "year" ? 12 : 1) : 0,
    paymentAmount: fd.get("paymentAmount") === "" ? "" : Number(fd.get("paymentAmount")),
    frequency: fd.get("frequency"),
    timing: fd.get("timing"),
    ibrAnnualPercent: fd.get("ibrAnnualPercent") === "" ? "" : Number(fd.get("ibrAnnualPercent")),
    initialDirectCost: Number(fd.get("initialDirectCost") || 0),
    leaseIncentive: Number(fd.get("leaseIncentive") || 0),
    guaranteedResidualValue: Number(fd.get("guaranteedResidualValue") || 0),
    hasExtensionOption: extensionCheckbox.checked,
    extensionMonths: extensionCheckbox.checked ? extensionValue * (extensionUnit === "year" ? 12 : 1) : 0,
    ownershipTransfer: ownershipCheckbox.checked,
    usefulLifeMonths: ownershipCheckbox.checked ? usefulLifeValue * (usefulLifeUnit === "year" ? 12 : 1) : 0,
  };
}

function monthsToValueUnit(months) {
  const m = Number(months) || 0;
  if (m > 0 && m % 12 === 0) return { value: m / 12, unit: "year" };
  return { value: m, unit: "month" };
}

/** Pre-fill the wizard form from a previously stored input object (edit flow). */
function fillFormFromInput(input) {
  document.getElementById("assetName").value = input.assetName || "";
  document.getElementById("commencementDate").value = input.commencementDate || "";
  document.getElementById("reportingDate").value = input.reportingDate || "";

  const tenor = monthsToValueUnit(input.tenorMonths);
  document.getElementById("tenorValue").value = tenor.value;
  document.getElementById("tenorUnit").value = tenor.unit;

  document.getElementById("paymentAmount").value = input.paymentAmount;
  document.getElementById("frequency").value = input.frequency;
  const timingInput = document.querySelector(`input[name="timing"][value="${input.timing}"]`);
  if (timingInput) timingInput.checked = true;

  extensionCheckbox.checked = !!input.hasExtensionOption;
  extensionFieldWrap.hidden = !input.hasExtensionOption;
  if (input.hasExtensionOption) {
    const ext = monthsToValueUnit(input.extensionMonths);
    document.getElementById("extensionValue").value = ext.value;
    document.getElementById("extensionUnit").value = ext.unit;
  }

  document.getElementById("ibrAnnualPercent").value = input.ibrAnnualPercent;

  document.getElementById("initialDirectCost").value = input.initialDirectCost || 0;
  document.getElementById("leaseIncentive").value = input.leaseIncentive || 0;
  document.getElementById("guaranteedResidualValue").value = input.guaranteedResidualValue || 0;

  ownershipCheckbox.checked = !!input.ownershipTransfer;
  usefulLifeFieldWrap.hidden = !input.ownershipTransfer;
  if (input.ownershipTransfer) {
    const ul = monthsToValueUnit(input.usefulLifeMonths);
    document.getElementById("usefulLifeValue").value = ul.value;
    document.getElementById("usefulLifeUnit").value = ul.unit;
  }

  document.querySelectorAll(".has-error").forEach((el) => el.classList.remove("has-error"));
  document.querySelectorAll(".field__error").forEach((el) => (el.textContent = ""));
}

function resetWizardForm() {
  form.reset();
  document.querySelectorAll(".has-error").forEach((el) => el.classList.remove("has-error"));
  document.querySelectorAll(".field__error").forEach((el) => (el.textContent = ""));
  extensionFieldWrap.hidden = true;
  usefulLifeFieldWrap.hidden = true;
  ibrGuidancePanel.hidden = true;
  ibrGuidanceToggle.setAttribute("aria-expanded", "false");
  lastResult = null;
  lastInputRaw = null;
  const todayIso = new Date().toISOString().slice(0, 10);
  document.getElementById("commencementDate").value = todayIso;
  document.getElementById("reportingDate").value = todayIso;
  goToStep(1);
}

// ---------------------------------------------------------------------------
// Wizard navigation
// ---------------------------------------------------------------------------

function showStepErrors(errors) {
  document.querySelectorAll(".field__error").forEach((el) => (el.textContent = ""));
  document.querySelectorAll(".has-error").forEach((el) => el.classList.remove("has-error"));

  Object.entries(errors).forEach(([field, message]) => {
    const errorEl = document.querySelector(`[data-error-for="${field}"]`);
    if (errorEl) errorEl.textContent = message;
    const inputMap = {
      tenorMonths: "tenorValue",
      extensionMonths: "extensionValue",
      usefulLifeMonths: "usefulLifeValue",
    };
    const inputId = inputMap[field] || field;
    const inputEl = document.getElementById(inputId);
    if (inputEl) inputEl.classList.add("has-error");
  });
}

function onClickNext() {
  const data = collectRawFormData();
  const { errors } = validateLeaseInput({ ...data, reportingDate: data.reportingDate || "x" });
  const relevantFields = STEP_FIELDS[currentStep];
  const stepErrors = Object.fromEntries(Object.entries(errors).filter(([field]) => relevantFields.includes(field)));

  if (Object.keys(stepErrors).length > 0) {
    showStepErrors(stepErrors);
    showToast("Periksa kembali input yang ditandai merah.", true);
    return;
  }
  showStepErrors({});
  if (currentStep === TOTAL_STEPS - 1) {
    renderReview(data);
  }
  goToStep(currentStep + 1);
}

function goToStep(step) {
  currentStep = step;
  document.querySelectorAll(".step").forEach((el) => {
    el.classList.toggle("is-active", Number(el.dataset.step) === step);
  });
  document.querySelectorAll(".stepper__item").forEach((el) => {
    const s = Number(el.dataset.step);
    el.classList.toggle("is-active", s === step);
    el.classList.toggle("is-done", s < step);
  });
  btnPrev.hidden = step === 1;
  btnNext.hidden = step === TOTAL_STEPS;
  btnCalculate.hidden = step !== TOTAL_STEPS;
  btnCalculate.textContent = editingContractId ? "Simpan Perubahan" : "Hitung Sekarang";
  btnWizardBack.hidden = step !== 1;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderReview(data) {
  const rows = [
    ["group", "Kontrak"],
    ["Nama aset/kontrak", data.assetName],
    ["Tanggal mulai sewa", fmtDate(data.commencementDate)],
    ["Tanggal pelaporan", fmtDate(data.reportingDate)],
    ["group", "Pembayaran"],
    ["Jangka waktu sewa", `${data.tenorMonths} bulan`],
    ["Nilai pembayaran per periode", fmtCurrency.format(data.paymentAmount || 0)],
    ["Frekuensi pembayaran", FREQUENCY_LABEL[data.frequency] || "-"],
    ["Timing pembayaran", data.timing === "advance" ? "Awal periode (annuity due)" : "Akhir periode (ordinary annuity)"],
    ["Opsi perpanjangan", data.hasExtensionOption ? `Ya, tambahan ${data.extensionMonths} bulan` : "Tidak"],
    ["group", "Suku Bunga"],
    ["IBR tahunan", fmtPercent(data.ibrAnnualPercent || 0)],
    ["group", "Penyesuaian Lain"],
    ["Biaya langsung awal", fmtCurrency.format(data.initialDirectCost || 0)],
    ["Insentif sewa dari lessor", fmtCurrency.format(data.leaseIncentive || 0)],
    ["Nilai residu bergaransi", fmtCurrency.format(data.guaranteedResidualValue || 0)],
    ["Transfer kepemilikan / opsi beli", data.ownershipTransfer ? `Ya, umur ekonomis ${data.usefulLifeMonths} bulan` : "Tidak"],
  ];

  const html = rows
    .map(([label, value]) => {
      if (label === "group") return `<p class="review-group-title">${escapeHtml(value)}</p>`;
      return `<div class="review-row"><span class="review-row__label">${escapeHtml(label)}</span><span class="review-row__value">${escapeHtml(value)}</span></div>`;
    })
    .join("");

  document.getElementById("reviewSummary").innerHTML = html;
}

// ---------------------------------------------------------------------------
// Calculation & single-contract results
// ---------------------------------------------------------------------------

function onSubmit(e) {
  e.preventDefault();
  const data = collectRawFormData();
  const result = calculateLease(data);

  if (!result.valid) {
    for (let s = 1; s <= TOTAL_STEPS; s++) {
      const fields = STEP_FIELDS[s];
      if (fields.some((f) => result.errors[f])) {
        goToStep(s);
        showStepErrors(result.errors);
        showToast("Ada input yang perlu diperbaiki sebelum kalkulasi dapat dijalankan.", true);
        return;
      }
    }
    showToast("Input tidak valid.", true);
    return;
  }

  lastResult = result;
  lastInputRaw = data;

  if (appMode === "multiple") {
    const saveRes = upsertContract(data, editingContractId);
    if (saveRes.ok) {
      editingContractId = saveRes.id;
      showToast(editingContractId ? "Kontrak tersimpan di portofolio." : "Kontrak baru tersimpan di portofolio.");
    } else {
      showToast("Kalkulasi berhasil, tapi gagal disimpan ke portofolio: " + saveRes.error, true);
    }
    savedIndicator.hidden = false;
    btnSaveToPortfolio.hidden = true;
    btnGoPortfolio.hidden = false;
  } else {
    savedIndicator.hidden = true;
    btnSaveToPortfolio.hidden = false;
    btnSaveToPortfolio.disabled = false;
    btnSaveToPortfolio.textContent = "💾 Simpan ke Portofolio";
    btnGoPortfolio.hidden = true;
  }

  renderResults(result);
  showScreen("results");
}

function onSaveToPortfolio() {
  if (!lastInputRaw) return;
  const res = upsertContract(lastInputRaw, editingContractId);
  if (res.ok) {
    editingContractId = res.id;
    savedIndicator.hidden = false;
    btnSaveToPortfolio.hidden = true;
    showToast("Kontrak tersimpan ke portofolio. Anda bisa lihat di mode Multi-Kontrak.");
  } else {
    showToast("Gagal menyimpan ke portofolio: " + res.error, true);
  }
}

function renderResults(result) {
  resultsContractName.textContent = result.input.assetName || "";
  renderSummaryCards(result);
  renderAmortizationTable(result);
  renderDepreciationTable(result);
  renderJournalTable(result);
  switchTab("amortization");
}

function renderSummaryCards(result) {
  const totalInterest = result.liabilitySchedule.reduce((s, r) => s + r.interestExpense, 0);
  const totalDepreciation = result.depreciationSchedule.reduce((s, r) => s + r.depreciationExpense, 0);

  const cards = [
    ["Nilai Awal Aset Hak-Guna (ROU)", fmtCurrency.format(result.initialROU)],
    ["Nilai Awal Liabilitas Sewa", fmtCurrency.format(result.initialLiability)],
    ["Saldo Liabilitas per Tanggal Pelaporan", fmtCurrency.format(result.reportingBalance)],
    ["Liabilitas Sewa - Bagian Jangka Pendek", fmtCurrency.format(result.currentPortion)],
    ["Liabilitas Sewa - Bagian Jangka Panjang", fmtCurrency.format(result.nonCurrentPortion)],
    ["Total Jumlah Periode", `${result.meta.totalPeriods} periode (${FREQUENCY_LABEL[result.input.frequency]})`],
    ["Total Beban Bunga (seluruh masa sewa)", fmtCurrency.format(totalInterest)],
    ["Total Beban Amortisasi ROU (ditampilkan)", fmtCurrency.format(totalDepreciation)],
  ];

  document.getElementById("summaryCards").innerHTML = cards
    .map(
      ([label, value]) => `
      <div class="summary-card">
        <p class="summary-card__label">${label}</p>
        <p class="summary-card__value ${value.length > 16 ? "is-small" : ""}">${value}</p>
      </div>`
    )
    .join("");
}

function renderAmortizationTable(result) {
  const rows = result.liabilitySchedule;
  const head = `<thead><tr>
    <th class="text-left">Periode</th>
    <th class="text-left">Tanggal</th>
    <th>Saldo Awal</th>
    <th>Beban Bunga</th>
    <th>Pembayaran Sewa</th>
    <th>Pelunasan Residu (GRV)</th>
    <th>Total Kas Dibayar</th>
    <th>Pengurangan Pokok</th>
    <th>Saldo Akhir</th>
  </tr></thead>`;
  const body = rows
    .map(
      (r) => `<tr>
      <td class="text-left">${r.period}</td>
      <td class="text-left">${fmtDate(r.periodEndDate)}</td>
      <td>${fmtCurrency.format(r.openingBalance)}</td>
      <td>${fmtCurrency.format(r.interestExpense)}</td>
      <td>${fmtCurrency.format(r.leasePayment)}</td>
      <td>${r.grvSettlement > 0 ? fmtCurrency.format(r.grvSettlement) : "-"}</td>
      <td>${fmtCurrency.format(r.totalCashPayment)}</td>
      <td>${fmtCurrency.format(r.principalReduction)}</td>
      <td>${fmtCurrency.format(r.closingBalance)}</td>
    </tr>`
    )
    .join("");
  document.getElementById("tblAmortization").innerHTML = head + `<tbody>${body}</tbody>`;
}

function renderDepreciationTable(result) {
  const rows = result.depreciationSchedule;
  const head = `<thead><tr>
    <th class="text-left">Periode</th>
    <th class="text-left">Tanggal</th>
    <th>Beban Amortisasi</th>
    <th>Akumulasi Amortisasi</th>
    <th>Nilai Buku Bersih (ROU)</th>
  </tr></thead>`;
  const body = rows
    .map(
      (r) => `<tr>
      <td class="text-left">${r.period}</td>
      <td class="text-left">${fmtDate(r.periodEndDate)}</td>
      <td>${fmtCurrency.format(r.depreciationExpense)}</td>
      <td>${fmtCurrency.format(r.accumulatedDepreciation)}</td>
      <td>${fmtCurrency.format(r.netBookValue)}</td>
    </tr>`
    )
    .join("");
  document.getElementById("tblDepreciation").innerHTML = head + `<tbody>${body}</tbody>`;
}

function renderJournalTable(result) {
  const entries = generateAllJournals(result);
  const head = `<thead><tr>
    <th class="text-left">Tanggal</th>
    <th class="text-left">Keterangan</th>
    <th class="text-left">Akun</th>
    <th>Debit</th>
    <th>Kredit</th>
  </tr></thead>`;
  const body = entries
    .map((entry) => {
      return entry.lines
        .map(
          (line, li) => `<tr class="${li === 0 ? "row-journal-group" : ""}">
          <td class="text-left">${li === 0 ? fmtDate(entry.date) : ""}</td>
          <td class="text-left">${li === 0 ? escapeHtml(entry.description) : ""}</td>
          <td class="text-left">${escapeHtml(line.account)}</td>
          <td>${line.debit > 0 ? fmtCurrency.format(line.debit) : "-"}</td>
          <td>${line.credit > 0 ? fmtCurrency.format(line.credit) : "-"}</td>
        </tr>`
        )
        .join("");
    })
    .join("");
  document.getElementById("tblJournal").innerHTML = head + `<tbody>${body}</tbody>`;
}

function switchTab(tabName) {
  document.querySelectorAll(".tabs__btn").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.tab === tabName));
  document.querySelectorAll(".tabs__panel").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.tabPanel === tabName));
}

async function onExportExcel() {
  if (!lastResult) return;
  btnExportExcel.disabled = true;
  btnExportExcel.textContent = "Menyiapkan file...";
  try {
    await exportToExcel(lastResult);
    showToast("File Excel berhasil diunduh.");
  } catch (err) {
    console.error(err);
    showToast("Gagal membuat file Excel: " + err.message, true);
  } finally {
    btnExportExcel.disabled = false;
    btnExportExcel.textContent = "⬇ Export ke Excel (.xlsx)";
  }
}

// ---------------------------------------------------------------------------
// Portfolio (multi-contract) dashboard
// ---------------------------------------------------------------------------

function renderPortfolio() {
  const contracts = listContracts();

  if (contracts.length === 0) {
    portfolioEmptyState.hidden = false;
    portfolioContentEl.hidden = true;
    lastPortfolioItems = [];
    return;
  }

  portfolioEmptyState.hidden = true;
  portfolioContentEl.hidden = false;

  if (!portfolioReportingDateValue) {
    portfolioReportingDateValue = new Date().toISOString().slice(0, 10);
  }
  portfolioReportingDateInput.value = portfolioReportingDateValue;

  const items = [];
  contracts.forEach((c) => {
    const result = calculateLease({ ...c.input, reportingDate: portfolioReportingDateValue });
    if (!result.valid) {
      console.warn("Kontrak tersimpan tidak valid, dilewati dari ringkasan portofolio:", c.id, result.errors);
      return;
    }
    items.push({ id: c.id, input: c.input, result });
  });

  lastPortfolioItems = items;
  renderPortfolioSummaryCards(items);
  renderPortfolioTable(items);
}

function renderPortfolioSummaryCards(items) {
  const totalROU = items.reduce((s, it) => s + it.result.initialROU, 0);
  const totalLiability = items.reduce((s, it) => s + it.result.initialLiability, 0);
  const totalReportingBalance = items.reduce((s, it) => s + it.result.reportingBalance, 0);
  const totalCurrent = items.reduce((s, it) => s + it.result.currentPortion, 0);
  const totalNonCurrent = items.reduce((s, it) => s + it.result.nonCurrentPortion, 0);
  const totalInterest = items.reduce((s, it) => s + it.result.liabilitySchedule.reduce((ss, r) => ss + r.interestExpense, 0), 0);
  const totalDep = items.reduce((s, it) => s + it.result.depreciationSchedule.reduce((ss, r) => ss + r.depreciationExpense, 0), 0);

  const cards = [
    ["Jumlah Kontrak", String(items.length)],
    ["Total Nilai Awal ROU Asset (Semua Kontrak)", fmtCurrency.format(totalROU)],
    ["Total Nilai Awal Liabilitas Sewa (Semua Kontrak)", fmtCurrency.format(totalLiability)],
    ["Total Saldo Liabilitas per Tgl Pelaporan", fmtCurrency.format(totalReportingBalance)],
    ["Total Liabilitas - Jangka Pendek", fmtCurrency.format(totalCurrent)],
    ["Total Liabilitas - Jangka Panjang", fmtCurrency.format(totalNonCurrent)],
    ["Total Beban Bunga (semua kontrak)", fmtCurrency.format(totalInterest)],
    ["Total Beban Amortisasi ROU (semua kontrak)", fmtCurrency.format(totalDep)],
  ];

  portfolioSummaryCardsEl.innerHTML = cards
    .map(
      ([label, value]) => `
      <div class="summary-card">
        <p class="summary-card__label">${label}</p>
        <p class="summary-card__value ${value.length > 16 ? "is-small" : ""}">${value}</p>
      </div>`
    )
    .join("");
}

function renderPortfolioTable(items) {
  const head = `<thead><tr>
    <th class="text-left">Nama Kontrak</th>
    <th class="text-left">Mulai Sewa</th>
    <th>ROU Awal</th>
    <th>Liability Awal</th>
    <th>Saldo per Tgl Pelaporan</th>
    <th>Current</th>
    <th>Non-Current</th>
    <th class="text-left">Aksi</th>
  </tr></thead>`;

  const body = items
    .map(
      (it) => `<tr>
      <td class="text-left">${escapeHtml(it.input.assetName)}</td>
      <td class="text-left">${fmtDate(it.input.commencementDate)}</td>
      <td>${fmtCurrency.format(it.result.initialROU)}</td>
      <td>${fmtCurrency.format(it.result.initialLiability)}</td>
      <td>${fmtCurrency.format(it.result.reportingBalance)}</td>
      <td>${fmtCurrency.format(it.result.currentPortion)}</td>
      <td>${fmtCurrency.format(it.result.nonCurrentPortion)}</td>
      <td class="text-left">
        <div class="table-actions">
          <button type="button" data-action="view" data-id="${it.id}">👁 Lihat</button>
          <button type="button" data-action="edit" data-id="${it.id}">✏️ Edit</button>
          <button type="button" data-action="export" data-id="${it.id}">⬇ Excel</button>
          <button type="button" data-action="delete" data-id="${it.id}" class="is-danger">🗑 Hapus</button>
        </div>
      </td>
    </tr>`
    )
    .join("");

  tblPortfolio.innerHTML = head + `<tbody>${body}</tbody>`;
}

function onPortfolioTableClick(e) {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  if (action === "view") onViewContract(id);
  else if (action === "edit") onEditContract(id);
  else if (action === "export") onExportSingleContractFromPortfolio(id);
  else if (action === "delete") onDeleteContract(id);
}

function onViewContract(id) {
  const c = getContract(id);
  if (!c) return;
  const result = calculateLease(c.input);
  if (!result.valid) {
    showToast("Data kontrak tersimpan tidak valid, tidak bisa ditampilkan.", true);
    return;
  }
  lastResult = result;
  lastInputRaw = c.input;
  editingContractId = id;
  savedIndicator.hidden = false;
  btnSaveToPortfolio.hidden = true;
  btnGoPortfolio.hidden = false;
  renderResults(result);
  showScreen("results");
}

function onEditContract(id) {
  const c = getContract(id);
  if (!c) return;
  editingContractId = id;
  fillFormFromInput(c.input);
  goToStep(1);
  showScreen("wizard");
}

async function onExportSingleContractFromPortfolio(id) {
  const c = getContract(id);
  if (!c) return;
  const result = calculateLease(c.input);
  if (!result.valid) {
    showToast("Data kontrak tersimpan tidak valid, tidak bisa diexport.", true);
    return;
  }
  try {
    await exportToExcel(result);
    showToast("File Excel berhasil diunduh.");
  } catch (err) {
    showToast("Gagal membuat file Excel: " + err.message, true);
  }
}

function onDeleteContract(id) {
  const c = getContract(id);
  if (!c) return;
  const ok = window.confirm(`Hapus kontrak "${c.input.assetName}" dari portofolio? Tindakan ini tidak bisa dibatalkan.`);
  if (!ok) return;
  const res = deleteContract(id);
  if (res.ok) {
    showToast("Kontrak dihapus dari portofolio.");
    renderPortfolio();
  } else {
    showToast("Gagal menghapus kontrak: " + res.error, true);
  }
}

async function onExportPortfolio() {
  if (!lastPortfolioItems || lastPortfolioItems.length === 0) {
    showToast("Belum ada kontrak untuk diexport.", true);
    return;
  }
  btnExportPortfolio.disabled = true;
  btnExportPortfolio.textContent = "Menyiapkan file...";
  try {
    await exportPortfolioToExcel(lastPortfolioItems, portfolioReportingDateValue);
    showToast("File Excel gabungan berhasil diunduh.");
  } catch (err) {
    console.error(err);
    showToast("Gagal membuat file Excel: " + err.message, true);
  } finally {
    btnExportPortfolio.disabled = false;
    btnExportPortfolio.textContent = "⬇ Export Semua ke Excel (Gabungan)";
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

function showToast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  toastEl.classList.toggle("is-error", isError);
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toastEl.hidden = true;
  }, 3500);
}
