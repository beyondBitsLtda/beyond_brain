function formatDateTime(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (val) => String(val).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(" ");
}

export function createNoteViewer() {
  const container = document.getElementById("note-viewer");
  if (!container) {
    throw new Error("Note viewer container is required.");
  }

  const backdrop = container.querySelector(".note-viewer__backdrop");
  const panel = container.querySelector(".note-viewer__panel");
  const closeButton = container.querySelector(".note-viewer__close");
  const subjectEl = container.querySelector(".note-viewer__subject");
  const metaEl = container.querySelector(".note-viewer__meta");
  const actionsEl = container.querySelector(".note-viewer__actions");
  const bodyEl = container.querySelector(".note-viewer__body");

  let openState = false;

  function open(note) {
    const subject = note?.subject ?? "(sem assunto)";
    const moment = note?.moment ?? "";
    const created = formatDateTime(note?.created_at ?? "");
    const meta = [moment, created].filter(Boolean).join(" | ");
    const body = note?.body ?? "";
    const index = Number.isFinite(note?.__index) ? note.__index : null;

    subjectEl.textContent = subject;
    metaEl.textContent = meta;
    bodyEl.textContent = body || "(nota sem conteúdo)";
    if (actionsEl) {
      if (index) {
        const padded = String(index).padStart(2, "0");
        actionsEl.textContent = `Actions: mark ${padded} ideia | mark ${padded} task | mark ${padded} clear`;
        actionsEl.hidden = false;
      } else {
        actionsEl.textContent = "";
        actionsEl.hidden = true;
      }
    }

    container.hidden = false;
    openState = true;
  }

  function close() {
    if (!openState) return;
    container.hidden = true;
    openState = false;
  }

  closeButton?.addEventListener("click", () => close());
  backdrop?.addEventListener("click", () => close());

  document.addEventListener("keydown", (event) => {
    if (!openState) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });

  return { open, close };
}
