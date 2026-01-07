function stripQuotes(value) {
  if (!value) return "";
  return value.replace(/^"|"$/g, "").trim();
}

function parseDepth(value) {
  if (!value) return 1;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return null;
  if (parsed !== 1 && parsed !== 2) return null;
  return parsed;
}

export function graphCommand(bus) {
  return ({ args = [] } = {}) => {
    if (args[0] === "note") {
      const noteId = stripQuotes(args[1] ?? "");
      if (!noteId) {
        bus.emit("output:append", "Uso: graph note \"uuid\" [1|2]");
        return;
      }
      const depth = parseDepth(args[2]);
      if (args[2] && depth === null) {
        bus.emit("output:append", "Profundidade inválida. Use 1 ou 2.");
        return;
      }
      bus.emit("graph:open", { focusNoteId: noteId, depth: depth ?? 1 });
      return;
    }

    if (args.length > 0) {
      bus.emit("output:append", "Uso: graph | graph note \"uuid\" [1|2]");
      return;
    }

    bus.emit("graph:toggle");
  };
}
