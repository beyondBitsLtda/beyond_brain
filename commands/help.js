const HELP_TEXT = `Comandos disponíveis:
- help: mostra esta ajuda
- clear: limpa a tela
- ping: testa a conexão com o Supabase
- auth: faz login interativo (auth --register para criar conta)
- logout: encerra a sessão atual
- whoami: mostra o usuário autenticado
- now "texto..." | now subject="..." body="...": cria nota rápida
- last: mostra a última nota criada pelo usuário
- INSERT NOTE subject="..." moment="..." body="..." [ref="..."]: cria uma nota
- SELECT NOTE [FIELDS(...)] [WHERE ...] [LIMIT n]: lista notas
- UPDATE NOTE id="..." SET field="...": atualiza nota
- DELETE NOTE id="...": remove nota
- LINK from="uuid" to="uuid" type="...": cria uma relação entre notas
- UNLINK from="uuid" to="uuid": remove relação entre notas
- rels: lista todas as relações do usuário
- rels note "uuid": lista relações de uma nota específica
- graph: alterna o grafo das notas
- graph note "uuid" [1|2]: foca no subgrafo da nota
- RESET BRAIN: remove todas as notas e relações do usuário (NUKE BRAIN também funciona)`;

export function helpCommand(bus) {
  return () => {
    bus.emit("output:append", HELP_TEXT);
  };
}
