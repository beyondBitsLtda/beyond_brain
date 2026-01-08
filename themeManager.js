const STORAGE_KEY = "bb_theme";
const DEFAULT_THEME = "matrix";

const THEMES = [
  { key: "matrix", name: "Matrix", description: "verde/preto" },
  { key: "amber", name: "Amber", description: "laranja/preto" },
  { key: "ice", name: "Ice", description: "ciano/preto" },
  { key: "violet", name: "Violet", description: "roxo/preto" },
  { key: "crimson", name: "Crimson", description: "vermelho/preto" },
  { key: "monk", name: "Monk Mode", description: "escrita profunda" },
  { key: "neural", name: "Neural Grid", description: "estrutura técnica" },
  { key: "dream", name: "Dream / Liminal", description: "sonho/intuição" },
];
const SECRET_THEMES = new Set(["steve"]);

function isValidTheme(key) {
  return THEMES.some((theme) => theme.key === key) || SECRET_THEMES.has(key);
}

export function listThemes() {
  return THEMES.map((theme, index) => ({
    ...theme,
    index: index + 1,
    label: `[${index + 1}] ${theme.name} (${theme.description})`,
  }));
}

export function applyTheme(themeKey) {
  const selected = isValidTheme(themeKey) ? themeKey : DEFAULT_THEME;
  document.documentElement.dataset.theme = selected;
  return selected;
}

export function saveTheme(themeKey) {
  if (!isValidTheme(themeKey)) return;
  localStorage.setItem(STORAGE_KEY, themeKey);
}

export function loadTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  const selected = isValidTheme(stored) ? stored : DEFAULT_THEME;
  applyTheme(selected);
  return selected;
}

export function getCurrentTheme() {
  const current = document.documentElement.dataset.theme;
  if (isValidTheme(current)) return current;
  return DEFAULT_THEME;
}
