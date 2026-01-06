export function createCommandRouter(bus, commands = {}) {
  bus.on("command:submit", ({ raw }) => {
    const command = raw.trim();
    bus.emit("output:append", `> ${command}`);

    if (command === "") {
      return;
    }

    const handler = commands[command];
    if (handler) {
      handler();
      return;
    }

    bus.emit(
      "output:append",
      `Comando não reconhecido: "${command}". Digite "help" para ver as opções.`
    );
  });
}
