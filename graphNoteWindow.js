export function createGraphNoteWindow(overlay) {
  if (!overlay) {
    throw new Error("Graph overlay element is required to render note window.");
  }

  let container = overlay.querySelector("#noteContentWindow");
  if (!container) {
    container = document.createElement("div");
    container.id = "noteContentWindow";
    container.className = "graph-note-window";
    container.hidden = true;

    const backdrop = document.createElement("div");
    backdrop.className = "graph-note-window__backdrop";

    const panel = document.createElement("div");
    panel.className = "graph-note-window__panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Conteúdo da nota");

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "graph-note-window__close";
    closeButton.setAttribute("aria-label", "Fechar");
    closeButton.textContent = "×";

    const content = document.createElement("pre");
    content.className = "graph-note-window__body";

    panel.appendChild(closeButton);
    panel.appendChild(content);
    container.appendChild(backdrop);
    container.appendChild(panel);
    overlay.appendChild(container);
  }

  const panel = container.querySelector(".graph-note-window__panel");
  const content = container.querySelector(".graph-note-window__body");
  const closeButton = container.querySelector(".graph-note-window__close");

  let openState = false;

  function setBody(body) {
    const value = typeof body === "string" ? body.trim() : "";
    content.textContent = value.length > 0 ? body : "(nota sem conteúdo)";
  }

  function open(body) {
    setBody(body);
    container.hidden = false;
    openState = true;
  }

  function close() {
    if (!openState) return;
    container.hidden = true;
    openState = false;
  }

  function isOpen() {
    return openState;
  }

  closeButton.addEventListener("click", () => close());

  overlay.addEventListener("pointerdown", (event) => {
    if (!openState) return;
    if (panel.contains(event.target)) return;
    close();
  });

  document.addEventListener("keydown", (event) => {
    if (!openState) return;
    if (event.key === "Escape") {
      close();
    }
  });

  return { open, close, isOpen };
}
