const WELCOME_LINES = [
  "Bem-vindo ao terminal Beyond Brain.",
  'Digite "help" para ver os comandos disponíveis.',
];

export function createTerminalUI(bus) {
  const output = document.getElementById("output");
  const form = document.getElementById("command-form");
  const input = document.getElementById("command-input");
  const typedText = document.getElementById("typedText");
  let isMasked = false;

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

  function updateMirror() {
    const raw = input.value;
    if (isMasked) {
      typedText.textContent = raw.replace(/[^\n]/g, "*");
      return;
    }
    typedText.textContent = raw;
  }

  function insertNewline() {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const value = input.value;
    input.value = `${value.slice(0, start)}\n${value.slice(end)}`;
    const cursor = start + 1;
    input.setSelectionRange(cursor, cursor);
    updateMirror();
  }

  function submitCommand() {
    const raw = input.value;
    if (raw.trim() !== "") {
      history.push(raw);
    }
    resetHistoryNavigation();
    bus.emit("command:submit", { raw });
    input.value = "";
    updateMirror();
    input.focus();
  }

  function bindInput() {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitCommand();
    });

    input.addEventListener("input", () => {
      updateMirror();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Tab") {
        event.preventDefault();
        insertNewline();
        return;
      }

      if (event.key === "Enter") {
        if (event.shiftKey) {
          return;
        }
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
    isMasked = true;
    updateMirror();
  });
  bus.on("input:unmask", () => {
    isMasked = false;
    updateMirror();
  });
  bus.on("input:placeholder", (text) => {
    input.placeholder = text ?? "";
  });
  bus.on("input:focus", () => focusInput());

  bindInput();
  updateMirror();

  function showIntro() {
    WELCOME_LINES.forEach((line) => appendLine(line));
  }

  return { showIntro };
}
