/* =====================================================================
   Банк заданий лежит отдельно в data/bank.json — его можно пополнять,
   не трогая код. Свои задания, добавленные в приложении, хранятся
   в localStorage и складываются с банком.
   ===================================================================== */

export const bank = { data: { tasks: [], cards: [] }, loaded: false, error: null };

export async function loadBank() {
  if (globalThis.__RAMKI_BANK__) {
    bank.data = globalThis.__RAMKI_BANK__;
    bank.loaded = true;
    return bank;
  }
  try {
    const res = await fetch('data/bank.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    bank.data = { tasks: Array.isArray(json.tasks) ? json.tasks : [], cards: Array.isArray(json.cards) ? json.cards : [] };
    bank.loaded = true;
  } catch {
    bank.error = 'Банк заданий не загрузился — нужен интернет при первом открытии. Свои задания и карточки работают и без него.';
    bank.loaded = true;
  }
  return bank;
}
