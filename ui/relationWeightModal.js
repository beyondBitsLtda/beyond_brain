let instance = null;

const WEIGHTS = [1, 2, 3, 4, 5];

export function createRelationWeightModal(container = document.body) {
  if (instance) return instance;

  const modal = document.createElement("section");
  modal.className = "relation-weight-modal";
  modal.hidden = true;
  container.appendChild(modal);

  modal.innerHTML = `
    <div class="relation-weight-modal__backdrop" data-action="backdrop"></div>
    <div
      class="relation-weight-modal__panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="relation-weight-modal-title"
      tabindex="-1"
    >
      <header class="relation-weight-modal__header">
        <h3 class="relation-weight-modal__title" id="relation-weight-modal-title">Ajustar peso</h3>
      </header>
      <div class="relation-weight-modal__body">
        <p class="relation-weight-modal__label">Escolha o peso (1-5)</p>
        <div class="relation-weight-modal__buttons" data-field="buttons"></div>
        <p class="relation-weight-modal__error" role="alert" hidden></p>
      </div>
      <footer class="relation-weight-modal__actions">
        <button class="relation-weight-modal__button" type="button" data-action="cancel">Cancelar</button>
      </footer>
    </div>
  `;

  const buttonsContainer = modal.querySelector("[data-field='buttons']");
  const errorEl = modal.querySelector(".relation-weight-modal__error");
  const cancelButton = modal.querySelector('[data-action="cancel"]');
  const backdrop = modal.querySelector(".relation-weight-modal__backdrop");
  const panel = modal.querySelector(".relation-weight-modal__panel");

  let activeHandlers = {};
  let lastFocused = null;
  let isProcessing = false;

  function setProcessing(state) {
    isProcessing = state;
    if (cancelButton) cancelButton.disabled = state;
    if (buttonsContainer) {
      buttonsContainer.querySelectorAll("button").forEach((button) => {
        button.disabled = state;
      });
    }
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

  async function handleSelect(weight) {
    if (isProcessing) return;
    setProcessing(true);
    try {
      const result = await activeHandlers.onSelect?.(weight);
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
      setError(error?.message || "Erro ao atualizar peso.");
      setProcessing(false);
    }
  }

  function handleCancel() {
    if (isProcessing) return;
    activeHandlers.onCancel?.();
    close();
  }

  function open({ currentWeight = 1, onSelect, onCancel } = {}) {
    activeHandlers = { onSelect, onCancel };
    setError("");
    setProcessing(false);
    lastFocused = document.activeElement;
    if (buttonsContainer) {
      buttonsContainer.innerHTML = "";
      WEIGHTS.forEach((weight) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "relation-weight-modal__weight";
        if (weight === currentWeight) {
          button.classList.add("relation-weight-modal__weight--active");
        }
        button.textContent = String(weight);
        button.addEventListener("click", () => handleSelect(weight));
        buttonsContainer.appendChild(button);
      });
    }
    modal.hidden = false;
    requestAnimationFrame(() => {
      buttonsContainer?.querySelector("button")?.focus();
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
  }

  if (cancelButton) {
    cancelButton.addEventListener("click", (event) => {
      event.preventDefault();
      handleCancel();
    });
  }

  modal.addEventListener("keydown", (event) => {
    if (modal.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      handleCancel();
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
