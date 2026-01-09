export function createMicOverlay({
  onStop,
  onReset,
  onSend,
  onClose,
  onBackdrop,
} = {}) {
  let overlay = document.getElementById("mic-overlay");

  if (!overlay) {
    overlay = document.createElement("section");
    overlay.id = "mic-overlay";
    overlay.className = "mic-overlay";
    overlay.hidden = true;
    const terminalBody = document.querySelector(".terminal__body") ?? document.body;
    terminalBody.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="mic-overlay__backdrop" data-action="backdrop"></div>
    <div class="mic-overlay__panel" role="dialog" aria-modal="true" aria-label="Ditado por voz">
      <header class="mic-overlay__header">
        <div class="mic-overlay__title">
          <span>MIC</span>
          <span class="mic-overlay__status">
            <span class="mic-overlay__dot" aria-hidden="true"></span>
            <span class="mic-overlay__status-text">Parado</span>
          </span>
        </div>
        <button class="mic-overlay__close" type="button" aria-label="Fechar" data-action="close">×</button>
      </header>
      <div class="mic-overlay__body">
        <div class="mic-overlay__transcript" aria-live="polite"></div>
      </div>
      <div class="mic-overlay__message" role="alert" hidden></div>
      <footer class="mic-overlay__actions">
        <button class="mic-overlay__button" type="button" data-action="stop">Parar</button>
        <button class="mic-overlay__button" type="button" data-action="reset">Refazer</button>
        <button class="mic-overlay__button mic-overlay__button--primary" type="button" data-action="send">Enviar</button>
      </footer>
    </div>
  `;

  const statusText = overlay.querySelector(".mic-overlay__status-text");
  const dot = overlay.querySelector(".mic-overlay__dot");
  const transcript = overlay.querySelector(".mic-overlay__transcript");
  const message = overlay.querySelector(".mic-overlay__message");
  const backdrop = overlay.querySelector(".mic-overlay__backdrop");

  function open() {
    overlay.hidden = false;
  }

  function close() {
    overlay.hidden = true;
  }

  function setStatus(text, { listening = false } = {}) {
    if (statusText) {
      statusText.textContent = text;
    }
    if (dot) {
      dot.dataset.active = listening ? "true" : "false";
    }
  }

  function setTranscript(text) {
    if (transcript) {
      transcript.textContent = text || "";
      transcript.scrollTop = transcript.scrollHeight;
    }
  }

  function setMessage(text) {
    if (!message) return;
    if (!text) {
      message.hidden = true;
      message.textContent = "";
      return;
    }
    message.hidden = false;
    message.textContent = text;
  }

  overlay.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.getAttribute("data-action");
    if (action === "stop" && onStop) onStop();
    if (action === "reset" && onReset) onReset();
    if (action === "send" && onSend) onSend();
    if (action === "close" && onClose) onClose();
    if (action === "backdrop" && onBackdrop) onBackdrop();
  });

  if (backdrop) {
    backdrop.addEventListener("pointerdown", (event) => {
      event.preventDefault();
    });
  }

  return {
    open,
    close,
    setStatus,
    setTranscript,
    setMessage,
    element: overlay,
  };
}
