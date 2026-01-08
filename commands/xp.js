import { applyTheme, saveTheme } from "../themeManager.js";

export function xpCommand(bus) {
  return () => {
    const selectedTheme = applyTheme("xp");
    saveTheme(selectedTheme);
    bus.emit("output:append", "...");
    bus.emit("theme:change", { key: selectedTheme });
  };
}
