let instance = null;

export function createRelationModal(container = document.body) {
  if (instance) {
    return instance;
  }

  const modal = document.createElement("section");
  modal.className = "relation-modal";
  modal.hidden = true;
  container.appendChild(modal);

  modal.innerHTML = `
    <div class="relation-modal__backdrop" data-action="backdrop"></div>
    <div
      class="relation-modal__panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="relation-modal-title"
      aria-describedby="relation-modal-body"
      tabindex="-1"
    >
      <header class="relation-modal__header">
        <h3 class="relation-modal__title" id="relation-modal-title">Criar relação</h3>
      </header>
      <div class="relation-modal__body" id="relation-modal-body">
        <div class="relation-modal__row">
          <span class="relation-modal__label">From</span>
          <span class="relation-modal__value" data-field="from"></span>
        </div>
        <div class="relation-modal__row">
          <span class="relation-modal__label">To</span>
          <span class="relation-modal__value" data-field="to"></span>
        </div>
        <label class="relation-modal__field">
          <span class="relation-modal__label">Tipo</span>
          <select class="relation-modal__select" data-field="type">
            <option value="related">related</option>
            <option value="ref">ref</option>
            <option value="expands">expands</option>
            <option value="contradicts">contradicts</option>
          </select>
        </label>
        <p class="relation-modal__error" role="alert" hidden></p>
      </div>
      <footer class="relation-modal__actions">
        <button class="relation-modal__button" type="button" data-action="cancel">Cancelar</button>
        <button class="relation-modal__button relation-modal__button--primary" type="button" data-action="confirm">
          Criar
        </button>
      </footer>
    </div>
  `;

  const fromEl = modal.querySelector('[data-field="from"]');
  const toEl = modal.querySelector('[data-field="to"]');
  const typeSelect = modal.querySelector('[data-field="type"]');
  const errorEl = modal.querySelector(".relation-modal__error");
  const confirmButton = modal.querySelector('[data-action="confirm"]');
  const cancelButton = modal.querySelector('[data-action="cancel"]');
  const backdrop = modal.querySelector(".relation-modal__backdrop");

  let activeHandlers = {};
  let lastFocused = null;
  let isProcessing = false;

  function setProcessing(state) {
    isProcessing = state;
    if (confirmButton) confirmButton.disabled = state;
    if (cancelButton) cancelButton.disabled = state;
    if (typeSelect) typeSelect.disabled = state;
  }

  function setError(text) {
    if (!errorEl) return;
    if (!text) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = text;
  }

  function close() {
    modal.hidden = true;
    setProcessing(false);
    setError("");
    if (lastFocused && typeof lastFocused.focus === "function") {
      lastFocused.focus();
    }
  }

  async function handleConfirm() {
    if (isProcessing) return;
    setProcessing(true);
    try {
      const selectedType = typeSelect?.value ?? "related";
      const result = await activeHandlers.onConfirm?.(selectedType);
      if (result && typeof result === "object" && result.errorMessage) {
        setError(result.errorMessage);
        setProcessing(false);
        return;
      }
      if (result === false) {
        setProcessing(false);
        return;
      }
      if (!modal.hidden) {
        close();
      }
    } catch (error) {
      setError(error?.message || "Erro ao criar relação.");
      setProcessing(false);
    }
  }

  function handleCancel() {
    if (isProcessing) return;
    activeHandlers.onCancel?.();
    close();
  }

  function open({ fromNote, toNote, defaultType = "related", onConfirm, onCancel }) {
    activeHandlers = { onConfirm, onCancel };
    if (fromEl) fromEl.textContent = fromNote?.subject || "(sem assunto)";
    if (toEl) toEl.textContent = toNote?.subject || "(sem assunto)";
    if (typeSelect) typeSelect.value = defaultType;
    setError("");
    setProcessing(false);
    lastFocused = document.activeElement;
    modal.hidden = false;
    requestAnimationFrame(() => {
      typeSelect?.focus();
    });
  }

  modal.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.getAttribute("data-action");
    if (action === "confirm") handleConfirm();
    if (action === "cancel" || action === "backdrop") handleCancel();
  });

  modal.addEventListener("keydown", (event) => {
    if (modal.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      handleCancel();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      handleConfirm();
    }
  });

  if (backdrop) {
    backdrop.addEventListener("pointerdown", (event) => {
      event.preventDefault();
    });
  }

  instance = { open, close, setError, element: modal };
  return instance;
}
