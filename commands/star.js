import { applyTheme, saveTheme } from "../themeManager.js";

export function starCommand(bus) {
  return () => {
    const selectedTheme = applyTheme("star");
    saveTheme(selectedTheme);
    bus.emit("output:append", "OK.");
    bus.emit("theme:change", { key: selectedTheme });
  };
}
