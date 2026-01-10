import { highlight } from "../editor/highlight.js";

const DEFAULT_TAB_SIZE = 2;

function formatLanguageLabel(language) {
  if (!language) return "TEXT";
  return language.trim().toUpperCase();
}

export function createCodeEditor() {
  let root = null;
  let textarea = null;
  let gutter = null;
  let highlightLayer = null;
  let status = null;
  let submitButton = null;
  let cancelButton = null;
  let language = "text";
  let tabSize = DEFAULT_TAB_SIZE;
  let submitHandler = null;
  let cancelHandler = null;

  function updateStatus() {
    if (!status) return;
    status.textContent = `LANG: ${formatLanguageLabel(language)} | TAB: ${tabSize} | ESC: sair | CTRL+ENTER: enviar`;
  }

  function getLineCount(value) {
    if (!value) return 1;
    return value.split("\n").length;
  }

  function renderLineNumbers() {
    if (!gutter || !textarea) return;
    const lineCount = getLineCount(textarea.value);
    const numbers = Array.from({ length: lineCount }, (_, index) => index + 1).join("\n");
    gutter.textContent = numbers;
    const digits = String(lineCount).length;
    gutter.style.minWidth = `${digits + 1}ch`;
  }

  function renderHighlight() {
    if (!highlightLayer || !textarea) return;
    const code = textarea.value;
    const html = highlight(code, language);
    highlightLayer.innerHTML = html || "\n";
  }

  function syncScroll() {
    if (!textarea || !highlightLayer || !gutter) return;
    highlightLayer.scrollTop = textarea.scrollTop;
    highlightLayer.scrollLeft = textarea.scrollLeft;
    gutter.scrollTop = textarea.scrollTop;
  }

  function updateUI() {
    renderLineNumbers();
    renderHighlight();
  }

  function insertText(text) {
    if (!textarea) return;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const value = textarea.value;
    textarea.value = `${value.slice(0, start)}${text}${value.slice(end)}`;
    const cursor = start + text.length;
    textarea.setSelectionRange(cursor, cursor);
    updateUI();
  }

  function updateIndent(shouldOutdent) {
    if (!textarea) return;
    const value = textarea.value;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = value.indexOf("\n", end);
    const safeEnd = lineEnd === -1 ? value.length : lineEnd;
    const block = value.slice(lineStart, safeEnd);
    const lines = block.split("\n");

    const indent = " ".repeat(tabSize);
    let deltaStart = 0;
    let deltaEnd = 0;
    const updatedLines = lines.map((line, index) => {
      if (shouldOutdent) {
        if (line.startsWith(indent)) {
          if (index === 0) deltaStart -= indent.length;
          deltaEnd -= indent.length;
          return line.slice(indent.length);
        }
        if (line.startsWith("\t")) {
          if (index === 0) deltaStart -= 1;
          deltaEnd -= 1;
          return line.slice(1);
        }
        return line;
      }
      if (index === 0) deltaStart += indent.length;
      deltaEnd += indent.length;
      return `${indent}${line}`;
    });

    const nextValue = `${value.slice(0, lineStart)}${updatedLines.join("\n")}${value.slice(safeEnd)}`;
    textarea.value = nextValue;
    textarea.setSelectionRange(start + deltaStart, end + deltaEnd);
    updateUI();
  }

  function handleKeydown(event) {
    if (!textarea) return;

    if (event.key === "Tab") {
      event.preventDefault();
      if (event.shiftKey) {
        updateIndent(true);
      } else {
        updateIndent(false);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      if (cancelHandler) cancelHandler();
      return;
    }

    if (event.key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      if (submitHandler) submitHandler(textarea.value);
    }
  }

  function bindEvents() {
    if (!textarea) return;
    textarea.addEventListener("input", () => {
      updateUI();
    });

    textarea.addEventListener("scroll", () => {
      syncScroll();
    });

    textarea.addEventListener("keydown", handleKeydown);

    submitButton?.addEventListener("click", () => {
      if (submitHandler) submitHandler(textarea.value);
    });

    cancelButton?.addEventListener("click", () => {
      if (cancelHandler) cancelHandler();
    });
  }

  function mount(container, { language: nextLanguage, tabSize: nextTabSize } = {}) {
    root = container;
    if (!root) return;

    root.innerHTML = "";
    root.classList.add("editor-panel");

    const editorBody = document.createElement("div");
    editorBody.className = "editor-panel__body";

    const editor = document.createElement("div");
    editor.className = "code-editor";

    gutter = document.createElement("div");
    gutter.className = "code-editor__gutter";
    gutter.setAttribute("aria-hidden", "true");

    const viewport = document.createElement("div");
    viewport.className = "code-editor__viewport";

    highlightLayer = document.createElement("pre");
    highlightLayer.className = "code-editor__highlight";
    highlightLayer.setAttribute("aria-hidden", "true");

    textarea = document.createElement("textarea");
    textarea.className = "code-editor__input";
    textarea.setAttribute("spellcheck", "false");
    textarea.setAttribute("aria-label", "Editor de código");

    viewport.appendChild(highlightLayer);
    viewport.appendChild(textarea);

    editor.appendChild(gutter);
    editor.appendChild(viewport);
    editorBody.appendChild(editor);

    const footer = document.createElement("div");
    footer.className = "editor-panel__footer";

    const actions = document.createElement("div");
    actions.className = "editor-panel__actions";

    cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "editor-panel__button";
    cancelButton.textContent = "Cancelar";

    submitButton = document.createElement("button");
    submitButton.type = "button";
    submitButton.className = "editor-panel__button editor-panel__button--primary";
    submitButton.textContent = "Enviar";

    actions.appendChild(cancelButton);
    actions.appendChild(submitButton);

    status = document.createElement("div");
    status.className = "editor-panel__status";

    footer.appendChild(actions);
    footer.appendChild(status);

    root.appendChild(editorBody);
    root.appendChild(footer);

    language = nextLanguage ?? language;
    tabSize = Number.isFinite(nextTabSize) ? nextTabSize : DEFAULT_TAB_SIZE;

    updateStatus();
    setValue("");
    bindEvents();
  }

  function setValue(value) {
    if (!textarea) return;
    textarea.value = value ?? "";
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
    updateUI();
  }

  function getValue() {
    return textarea?.value ?? "";
  }

  function focus() {
    textarea?.focus();
  }

  function onSubmit(callback) {
    submitHandler = callback;
  }

  function onCancel(callback) {
    cancelHandler = callback;
  }

  function updateHighlight(languageValue) {
    language = languageValue ?? language;
    updateStatus();
    renderHighlight();
  }

  return {
    mount,
    setValue,
    getValue,
    focus,
    onSubmit,
    onCancel,
    updateHighlight,
  };
}
