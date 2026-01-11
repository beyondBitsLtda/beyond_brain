const HELP_TEXT = `Comandos disponíveis:
- help: mostra esta ajuda
- clear: limpa a tela
- cancel: cancela operações pendentes (ex: deleção por subject, modo connect)
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
- DELETE NOTE subject="...": remove todas as notas com o subject (confirmação obrigatória)
- CONFIRM DELETE subject="...": confirma deleção em massa por subject
- open #N | open id="uuid": abre nota completa do último SELECT
- LINK from="uuid|subject" to="uuid|subject" type="..." [weight=1..5]: cria uma relação entre notas
- UNLINK from="uuid" to="uuid" [type="..."]: remove relação entre notas
- UNLINK id="uuid": remove relação pelo id (se disponível)
- REL WEIGHT from="..." to="..." type="..." set=1..5: ajusta peso de relação
- REL REINFORCE from="..." to="..." type="...": reforça relação (+1)
- rels: lista todas as relações do usuário
- rels note "uuid": lista relações de uma nota específica
- IDEA note "#N" | IDEA id="uuid": marca nota como ideia
- IDEA off "#N" | IDEA off id="uuid": remove marcação de ideia
- IDEA level "#N" set=1..3: ajusta nível de ideia
- IDEAS: lista notas marcadas como ideia
- graph: alterna o grafo das notas
- graph note "uuid" [1|2]: foca no subgrafo da nota
- focus "uuid" | focus clear: define ou limpa o modo foco
- RESET BRAIN: remove todas as notas e relações do usuário (NUKE BRAIN também funciona)
- theme: escolhe um tema de cores (1-8)
- pet: entra no modo pet (pet name "NOME" | pet reset)
- IA: comandos de inteligência artificial (IA help)
- BRAIN TRAIN: treino cognitivo diário (BRAIN TRAIN help)
- editor on|off: ativa/desativa o editor de programação
- mic: dita uma nota rápida por voz (salva como Quick Thought)`;

export function helpCommand(bus) {
  return () => {
    bus.emit("output:append", HELP_TEXT);
  };
}
