export const ACCOUNT_SELECTION_MODES = new Set(['sticky', 'random', 'round-robin']);

export function normalizeAccountSelectionMode(mode) {
  return ACCOUNT_SELECTION_MODES.has(mode) ? mode : 'sticky';
}

function availableEntries(entries, now) {
  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !entry.disabled && entry.frozenUntil <= now);
}

function orderedFromStart(items, startIndex) {
  const start = items.findIndex(({ index }) => index >= startIndex);
  const pivot = start === -1 ? 0 : start;
  return [...items.slice(pivot), ...items.slice(0, pivot)];
}

function shuffled(items, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function selectAccountOrder(entries, mode, state, limit, nowFn = Date.now, random = Math.random) {
  if (entries.length === 0) return [];

  const normalizedMode = normalizeAccountSelectionMode(mode);
  const currentIndex = Number.isInteger(state.index) ? state.index % entries.length : 0;
  if (normalizedMode === 'round-robin') {
    state.index = (currentIndex + 1) % entries.length;
  }

  const available = availableEntries(entries, nowFn());
  if (available.length === 0) return [];

  const cap = limit && limit > 0 ? Math.min(limit, available.length) : available.length;

  let ordered;
  if (normalizedMode === 'random') {
    ordered = shuffled(available, random);
  } else {
    ordered = orderedFromStart(available, currentIndex);
    if (normalizedMode === 'sticky') {
      // sticky：当前账号可用时不移动；当前账号不可用时粘到下一个可用账号。
      state.index = ordered[0].index;
    }
  }

  return ordered.slice(0, cap).map(({ entry }) => entry);
}
