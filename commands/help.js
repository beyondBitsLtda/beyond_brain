const HELP_TEXT = `Comandos disponíveis:
- help: mostra esta ajuda
- clear: limpa a tela
- ping: testa a conexão com o Supabase`;

export function helpCommand(bus) {
  return () => {
    bus.emit("output:append", HELP_TEXT);
  };
}
