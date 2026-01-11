let instance = null;

export function createConfirmModal(container = document.body) {
  if (instance) {
    if (container && instance.element && instance.element.parentElement !== container) {
      container.appendChild(instance.element);
    }
    return instance;
  }

  const modal = document.createElement("section");
  modal.className = "confirm-modal";
  modal.hidden = true;
  container.appendChild(modal);

  modal.innerHTML = `
    <div class="confirm-modal__backdrop" data-action="backdrop"></div>
    <div
      class="confirm-modal__panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-message"
      tabindex="-1"
    >
      <header class="confirm-modal__header">
        <h3 class="confirm-modal__title" id="confirm-modal-title"></h3>
      </header>
      <div class="confirm-modal__body">
        <p class="confirm-modal__message" id="confirm-modal-message"></p>
        <p class="confirm-modal__detail" hidden></p>
        <p class="confirm-modal__warning" hidden>Essa ação é irreversível.</p>
        <p class="confirm-modal__error" role="alert" hidden></p>
      </div>
      <footer class="confirm-modal__actions">
        <button class="confirm-modal__button" type="button" data-action="cancel">Não</button>
        <button class="confirm-modal__button" type="button" data-action="confirm">Sim, deletar</button>
      </footer>
    </div>
  `;

  const titleEl = modal.querySelector(".confirm-modal__title");
  const messageEl = modal.querySelector(".confirm-modal__message");
  const detailEl = modal.querySelector(".confirm-modal__detail");
  const warningEl = modal.querySelector(".confirm-modal__warning");
  const errorEl = modal.querySelector(".confirm-modal__error");
  const confirmButton = modal.querySelector('[data-action="confirm"]');
  const cancelButton = modal.querySelector('[data-action="cancel"]');
  const backdrop = modal.querySelector(".confirm-modal__backdrop");
  const panel = modal.querySelector(".confirm-modal__panel");

  let activeHandlers = {};
  let lastFocused = null;
  let isProcessing = false;

  function setProcessing(state) {
    isProcessing = state;
    if (confirmButton) confirmButton.disabled = state;
    if (cancelButton) cancelButton.disabled = state;
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
      const result = await activeHandlers.onConfirm?.();
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
      setError(error?.message || "Erro ao confirmar a ação.");
      setProcessing(false);
    }
  }

  function handleCancel() {
    if (isProcessing) return;
    activeHandlers.onCancel?.();
    close();
  }

  function open({
    title,
    message,
    detail,
    confirmLabel = "Confirmar",
    cancelLabel = "Cancelar",
    danger = false,
    onConfirm,
    onCancel,
  }) {
    activeHandlers = { onConfirm, onCancel };
    if (titleEl) titleEl.textContent = title ?? "";
    if (messageEl) messageEl.textContent = message ?? "";
    if (detailEl) {
      if (detail) {
        detailEl.hidden = false;
        detailEl.textContent = detail;
      } else {
        detailEl.hidden = true;
        detailEl.textContent = "";
      }
    }
    if (warningEl) {
      warningEl.hidden = !danger;
    }
    if (confirmButton) {
      confirmButton.textContent = confirmLabel;
      confirmButton.classList.toggle("confirm-modal__button--danger", Boolean(danger));
    }
    if (cancelButton) {
      cancelButton.textContent = cancelLabel;
    }
    setError("");
    setProcessing(false);
    lastFocused = document.activeElement;
    modal.hidden = false;
    requestAnimationFrame(() => {
      cancelButton?.focus();
    });
  }

  modal.addEventListener("click", (event) => {
    const target = event.target.closest('[data-action="backdrop"]');
    if (target) {
      handleCancel();
    }
  });

  if (panel) {
    panel.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      event.stopImmediatePropagation();
    });
    panel.addEventListener("click", (event) => {
      event.stopPropagation();
      event.stopImmediatePropagation();
      const target = event.target.closest("[data-action]");
      if (!target) return;
      const action = target.getAttribute("data-action");
      if (action === "confirm") {
        handleConfirm();
      }
      if (action === "cancel") {
        handleCancel();
      }
    });
  }

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
