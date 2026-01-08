const WELCOME_LINES = [
  "Bem-vindo ao terminal Beyond Brain.",
  'Digite "help" para ver os comandos disponíveis.',
];

export function createTerminalUI(bus) {
  const output = document.getElementById("output");
  const form = document.getElementById("command-form");
  const input = document.getElementById("command-input");
  const typedText = document.getElementById("typedText");
  const cursor = document.querySelector(".terminal__cursor");
  const history = [];
  let historyIndex = null;
  let draftValue = "";
  let isMasked = false;
  let rafId = null;

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

  function getDisplayValue(raw) {
    if (!isMasked) {
      return raw;
    }
    return raw.replace(/[^\n]/g, "*");
  }

  function setHistoryValue(value) {
    input.value = value;
    const end = value.length;
    input.setSelectionRange(end, end);
    updateMirror();
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
      setHistoryValue(draftValue);
      return;
    }

    setHistoryValue(history[historyIndex]);
  }

  function updateCursorPosition() {
    if (!cursor || !form || !typedText || !input) {
      return;
    }

    const selection = input.selectionStart ?? input.value.length;
    const textNode = typedText.firstChild;
    const formRect = form.getBoundingClientRect();
    const typedRect = typedText.getBoundingClientRect();
    let left = typedRect.left;
    let top = typedRect.top;
    let height = typedRect.height;

    if (textNode) {
      const range = document.createRange();
      const safeOffset = Math.min(selection, textNode.length);
      range.setStart(textNode, safeOffset);
      range.setEnd(textNode, safeOffset);
      const rects = range.getClientRects();
      if (rects.length > 0) {
        const rect = rects[rects.length - 1];
        left = rect.left;
        top = rect.top;
        height = rect.height;
      }
    }

    cursor.style.position = "absolute";
    cursor.style.pointerEvents = "none";
    cursor.style.left = `${left - formRect.left}px`;
    cursor.style.top = `${top - formRect.top}px`;
    if (height) {
      cursor.style.height = `${height}px`;
    }
  }

  function scheduleCursorUpdate() {
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
    rafId = requestAnimationFrame(() => {
      updateCursorPosition();
      rafId = null;
    });
  }

  function updateMirror() {
    const raw = input.value;
    typedText.textContent = getDisplayValue(raw);
    scheduleCursorUpdate();
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
      resetHistoryNavigation();
      updateMirror();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        applyHistoryStep(-1);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        applyHistoryStep(1);
        return;
      }

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
      }
    });

    input.addEventListener("click", () => {
      scheduleCursorUpdate();
    });

    input.addEventListener("keyup", () => {
      scheduleCursorUpdate();
    });

    document.addEventListener("selectionchange", () => {
      if (document.activeElement === input) {
        scheduleCursorUpdate();
      }
    });

    window.addEventListener("resize", () => {
      scheduleCursorUpdate();
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
  bus.on("input:focus", () => input.focus());

  bindInput();
  updateMirror();

  function showIntro() {
    WELCOME_LINES.forEach((line) => appendLine(line));
  }

  return { showIntro };
}
