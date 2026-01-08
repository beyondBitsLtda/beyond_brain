const WELCOME_LINES = [
  "Bem-vindo ao terminal Beyond Brain.",
  'Digite "help" para ver os comandos disponíveis.',
];

export function createTerminalUI(bus) {
  const terminal = document.querySelector(".terminal");
  const output = document.getElementById("output");
  const form = document.getElementById("command-form");
  const input = document.getElementById("command-input");
  const history = [];
  let historyIndex = null;
  let draftValue = "";

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

  function focusInput() {
    input.focus();
  }

  function moveCaretToEnd() {
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }

  function setInputValue(value) {
    input.value = value;
    moveCaretToEnd();
  }

  function resetHistoryNavigation() {
    historyIndex = null;
    draftValue = "";
  }

  function applyHistoryStep(direction) {
    if (history.length === 0) {
      return;
    }

    if (historyIndex === null) {
      draftValue = input.value;
      historyIndex = history.length - 1;
    } else {
      historyIndex += direction;
    }

    if (historyIndex < 0) {
      historyIndex = 0;
    }

    if (historyIndex >= history.length) {
      historyIndex = null;
      setInputValue(draftValue);
      return;
    }

    setInputValue(history[historyIndex]);
  }

  function submitCommand() {
    const raw = input.value;
    if (raw.trim() !== "") {
      history.push(raw);
    }
    resetHistoryNavigation();
    bus.emit("command:submit", { raw });
    input.value = "";
    focusInput();
  }

  function bindInput() {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitCommand();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitCommand();
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        applyHistoryStep(-1);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        applyHistoryStep(1);
      }
    });

    input.addEventListener("input", () => {
      resetHistoryNavigation();
    });

    terminal?.addEventListener("click", () => {
      focusInput();
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
  bus.on("input:focus", () => focusInput());

  bindInput();
  focusInput();

  function showIntro() {
    WELCOME_LINES.forEach((line) => appendLine(line));
  }

  return { showIntro };
}
