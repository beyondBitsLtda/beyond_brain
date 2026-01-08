const WELCOME_LINES = [
  "Bem-vindo ao terminal Beyond Brain.",
  'Digite "help" para ver os comandos disponíveis.',
];

export function createTerminalUI(bus) {
  const terminal = document.querySelector(".terminal");
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

  function submitCommand() {
    bus.emit("command:submit", { raw: input.value });
    input.value = "";
    input.focus();
  }

  function bindInput() {
    terminal?.addEventListener("pointerdown", (event) => {
      if (event.target.closest("a, button, input, textarea, select")) {
        return;
      }
      input.focus();
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitCommand();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitCommand();
      }
    });
  }

  bus.on("output:append", (text) => appendLine(text));
  bus.on("output:clear", () => clearOutput());
  bus.on("input:mask", () => {
    input.type = "password";
  });
  bus.on("input:unmask", () => {
    input.type = "text";
  });
  bus.on("input:placeholder", (text) => {
    input.placeholder = text ?? "";
  });
  bus.on("input:focus", () => input.focus());

  bindInput();

  function showIntro() {
    WELCOME_LINES.forEach((line) => appendLine(line));
  }

  return { showIntro };
}
