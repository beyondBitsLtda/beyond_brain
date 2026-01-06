const output = document.getElementById("output");
const form = document.getElementById("command-form");
const input = document.getElementById("command-input");

const COMMANDS = {
  help: `Comandos disponíveis:
- help: mostra esta ajuda
- clear: limpa a tela`,
};

function appendLine(text) {
  const line = document.createElement("div");
  line.className = "terminal__line";
  line.textContent = text;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

function handleCommand(raw) {
  const command = raw.trim();
  appendLine(`> ${command}`);

  if (command === "") {
    return;
  }

  if (command === "clear") {
    output.innerHTML = "";
    return;
  }

  if (command in COMMANDS) {
    appendLine(COMMANDS[command]);
    return;
  }

  appendLine(`Comando não reconhecido: "${command}". Digite "help" para ver as opções.`);
}

function initTerminal() {
  appendLine("Bem-vindo ao terminal Beyond Brain.");
  appendLine('Digite "help" para ver os comandos disponíveis.');

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    handleCommand(input.value);
    input.value = "";
    input.focus();
  });
}

initTerminal();
