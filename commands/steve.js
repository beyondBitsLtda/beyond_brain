import { applyTheme, saveTheme } from "../themeManager.js";

const INVERT_CLASS = "fx-invert";
const INVERT_DURATION = 3000;
let invertTimeoutId = null;

function triggerInvertEffect() {
  const body = document.body;
  if (!body) return;

  body.classList.add(INVERT_CLASS);
  if (invertTimeoutId) {
    clearTimeout(invertTimeoutId);
  }
  invertTimeoutId = setTimeout(() => {
    body.classList.remove(INVERT_CLASS);
    invertTimeoutId = null;
  }, INVERT_DURATION);
}

export function steveCommand(bus) {
  return () => {
    const selectedTheme = applyTheme("steve");
    saveTheme(selectedTheme);
    bus.emit("output:append", "OK: tema aplicado.");
    bus.emit("theme:change", { key: selectedTheme });
    triggerInvertEffect();
  };
}
