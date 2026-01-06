const HELP_TEXT = `Comandos disponíveis:
- help: mostra esta ajuda
- clear: limpa a tela
- ping: testa a conexão com o Supabase
- auth: faz login interativo (auth --register para criar conta)
- logout: encerra a sessão atual
- whoami: mostra o usuário autenticado`;

export function helpCommand(bus) {
  return () => {
    bus.emit("output:append", HELP_TEXT);
  };
}
