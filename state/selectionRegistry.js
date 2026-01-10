let lastList = [];

export function setList(items) {
  lastList = Array.isArray(items) ? items.slice() : [];
}

export function getByIndex(index) {
  if (!Number.isFinite(index)) return null;
  const position = Math.trunc(index) - 1;
  if (position < 0 || position >= lastList.length) return null;
  return lastList[position] ?? null;
}

export function clear() {
  lastList = [];
}

export function getLastList() {
  return lastList.slice();
}
