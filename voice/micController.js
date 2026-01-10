import { getSupabaseClient } from "../supabaseClient.js";
import { getBodyColumnMigrationHint, insertNote } from "../notesService.js";
import { createMicOverlay } from "../ui/micOverlay.js";

const STATUS = {
  LISTENING: "Ouvindo...",
  STOPPED: "Parado",
  ERROR: "Erro",
};

export function createMicController(bus) {
  const overlay = createMicOverlay({
    onStop: () => stop(),
    onReset: () => reset(),
    onSend: () => send(),
    onClose: () => close(),
    onBackdrop: () => close(),
  });

  let recognition = null;
  let isListening = false;
  let finalTranscript = "";
  let interimTranscript = "";
  let closed = true;

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  function getTranscript() {
    return [finalTranscript, interimTranscript].filter(Boolean).join(" ").trim();
  }

  function updateTranscriptDisplay() {
    overlay.setTranscript(getTranscript());
  }

  function setStatus(text, listening = false) {
    overlay.setStatus(text, { listening });
  }

  function showMessage(text) {
    overlay.setMessage(text);
  }

  function clearMessage() {
    overlay.setMessage("");
  }

  function handleResult(event) {
    let interim = "";
    let final = finalTranscript;

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const transcript = result[0]?.transcript ?? "";
      if (result.isFinal) {
        final = `${final} ${transcript}`.trim();
      } else {
        interim = `${interim} ${transcript}`.trim();
      }
    }

    finalTranscript = final;
    interimTranscript = interim;
    updateTranscriptDisplay();
  }

  function handleError(event) {
    const error = event.error;
    if (error === "not-allowed" || error === "permission-denied") {
      showMessage("Permissão do microfone negada.");
    } else if (error === "no-speech") {
      showMessage("Nenhuma fala detectada. Tente novamente.");
    } else {
      showMessage("Erro ao capturar áudio. Tente novamente.");
    }
    setStatus(STATUS.ERROR, false);
    isListening = false;
  }

  function handleEnd() {
    if (closed) return;
    if (!isListening) {
      setStatus(STATUS.STOPPED, false);
    }
  }

  function buildRecognition() {
    if (!SpeechRecognition) {
      return null;
    }
    const instance = new SpeechRecognition();
    instance.lang = "pt-BR";
    instance.interimResults = true;
    instance.continuous = true;
    instance.onresult = handleResult;
    instance.onerror = handleError;
    instance.onend = handleEnd;
    instance.onstart = () => {
      isListening = true;
      setStatus(STATUS.LISTENING, true);
    };
    return instance;
  }

  function start() {
    if (isListening) {
      return;
    }
    clearMessage();
    if (!SpeechRecognition) {
      setStatus(STATUS.ERROR, false);
      showMessage("Seu navegador não suporta ditado por voz.");
      return;
    }
    if (!recognition) {
      recognition = buildRecognition();
    }
    if (!recognition) {
      setStatus(STATUS.ERROR, false);
      showMessage("Seu navegador não suporta ditado por voz.");
      return;
    }
    try {
      recognition.start();
      isListening = true;
    } catch (error) {
      showMessage("Não foi possível iniciar o microfone.");
      setStatus(STATUS.ERROR, false);
      isListening = false;
    }
  }

  function stop() {
    if (recognition && isListening) {
      recognition.stop();
    }
    isListening = false;
    setStatus(STATUS.STOPPED, false);
  }

  function reset() {
    finalTranscript = "";
    interimTranscript = "";
    updateTranscriptDisplay();
    stop();
    recognition = null;
    start();
  }

  async function send() {
    if (isListening) {
      stop();
    }

    clearMessage();
    const transcript = getTranscript();
    if (!transcript) {
      showMessage("Nenhuma transcrição para enviar.");
      return;
    }

    const { client, error } = getSupabaseClient();
    if (error || !client) {
      showMessage(
        "Supabase não configurado. Use auth --register ou auth para autenticar."
      );
      return;
    }

    const { data, error: authError } = await client.auth.getUser();
    if (authError || !data?.user) {
      showMessage("Faça login (auth) para salvar.");
      return;
    }

    const { error: insertError } = await insertNote({
      client,
      userId: data.user.id,
      subject: "Quick Thought",
      moment: "Voice",
      body: transcript,
      ref: "voice",
    });

    if (insertError) {
      showMessage(`Erro ao inserir nota: ${insertError.message}`);
      const hint = getBodyColumnMigrationHint(insertError);
      if (hint) {
        showMessage(hint);
      }
      return;
    }

    close();
  }

  function open() {
    if (!closed) {
      return;
    }
    closed = false;
    overlay.open();
    updateTranscriptDisplay();
    setStatus(STATUS.STOPPED, false);
    start();
  }

  function close() {
    closed = true;
    stop();
    overlay.close();
  }

  if (bus?.on) {
    bus.on("input:escape", () => {
      if (!closed) {
        close();
      }
    });
  }

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !closed) {
      event.preventDefault();
      close();
    }
  });

  return {
    open,
    close,
    start,
    stop,
    reset,
    getTranscript,
  };
}
