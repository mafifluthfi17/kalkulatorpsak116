// ============================================================================
// PSAK 116 - Rule-based Accounting Journal Generator
// Takes the output of calculateLease() (calc-engine.js) and produces journal
// entries. Pure rules, no AI/LLM involved, so output is fully deterministic.
// ============================================================================

const ACCOUNTS = {
  rou: "Aset Hak-Guna (Right-of-Use Asset)",
  liability: "Liabilitas Sewa (Lease Liability)",
  cash: "Kas/Bank",
  interest: "Beban Bunga Sewa (Interest Expense)",
  depreciationExpense: "Beban Amortisasi Aset Hak-Guna",
  accumulatedDepreciation: "Akumulasi Amortisasi Aset Hak-Guna",
};

/**
 * Build the initial recognition journal at lease commencement date.
 * Balanced entry:
 *   Dr ROU Asset ........... liability + IDC - incentive
 *   Dr Kas (insentif) ...... incentive   (jika insentif diasumsikan diterima tunai)
 *      Cr Liabilitas Sewa ... liability
 *      Cr Kas (IDC) ......... IDC        (jika biaya langsung awal dibayar tunai)
 */
function buildInitialJournal(result) {
  const { input, initialLiability, initialROU } = result;
  const idc = input.initialDirectCost;
  const incentive = input.leaseIncentive;
  const lines = [];

  lines.push({ account: ACCOUNTS.rou, debit: initialROU, credit: 0 });
  if (incentive > 0) {
    lines.push({
      account: `${ACCOUNTS.cash} (insentif sewa diterima dari lessor)`,
      debit: incentive,
      credit: 0,
    });
  }
  lines.push({ account: ACCOUNTS.liability, debit: 0, credit: initialLiability });
  if (idc > 0) {
    lines.push({
      account: `${ACCOUNTS.cash} (biaya langsung awal dibayar tunai)`,
      debit: 0,
      credit: idc,
    });
  }

  return {
    date: input.commencementDate,
    description: `Pengakuan awal sewa - ${input.assetName}`,
    lines,
    note:
      incentive > 0 || idc > 0
        ? "Asumsi: insentif sewa diterima tunai dan/atau biaya langsung awal dibayar tunai pada tanggal commencement. Jika bentuknya berbeda (misal insentif berupa periode bebas sewa), sesuaikan akun lawan sesuai kondisi kontrak Anda."
        : null,
  };
}

/**
 * Periodic payment journal (interest + principal repayment) for one period.
 *   Dr Beban Bunga ........... interestExpense
 *   Dr Liabilitas Sewa ........ principalReduction (termasuk pelunasan GRV di periode terakhir)
 *      Cr Kas/Bank ............ totalCashPayment
 */
function buildPeriodicPaymentJournal(input, liabilityRow) {
  const paymentDate =
    input.timing === "advance" ? liabilityRow.periodStartDate : liabilityRow.periodEndDate;

  const lines = [];
  if (liabilityRow.interestExpense > 0) {
    lines.push({ account: ACCOUNTS.interest, debit: liabilityRow.interestExpense, credit: 0 });
  }
  lines.push({ account: ACCOUNTS.liability, debit: liabilityRow.principalReduction, credit: 0 });
  lines.push({ account: ACCOUNTS.cash, debit: 0, credit: liabilityRow.totalCashPayment });

  return {
    date: paymentDate,
    description: `Pembayaran sewa periode ${liabilityRow.period} - ${input.assetName}${
      liabilityRow.grvSettlement > 0 ? " (termasuk pelunasan nilai residu bergaransi)" : ""
    }`,
    lines,
    note: null,
  };
}

/**
 * Depreciation/amortization journal for the ROU asset for one period.
 *   Dr Beban Amortisasi ROU Asset .... depreciationExpense
 *      Cr Akumulasi Amortisasi ROU Asset .... depreciationExpense
 */
function buildDepreciationJournal(input, depreciationRow) {
  return {
    date: depreciationRow.periodEndDate,
    description: `Amortisasi aset hak-guna periode ${depreciationRow.period} - ${input.assetName}`,
    lines: [
      { account: ACCOUNTS.depreciationExpense, debit: depreciationRow.depreciationExpense, credit: 0 },
      { account: ACCOUNTS.accumulatedDepreciation, debit: 0, credit: depreciationRow.depreciationExpense },
    ],
    note: null,
  };
}

/**
 * Generate the full chronological list of journal entries for a lease result.
 * Returns an array of { date, description, lines: [{account, debit, credit}], note }
 * sorted by date, then by entry type (payment before depreciation on the same date).
 */
function generateAllJournals(result) {
  const { input, liabilitySchedule, depreciationSchedule } = result;
  const entries = [];

  entries.push({ ...buildInitialJournal(result), _order: 0 });

  liabilitySchedule.forEach((row) => {
    entries.push({ ...buildPeriodicPaymentJournal(input, row), _order: 1 });
  });

  depreciationSchedule.forEach((row) => {
    entries.push({ ...buildDepreciationJournal(input, row), _order: 2 });
  });

  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a._order - b._order;
  });

  entries.forEach((e) => delete e._order);
  return entries;
}

/** Flatten journal entries into rows suitable for a table/export: one row per debit/credit line. */
function flattenJournalRows(entries) {
  const rows = [];
  entries.forEach((entry) => {
    entry.lines.forEach((line, idx) => {
      rows.push({
        date: entry.date,
        description: idx === 0 ? entry.description : "",
        account: line.account,
        debit: line.debit,
        credit: line.credit,
      });
    });
  });
  return rows;
}

export { ACCOUNTS, buildInitialJournal, buildPeriodicPaymentJournal, buildDepreciationJournal, generateAllJournals, flattenJournalRows };
