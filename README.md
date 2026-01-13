# Beyond Brain

## Configuração do Supabase
1. Edite `config.js` e substitua os placeholders `COLOQUE_SUA_SUPABASE_URL` e `COLOQUE_SEU_SUPABASE_ANON_KEY` pelos valores do seu projeto.
2. Abra o app em um navegador e use o comando `ping` no terminal para testar a conexão. O comando mostrará `ping OK` quando as credenciais estiverem corretas.
3. Não remova as palavras `export` do `config.js`. Elas são necessárias para que os módulos funcionem no navegador.

## Autenticação interativa
- `auth`: inicia o fluxo de login. Informe email e senha (campo de senha é mascarado). Sucesso limpa o terminal e mostra `Welcome to your future brain, @username`.
- `auth --register`: inicia o cadastro com validação de senha forte (8+ com maiúscula, minúscula e número) e username obrigatório. Cria o perfil na tabela `profiles`.
- `whoami`: mostra o usuário autenticado e o status do perfil.
- `logout`: encerra a sessão atual.

## Notas com classificação visual (ref)
### INSERT com ref
```
INSERT NOTE subject="Nova ideia" moment="agora" body="Conectar fluxos" ref="IDEIA"
INSERT NOTE subject="Tarefa pendente" moment="hoje" body="Revisar backlog" ref="task"
INSERT NOTE subject="Nota padrão" moment="amanhã" body="Sem classificação"
```

### SELECT mostrando ou filtrando ref
```
SELECT NOTE SHOW ref
SELECT NOTE FIELDS(id, subject, ref, created_at)
SELECT NOTE WHERE ref="ideia"
SELECT NOTE WHERE ref="task"
SELECT NOTE WHERE ref~"fluxo"
```

### Atualizar ref rapidamente
```
setref "<id>" ideia
setref "<id>" task
setref "<id>" clear
```

### Marcar ref via índice do SELECT
```
SELECT NOTE
mark 01 ideia
mark 02 task
mark 03 clear
open 01
```

### Consultar refs existentes
```
refs
refs --kinds
refs "texto"
```

### Painel do grafo
- Clique em um node para ver subject, id, moment, created_at e ref atual.
- Use os botões para marcar IDEIA/TASK ou limpar.
- Use "List Refs" para imprimir o resumo de refs no terminal.
