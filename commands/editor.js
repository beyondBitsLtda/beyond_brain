export function editorCommand(bus) {
  return ({ args = [], raw = "" } = {}) => {
    const action = args[0]?.toLowerCase();
    if (!action) {
      bus.emit("output:append", 'Uso: editor on|off');
      return;
    }

    if (action === "on") {
      bus.emit("editor:open", {
        language: "text",
        tabSize: 2,
        onSubmit: (value) => bus.emit("command:submit", { raw: value }),
        onCancel: () => {},
      });
      bus.emit("output:append", "Editor ativado.");
      return;
    }

    if (action === "off") {
      bus.emit("editor:close");
      bus.emit("output:append", "Editor desativado.");
      return;
    }

    bus.emit("output:append", 'Uso: editor on|off');
  };
}
