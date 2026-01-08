import { applyTheme, listThemes, saveTheme } from "../themeManager.js";

const CANCEL_WORDS = new Set(["q", "exit", "cancel"]);

export function themeCommand(bus) {
  const themes = listThemes();

  function handleSelection(input) {
    const trimmed = (input ?? "").trim();
    const lower = trimmed.toLowerCase();

    if (CANCEL_WORDS.has(lower)) {
      bus.emit("output:append", "Operação cancelada.");
      bus.emit("router:capture:stop");
      return;
    }

    const selection = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(selection) && selection >= 1 && selection <= themes.length) {
      const selectedTheme = themes[selection - 1];
      applyTheme(selectedTheme.key);
      saveTheme(selectedTheme.key);
      bus.emit("output:append", `OK: tema aplicado: ${selectedTheme.name}`);
      bus.emit("theme:change", { key: selectedTheme.key });
      bus.emit("router:capture:stop");
      return;
    }

    bus.emit("output:append", "Seleção inválida. Digite um número de 1 a 8.");
  }

  return () => {
    bus.emit("output:append", "Selecione um tema (1-8):");
    themes.forEach((theme) => {
      bus.emit("output:append", theme.label);
    });
    bus.emit("output:append", "Digite o número do tema:");

    bus.emit("router:capture:start", {
      handler: handleSelection,
      echo: "normal",
    });
  };
}
