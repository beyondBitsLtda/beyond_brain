let lastList = [];
let lastSelect = [];
let lastSelectMeta = {
  showRef: false,
};

export function setList(items, options = {}) {
  lastList = Array.isArray(items) ? items.slice() : [];
  lastSelect = lastList.map((item, index) => ({
    idx: index + 1,
    id: item?.id ?? null,
  }));
  lastSelectMeta = {
    showRef: Boolean(options.showRef),
  };
}

export function setLastSelect(items, options = {}) {
  setList(items, options);
}

export function getByIndex(index) {
  if (!Number.isFinite(index)) return null;
  const position = Math.trunc(index) - 1;
  if (position < 0 || position >= lastList.length) return null;
  return lastList[position] ?? null;
}

export function clear() {
  lastList = [];
  lastSelect = [];
  lastSelectMeta = {
    showRef: false,
  };
}

export function getLastList() {
  return lastList.slice();
}

export function getLastSelect() {
  return lastSelect.slice();
}

export function getLastSelectMeta() {
  return { ...lastSelectMeta };
}
