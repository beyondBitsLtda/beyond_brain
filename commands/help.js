const HELP_TEXT = `Comandos disponíveis:
- help: mostra esta ajuda
- clear: limpa a tela`;

export function helpCommand(bus) {
  return () => {
    bus.emit("output:append", HELP_TEXT);
  };
}
