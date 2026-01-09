const STORAGE_KEY = "bb_gemini_key";

export function getGeminiKey() {
  return localStorage.getItem(STORAGE_KEY);
}

export function setGeminiKey(key) {
  localStorage.setItem(STORAGE_KEY, key);
}

export function clearGeminiKey() {
  localStorage.removeItem(STORAGE_KEY);
}

export function maskKey(key) {
  if (!key) return "****";
  const suffix = key.slice(-4);
  return `****${suffix}`;
}
