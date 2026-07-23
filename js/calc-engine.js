// ============================================================================
// PSAK 116 / IFRS 16 - Lease Liability & ROU Asset Calculation Engine
// Pure functions only. No DOM access, no AI/LLM. Deterministic arithmetic.
// ============================================================================

/**
 * @typedef {Object} LeaseInput
 * @property {string} assetName
 * @property {string} commencementDate  - ISO date string "YYYY-MM-DD"
 * @property {number} tenorMonths       - base lease term in months (excluding extension)
 * @property {number} paymentAmount    - lease payment per period (in the chosen frequency)
 * @property {"monthly"|"quarterly"|"annually"} frequency
 * @property {"advance"|"arrears"} timing   - "advance" = annuity due, "arrears" = ordinary annuity
 * @property {number} ibrAnnualPercent  - Incremental Borrowing Rate, annual, e.g. 8.5 for 8.5%
 * @property {number} initialDirectCost
 * @property {number} leaseIncentive
 * @property {number} guaranteedResidualValue
 * @property {boolean} hasExtensionOption
 * @property {number} extensionMonths
 * @property {boolean} ownershipTransfer   - ownership transfers / purchase option reasonably certain
 * @property {number} usefulLifeMonths     - economic useful life of underlying asset (used only if ownershipTransfer)
 * @property {string} reportingDate        - ISO date string, for current/non-current split
 */

const FREQUENCY_PER_YEAR = {
  monthly: 12,
  quarterly: 4,
  annually: 1,
};

const FREQUENCY_LABEL = {
  monthly: "Bulanan",
  quarterly: "Kuartalan",
  annually: "Tahunan",
};

/**
 * Validate raw form input. Returns { valid: boolean, errors: {field: message} }
 */
function validateLeaseInput(input) {
  const errors = {};

  if (!input.assetName || !input.assetName.trim()) {
    errors.assetName = "Nama aset/kontrak sewa wajib diisi.";
  }

  if (!input.commencementDate) {
    errors.commencementDate = "Tanggal mulai sewa wajib diisi.";
  }

  if (!input.tenorMonths || Number(input.tenorMonths) <= 0) {
    errors.tenorMonths = "Jangka waktu sewa harus lebih dari 0 bulan.";
  } else if (!Number.isFinite(Number(input.tenorMonths))) {
    errors.tenorMonths = "Jangka waktu sewa harus berupa angka.";
  }

  if (input.paymentAmount === "" || input.paymentAmount === null || input.paymentAmount === undefined) {
    errors.paymentAmount = "Nilai pembayaran sewa wajib diisi.";
  } else if (Number(input.paymentAmount) <= 0) {
    errors.paymentAmount = "Nilai pembayaran sewa harus lebih dari 0.";
  }

  if (!FREQUENCY_PER_YEAR[input.frequency]) {
    errors.frequency = "Pilih frekuensi pembayaran.";
  }

  if (input.timing !== "advance" && input.timing !== "arrears") {
    errors.timing = "Pilih timing pembayaran.";
  }

  if (input.ibrAnnualPercent === "" || input.ibrAnnualPercent === null || input.ibrAnnualPercent === undefined) {
    errors.ibrAnnualPercent = "IBR wajib diisi.";
  } else {
    const ibr = Number(input.ibrAnnualPercent);
    if (!Number.isFinite(ibr)) {
      errors.ibrAnnualPercent = "IBR harus berupa angka.";
    } else if (ibr < 0) {
      errors.ibrAnnualPercent = "IBR tidak boleh negatif.";
    } else if (ibr > 100) {
      errors.ibrAnnualPercent = "IBR tidak wajar (>100%). Periksa kembali input Anda.";
    } else if (ibr === 0) {
      errors.ibrAnnualPercent = "IBR tidak boleh 0%. Gunakan panduan di sebelah field ini untuk menentukan IBR yang wajar.";
    }
  }

  if (input.initialDirectCost !== undefined && Number(input.initialDirectCost) < 0) {
    errors.initialDirectCost = "Biaya langsung awal tidak boleh negatif.";
  }

  if (input.leaseIncentive !== undefined && Number(input.leaseIncentive) < 0) {
    errors.leaseIncentive = "Insentif sewa tidak boleh negatif.";
  }

  if (input.guaranteedResidualValue !== undefined && Number(input.guaranteedResidualValue) < 0) {
    errors.guaranteedResidualValue = "Nilai residu bergaransi tidak boleh negatif.";
  }

  if (input.hasExtensionOption) {
    if (!input.extensionMonths || Number(input.extensionMonths) <= 0) {
      errors.extensionMonths = "Isi tambahan tenor perpanjangan (dalam bulan) karena opsi perpanjangan dicentang.";
    }
  }

  if (input.ownershipTransfer) {
    if (!input.usefulLifeMonths || Number(input.usefulLifeMonths) <= 0) {
      errors.usefulLifeMonths = "Isi umur ekonomis aset (bulan) karena kepemilikan akan berpindah / opsi beli reasonably certain digunakan.";
    } else if (
      Number(input.usefulLifeMonths) <
      Number(input.tenorMonths) + (input.hasExtensionOption ? Number(input.extensionMonths || 0) : 0)
    ) {
      errors.usefulLifeMonths = "Umur ekonomis aset tidak boleh lebih pendek dari total masa sewa.";
    }
  }

  if (!input.reportingDate) {
    errors.reportingDate = "Tanggal pelaporan wajib diisi untuk klasifikasi current/non-current.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/** Add whole months to an ISO date string, returns ISO date string (UTC-safe, day-of-month preserved where possible). */
function addMonths(isoDate, months) {
  const d = new Date(isoDate + "T00:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDayOfTargetMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return d.toISOString().slice(0, 10);
}

function monthsBetween(isoStart, isoEnd) {
  const a = new Date(isoStart + "T00:00:00Z");
  const b = new Date(isoEnd + "T00:00:00Z");
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

/**
 * Core calculation. Returns a fully-populated result object:
 * { totalPeriods, periodicRate, monthsPerPeriod, initialLiability, initialROU,
 *   liabilitySchedule: [...], depreciationSchedule: [...],
 *   currentPortion, nonCurrentPortion, meta: {...} }
 */
function calculateLease(input) {
  const { valid, errors } = validateLeaseInput(input);
  if (!valid) {
    return { valid: false, errors };
  }

  const freqPerYear = FREQUENCY_PER_YEAR[input.frequency];
  const monthsPerPeriod = 12 / freqPerYear;
  const baseTenorMonths = Number(input.tenorMonths);
  const extensionMonths = input.hasExtensionOption ? Number(input.extensionMonths || 0) : 0;
  const totalTenorMonths = baseTenorMonths + extensionMonths;

  const totalPeriods = Math.round(totalTenorMonths / monthsPerPeriod);
  const periodicRate = Number(input.ibrAnnualPercent) / 100 / freqPerYear;

  const payment = Number(input.paymentAmount);
  const grv = Number(input.guaranteedResidualValue || 0);
  const idc = Number(input.initialDirectCost || 0);
  const incentive = Number(input.leaseIncentive || 0);
  const timing = input.timing; // "advance" | "arrears"

  // ---- Present Value of lease payments (annuity) ----
  // r = periodicRate, n = totalPeriods
  let pvAnnuityFactor;
  if (periodicRate === 0) {
    pvAnnuityFactor = totalPeriods;
  } else {
    pvAnnuityFactor = (1 - Math.pow(1 + periodicRate, -totalPeriods)) / periodicRate;
    if (timing === "advance") {
      pvAnnuityFactor *= 1 + periodicRate;
    }
  }
  const pvPayments = payment * pvAnnuityFactor;
  const pvGRV = grv > 0 ? grv / Math.pow(1 + periodicRate, totalPeriods) : 0;

  const initialLiability = round2(pvPayments + pvGRV);
  const initialROU = round2(initialLiability + idc - incentive);

  // ---- Liability amortization schedule (effective interest method) ----
  const liabilitySchedule = [];
  let opening = initialLiability;
  let currentDate = input.commencementDate;

  for (let i = 1; i <= totalPeriods; i++) {
    const periodStartDate = currentDate;
    const periodEndDate = addMonths(input.commencementDate, i * monthsPerPeriod);
    const isLast = i === totalPeriods;

    let interest, principal, closing;
    let cashPayment = payment;

    if (timing === "advance") {
      // payment happens at the start of the period, before interest accrues
      const postPaymentBalance = opening - payment;
      interest = round2(postPaymentBalance * periodicRate);
      principal = round2(payment - interest);
      closing = round2(opening - principal);
    } else {
      // ordinary annuity: interest accrues first, then payment at period end
      interest = round2(opening * periodicRate);
      principal = round2(payment - interest);
      closing = round2(opening - principal);
    }

    let grvSettlement = 0;
    if (isLast && grv > 0) {
      grvSettlement = grv;
      cashPayment = round2(cashPayment + grv);
      principal = round2(principal + grv);
      closing = round2(closing - grv);
    }

    // guard against floating point dust on the final period
    if (isLast && Math.abs(closing) < 0.5) {
      closing = 0;
    }

    liabilitySchedule.push({
      period: i,
      periodStartDate,
      periodEndDate,
      openingBalance: round2(opening),
      interestExpense: interest,
      leasePayment: payment,
      grvSettlement,
      totalCashPayment: cashPayment,
      principalReduction: principal,
      closingBalance: closing,
    });

    currentDate = periodEndDate;
    opening = closing;
  }

  // ---- Depreciation schedule (straight-line) ----
  const depreciationMonths = input.ownershipTransfer
    ? Number(input.usefulLifeMonths)
    : totalTenorMonths;
  const depreciableBase = initialROU;
  const monthlyDepreciation = round2(depreciableBase / depreciationMonths);

  const depreciationSchedule = [];
  let accumulated = 0;
  // Build depreciation schedule aligned to the same periods as the liability schedule
  // (using monthsPerPeriod chunks) for consistency in the journal/output; if the
  // depreciation horizon (useful life) is longer than the lease term, we still show
  // periods only through the lease term for this MVP, matching the liability schedule length.
  for (let i = 1; i <= totalPeriods; i++) {
    const periodStartDate = liabilitySchedule[i - 1].periodStartDate;
    const periodEndDate = liabilitySchedule[i - 1].periodEndDate;
    let depAmount = round2(monthlyDepreciation * monthsPerPeriod);
    const isLastOfLeaseTerm = i === totalPeriods && !input.ownershipTransfer;
    if (isLastOfLeaseTerm) {
      // plug rounding difference into the final period so accumulated == depreciableBase exactly
      depAmount = round2(depreciableBase - accumulated);
    }
    accumulated = round2(accumulated + depAmount);
    depreciationSchedule.push({
      period: i,
      periodStartDate,
      periodEndDate,
      depreciationExpense: depAmount,
      accumulatedDepreciation: accumulated,
      netBookValue: round2(depreciableBase - accumulated),
    });
  }

  // ---- Current / Non-current split as of reporting date ----
  const { currentPortion, nonCurrentPortion, reportingBalance } = splitCurrentNonCurrent(
    liabilitySchedule,
    input.reportingDate
  );

  return {
    valid: true,
    input: normalizeInputForRecord(input),
    meta: {
      freqPerYear,
      monthsPerPeriod,
      totalTenorMonths,
      totalPeriods,
      periodicRate,
      depreciationMonths,
    },
    initialLiability,
    initialROU,
    liabilitySchedule,
    depreciationSchedule,
    currentPortion,
    nonCurrentPortion,
    reportingBalance,
  };
}

/**
 * Sums principal reductions falling within 12 months after reportingDate to get the
 * current portion of the lease liability; remainder of the outstanding balance at the
 * reporting date is non-current.
 */
function splitCurrentNonCurrent(liabilitySchedule, reportingDate) {
  // Find the outstanding balance as of reportingDate: the closing balance of the last
  // period whose periodEndDate <= reportingDate (or the initial balance if none yet).
  let reportingBalance = null;
  let reportingIndex = -1;
  for (let i = 0; i < liabilitySchedule.length; i++) {
    if (liabilitySchedule[i].periodEndDate <= reportingDate) {
      reportingBalance = liabilitySchedule[i].closingBalance;
      reportingIndex = i;
    }
  }
  if (reportingIndex === -1) {
    reportingBalance = liabilitySchedule.length > 0 ? liabilitySchedule[0].openingBalance : 0;
  }

  const twelveMonthsOut = addMonths(reportingDate, 12);
  let currentPortion = 0;
  for (let i = reportingIndex + 1; i < liabilitySchedule.length; i++) {
    const row = liabilitySchedule[i];
    if (row.periodEndDate <= twelveMonthsOut) {
      currentPortion = round2(currentPortion + row.principalReduction);
    } else {
      break;
    }
  }
  currentPortion = Math.min(currentPortion, reportingBalance || 0);
  const nonCurrentPortion = round2((reportingBalance || 0) - currentPortion);

  return { currentPortion: round2(currentPortion), nonCurrentPortion, reportingBalance: round2(reportingBalance || 0) };
}

function normalizeInputForRecord(input) {
  return {
    assetName: input.assetName,
    commencementDate: input.commencementDate,
    tenorMonths: Number(input.tenorMonths),
    paymentAmount: Number(input.paymentAmount),
    frequency: input.frequency,
    frequencyLabel: FREQUENCY_LABEL[input.frequency],
    timing: input.timing,
    timingLabel: input.timing === "advance" ? "Awal periode (annuity due)" : "Akhir periode (ordinary annuity)",
    ibrAnnualPercent: Number(input.ibrAnnualPercent),
    initialDirectCost: Number(input.initialDirectCost || 0),
    leaseIncentive: Number(input.leaseIncentive || 0),
    guaranteedResidualValue: Number(input.guaranteedResidualValue || 0),
    hasExtensionOption: !!input.hasExtensionOption,
    extensionMonths: input.hasExtensionOption ? Number(input.extensionMonths || 0) : 0,
    ownershipTransfer: !!input.ownershipTransfer,
    usefulLifeMonths: input.ownershipTransfer ? Number(input.usefulLifeMonths) : null,
    reportingDate: input.reportingDate,
  };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export {
  FREQUENCY_PER_YEAR,
  FREQUENCY_LABEL,
  validateLeaseInput,
  calculateLease,
  addMonths,
  monthsBetween,
  round2,
};
