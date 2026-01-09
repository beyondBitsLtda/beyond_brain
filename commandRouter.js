export function createCommandRouter(bus, commands = {}) {
  let capture = null;

  bus.on("router:capture:start", (options) => {
    capture = options;
  });

  bus.on("router:capture:stop", () => {
    capture = null;
  });

  bus.on("input:escape", () => {
    if (!capture?.onCancel) {
      return;
    }
    capture.onCancel();
  });

  bus.on("command:submit", ({ raw }) => {
    const input = raw ?? "";

    if (capture?.handler) {
      const echoMode = capture.echo ?? "normal"; // normal | mask | none
      const maskChar = capture.maskChar ?? "*";
      const showEcho = echoMode !== "none";
      if (showEcho) {
        const masked = maskChar.repeat(input.length);
        const display = echoMode === "mask" ? masked : input;
        bus.emit("output:append", `> ${display}`);
      }
      capture.handler(input);
      return;
    }

    const command = input.trim();
    bus.emit("output:append", `> ${command}`);

    if (command === "") {
      return;
    }

    const [name, ...args] = command.split(/\s+/);
    const handler = commands[name];
    if (handler) {
      handler({ args, raw: command });
      return;
    }

    bus.emit(
      "output:append",
      `Comando não reconhecido: "${command}". Digite "help" para ver as opções.`
    );
  });
}
