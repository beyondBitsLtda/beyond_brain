import { applyTheme, saveTheme } from "../themeManager.js";
import { triggerInvertOnce } from "../effects/themeFx.js";

export function steveCommand(bus) {
  return () => {
    const selectedTheme = applyTheme("steve");
    saveTheme(selectedTheme);
    bus.emit("output:append", "OK: tema aplicado.");
    bus.emit("theme:change", { key: selectedTheme });
    triggerInvertOnce();
  };
}
