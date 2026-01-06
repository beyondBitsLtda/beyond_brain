const WELCOME_LINES = [
  "Bem-vindo ao terminal Beyond Brain.",
  'Digite "help" para ver os comandos disponíveis.',
];

export function createTerminalUI(bus) {
  const output = document.getElementById("output");
  const form = document.getElementById("command-form");
  const input = document.getElementById("command-input");

  function appendLine(text) {
    const line = document.createElement("div");
    line.className = "terminal__line";
    line.textContent = text;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
  }

  function clearOutput() {
    output.innerHTML = "";
  }

  function bindInput() {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      bus.emit("command:submit", { raw: input.value });
      input.value = "";
      input.focus();
    });
  }

  bus.on("output:append", (text) => appendLine(text));
  bus.on("output:clear", () => clearOutput());

  bindInput();

  function showIntro() {
    WELCOME_LINES.forEach((line) => appendLine(line));
  }

  return { showIntro };
}
