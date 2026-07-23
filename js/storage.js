// ============================================================================
// Local persistence for the multi-contract (portfolio) mode.
// Uses localStorage only - no backend/login, everything stays on this device.
// ============================================================================

const STORAGE_KEY = "psak116_contracts_v1";
const MODE_KEY = "psak116_last_mode_v1";

function listContracts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("Gagal membaca data portofolio dari penyimpanan lokal:", err);
    return [];
  }
}

function saveAllContracts(contracts) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(contracts));
    return { ok: true };
  } catch (err) {
    console.error("Gagal menyimpan data portofolio:", err);
    return { ok: false, error: err.message };
  }
}

/**
 * Create or update a contract. Pass `id` to update an existing one.
 * Returns { ok, id, error }.
 */
function upsertContract(input, id) {
  const contracts = listContracts();
  if (id) {
    const idx = contracts.findIndex((c) => c.id === id);
    if (idx >= 0) {
      contracts[idx] = { ...contracts[idx], input, savedAt: new Date().toISOString() };
      const res = saveAllContracts(contracts);
      return { ok: res.ok, id, error: res.error };
    }
  }
  const newId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  contracts.push({ id: newId, input, savedAt: new Date().toISOString() });
  const res = saveAllContracts(contracts);
  return { ok: res.ok, id: newId, error: res.error };
}

function deleteContract(id) {
  const contracts = listContracts().filter((c) => c.id !== id);
  return saveAllContracts(contracts);
}

function getContract(id) {
  return listContracts().find((c) => c.id === id) || null;
}

function getLastMode() {
  try {
    return localStorage.getItem(MODE_KEY);
  } catch {
    return null;
  }
}

function setLastMode(mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* ignore quota/private-mode errors, non-critical */
  }
}

export { listContracts, upsertContract, deleteContract, getContract, getLastMode, setLastMode };
