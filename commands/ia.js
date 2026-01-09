import { getSupabaseClient } from "../supabaseClient.js";
import { clearSession } from "../sessionStore.js";
import {
  clearGeminiKey,
  getGeminiKey,
  maskKey,
  setGeminiKey,
} from "../ai/aiConfig.js";
import { generateText } from "../ai/geminiClient.js";
import { GEMINI_API_VERSION, GEMINI_MODEL } from "../ai/geminiConfig.js";
import {
  advancePairBrainIndex,
  clearPairBrainSession,
  getPairBrainSession,
  recordPairBrainTurn,
  startPairBrainSession,
} from "../ai/pairBrainSession.js";

const MIN_KEY_LENGTH = 20;
const MAX_OUTPUT_LENGTH = 1200;
const DEFAULT_SUGGEST_LIMIT = 10;
const MAX_SUGGEST_LIMIT = 20;
const PAIR_BRAIN_NOTE_LIMIT = 20;
const NOTE_FIELDS = ["id", "subject", "moment", "body", "created_at"];

function emitPrompt(bus, label, { masked = false, placeholder = "" } = {}) {
  bus.emit("output:append", label);
  bus.emit(masked ? "input:mask" : "input:unmask");
  bus.emit("input:placeholder", placeholder);
  bus.emit("input:focus");
}

function finishCapture(bus) {
  bus.emit("router:capture:stop");
  bus.emit("input:unmask");
  bus.emit("input:placeholder", "");
}

function parseKeyValuePairs(raw) {
  const pairs = {};
  const regex = /(\w+)="([^"]*)"/g;
  let match = null;
  while ((match = regex.exec(raw)) !== null) {
    pairs[match[1].toLowerCase()] = match[2].trim();
  }
  return pairs;
}

function parseLimit(raw) {
  const match = raw.match(/LIMIT\s+(\d+)/i);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isNaN(value) ? null : value;
}

function truncateOutput(text) {
  if (!text) return "";
  if (text.length <= MAX_OUTPUT_LENGTH) return text;
  return `${text.slice(0, MAX_OUTPUT_LENGTH)}…(truncado)`;
}

function parseAskQuestion(raw) {
  const quoted = raw.match(/^\s*ia ask\s+["“”']([\s\S]+)["“”']\s*$/i);
  if (quoted) {
    return quoted[1].trim();
  }
  if (raw.trim().toLowerCase() === "ia ask") {
    return "";
  }
  const direct = raw.match(/^\s*ia ask\s+(.+)$/i);
  if (direct) {
    return direct[1].trim();
  }
  return "";
}

function buildAskPrompt(question) {
  return [
    "Responda em PT-BR.",
    "Seja direto e objetivo.",
    "Se precisar, use bullets curtos.",
    "",
    `Pergunta: ${question}`,
  ].join("\n");
}

function buildPairBrainSelectionPrompt(notes) {
  const list = notes
    .map((note) => {
      const body = (note.body ?? "").replace(/\s+/g, " ").trim();
      const shortBody = body.length > 220 ? `${body.slice(0, 217)}...` : body;
      return `- id=${note.id} | subject=${note.subject ?? ""} | moment=${
        note.moment ?? ""
      } | body=${shortBody}`;
    })
    .join("\n");

  return [
    "Você é um mentor crítico e construtivo.",
    "Escolha 3 notas distintas (evite subject igual) e escreva 1 pergunta crítica por nota.",
    "Responda SOMENTE com JSON estrito no formato:",
    '{ "selected": [{"id":"...","subject":"..."}], "questions": [{"note_id":"...","q":"..."}] }',
    "As perguntas devem ser específicas, diretas e revelar lacunas ou contradições.",
    "",
    "Notas disponíveis:",
    list,
  ].join("\n");
}

function buildPairBrainRebuttalPrompt(note, question, answer) {
  const body = (note.body ?? "").replace(/\s+/g, " ").trim();
  const shortBody = body.length > 240 ? `${body.slice(0, 237)}...` : body;
  return [
    "Você é um advogado do diabo, crítico e direto, sem agressividade.",
    "Gere uma retruca curta (até 5 linhas) que provoque clareza e ação.",
    "Não faça nova pergunta.",
    "",
    `Nota: ${note.subject ?? ""}`,
    `Contexto: ${shortBody}`,
    `Pergunta: ${question}`,
    `Resposta do usuário: ${answer}`,
  ].join("\n");
}

function buildPairBrainClosingPrompt(history) {
  const items = history
    .map((entry, index) => {
      const base = [
        `Rodada ${index + 1}: ${entry.subject}`,
        `Pergunta: ${entry.question}`,
      ];
      if (entry.answer) {
        base.push(`Resposta: ${entry.answer}`);
      }
      if (entry.rebuttal) {
        base.push(`Retruca: ${entry.rebuttal}`);
      }
      return base.join(" | ");
    })
    .join("\n");

  return [
    "Com base no diálogo abaixo, gere um fechamento curto.",
    'A resposta deve começar com: "O que eu acho que você deve fazer agora:".',
    "Seja direto, no máximo 2 linhas.",
    "",
    items,
  ].join("\n");
}

function extractJsonPayload(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (innerError) {
      return null;
    }
  }
}

function validatePairBrainSelection(payload, noteMap) {
  const selected = Array.isArray(payload?.selected) ? payload.selected : null;
  const questions = Array.isArray(payload?.questions) ? payload.questions : null;
  if (!selected || !questions || selected.length !== 3 || questions.length !== 3) {
    return null;
  }

  const uniqueSubjects = new Set();
  const selectedNotes = [];
  for (const item of selected) {
    const note = noteMap.get(item?.id);
    if (!note) return null;
    const subjectKey = String(note.subject ?? "").trim().toLowerCase();
    if (subjectKey && uniqueSubjects.has(subjectKey)) {
      return null;
    }
    if (subjectKey) uniqueSubjects.add(subjectKey);
    selectedNotes.push(note);
  }

  const questionMap = new Map();
  for (const item of questions) {
    if (!item?.note_id || !item?.q) return null;
    if (!noteMap.has(item.note_id)) return null;
    questionMap.set(item.note_id, String(item.q).trim());
  }

  const orderedQuestions = selectedNotes.map((note) => questionMap.get(note.id));
  if (orderedQuestions.some((q) => !q)) return null;

  return { notes: selectedNotes, questions: orderedQuestions };
}

async function getAuthenticatedUser(bus, client) {
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) {
    clearSession();
    bus.emit("output:append", "Você precisa estar logado para usar este comando.");
    return null;
  }
  return data.user;
}

function ensureGeminiKey(bus) {
  const key = getGeminiKey();
  if (!key) {
    bus.emit("output:append", "ERR: IA não configurada. Use IA para configurar.");
    return null;
  }
  return key;
}

function buildInsightPrompt(note) {
  return [
    "Você é um assistente que gera insights curtos e úteis.",
    "Responda exatamente no formato:",
    "Resumo: <1 linha>",
    "- Insight 1",
    "- Insight 2",
    "- Insight 3",
    "Perguntas:",
    "- Pergunta 1",
    "- Pergunta 2",
    "- Pergunta 3",
    "",
    "Nota:",
    `Subject: ${note.subject ?? ""}`,
    `Moment: ${note.moment ?? ""}`,
    `Body: ${note.body ?? ""}`,
  ].join("\n");
}

function buildSuggestLinksPrompt(notes) {
  const list = notes
    .map((note) => {
      const body = (note.body ?? "").replace(/\s+/g, " ").trim();
      const shortBody = body.length > 140 ? `${body.slice(0, 137)}...` : body;
      return `- id=${note.id} | subject=${note.subject ?? ""} | body=${shortBody}`;
    })
    .join("\n");

  return [
    "Sugira conexões entre notas. Responda apenas com comandos prontos, um por linha, no formato:",
    'LINK from="..." to="..." type="related" reason="..."',
    "Não execute nada, não inclua texto extra.",
    "",
    "Notas:",
    list,
  ].join("\n");
}

function buildSummarizeTodayPrompt(notes) {
  const list = notes
    .map((note) => {
      const body = (note.body ?? "").replace(/\s+/g, " ").trim();
      const shortBody = body.length > 200 ? `${body.slice(0, 197)}...` : body;
      return `- ${note.subject ?? ""}: ${shortBody}`;
    })
    .join("\n");

  return [
    "Resuma o dia com base nas notas abaixo.",
    "Entrega desejada:",
    "- Resumo do dia (5-8 linhas)",
    "- Top 3 temas recorrentes",
    "- Uma recomendação de foco",
    "",
    "Notas:",
    list,
  ].join("\n");
}

function buildTitlePrompt(note) {
  return [
    "Sugira 3 subjects melhores para a nota abaixo.",
    "Responda apenas com 3 linhas, cada uma com um subject.",
    "",
    `Body: ${note.body ?? ""}`,
  ].join("\n");
}

async function callGemini(bus, prompt, apiKey) {
  try {
    const text = await generateText(prompt, apiKey);
    return truncateOutput(text);
  } catch (error) {
    const message = error?.message ?? "Erro desconhecido.";
    bus.emit("output:append", `ERR: ${message}`);
    return null;
  }
}

async function selectPairBrainNotes(bus, notes, apiKey) {
  const noteMap = new Map(notes.map((note) => [note.id, note]));
  const prompt = buildPairBrainSelectionPrompt(notes);

  let response = null;
  try {
    response = await generateText(prompt, apiKey);
  } catch (error) {
    const message = error?.message ?? "Erro desconhecido.";
    bus.emit("output:append", `ERR: ${message}`);
    return null;
  }

  let payload = extractJsonPayload(response);
  let selection = validatePairBrainSelection(payload, noteMap);
  if (!selection) {
    const retryPrompt = [
      "Retorne apenas JSON válido conforme o esquema.",
      '{ "selected": [{"id":"...","subject":"..."}], "questions": [{"note_id":"...","q":"..."}] }',
      "",
      `Texto anterior: ${response}`,
    ].join("\n");

    try {
      response = await generateText(retryPrompt, apiKey);
    } catch (error) {
      const message = error?.message ?? "Erro desconhecido.";
      bus.emit("output:append", `ERR: ${message}`);
      return null;
    }

    payload = extractJsonPayload(response);
    selection = validatePairBrainSelection(payload, noteMap);
  }

  if (!selection) {
    bus.emit("output:append", "ERR: não foi possível preparar o Pair Brain.");
    return null;
  }

  return selection;
}

function showPairBrainQuestion(bus, apiKey) {
  const session = getPairBrainSession();
  const note = session.notes[session.index];
  const question = session.questions[session.index];
  if (!note || !question) {
    bus.emit("output:append", "ERR: sessão inconsistente. Encerrando.");
    clearPairBrainSession();
    bus.emit("router:capture:stop");
    return;
  }

  session.phase = "await_user";
  session.lastQuestion = question;
  bus.emit("output:append", `Nota ${session.index + 1}/3: ${note.subject ?? ""}`);
  bus.emit("output:append", `Q${session.index + 1}: ${question}`);
  bus.emit("output:append", "Sua resposta:");
  bus.emit("input:placeholder", "digite sua resposta");
  bus.emit("input:unmask");
  bus.emit("router:capture:start", {
    echo: "normal",
    handler: (value) => handlePairBrainInput(bus, value, apiKey),
    onCancel: () => {
      finishCapture(bus);
      clearPairBrainSession();
      bus.emit("output:append", "PAIR BRAIN cancelado.");
    },
  });
}

async function handlePairBrainInput(bus, value, apiKey) {
  const session = getPairBrainSession();
  if (!session.active) {
    bus.emit("router:capture:stop");
    return;
  }

  const input = value.trim();
  const normalized = input.toLowerCase();

  if (normalized === "cancel") {
    finishCapture(bus);
    clearPairBrainSession();
    bus.emit("output:append", "PAIR BRAIN cancelado.");
    return;
  }

  if (normalized === "skip") {
    recordPairBrainTurn({
      subject: session.notes[session.index]?.subject ?? "",
      question: session.questions[session.index],
      answer: "",
      rebuttal: "",
      skipped: true,
    });
    if (session.index >= session.notes.length - 1) {
      await finishPairBrain(bus, apiKey);
      return;
    }
    advancePairBrainIndex();
    showPairBrainQuestion(bus, apiKey);
    return;
  }

  if (!input) {
    bus.emit("output:append", "Resposta vazia. Tente novamente ou use cancel.");
    return;
  }

  if (session.phase === "rebut") {
    bus.emit("output:append", "Aguarde a resposta da IA.");
    return;
  }

  session.phase = "rebut";
  session.lastUserAnswer = input;

  const note = session.notes[session.index];
  const question = session.questions[session.index];
  const rebuttalPrompt = buildPairBrainRebuttalPrompt(note, question, input);

  let rebuttal = null;
  try {
    rebuttal = await generateText(rebuttalPrompt, apiKey);
  } catch (error) {
    const message = error?.message ?? "Erro desconhecido.";
    bus.emit("output:append", `ERR: ${message}`);
    bus.emit("output:append", "ERR: IA indisponível, encerrando Pair Brain.");
    finishCapture(bus);
    clearPairBrainSession();
    return;
  }

  const trimmedRebuttal = truncateOutput(rebuttal);
  trimmedRebuttal.split("\n").forEach((line) => bus.emit("output:append", line));
  recordPairBrainTurn({
    subject: note.subject ?? "",
    question,
    answer: input,
    rebuttal: trimmedRebuttal,
  });

  if (session.index >= session.notes.length - 1) {
    await finishPairBrain(bus, apiKey);
    return;
  }

  advancePairBrainIndex();
  showPairBrainQuestion(bus, apiKey);
}

async function finishPairBrain(bus, apiKey) {
  const session = getPairBrainSession();
  let closing = null;
  try {
    closing = await generateText(buildPairBrainClosingPrompt(session.history), apiKey);
  } catch (error) {
    const message = error?.message ?? "Erro desconhecido.";
    bus.emit("output:append", `ERR: ${message}`);
    bus.emit("output:append", "ERR: IA indisponível, encerrando Pair Brain.");
    finishCapture(bus);
    clearPairBrainSession();
    return;
  }

  const trimmedClosing = truncateOutput(closing);
  trimmedClosing.split("\n").forEach((line) => bus.emit("output:append", line));
  finishCapture(bus);
  clearPairBrainSession();
}

function handleAskCapture(bus, value, apiKey) {
  const question = value.trim();
  if (!question) {
    emitPrompt(bus, "Pergunta vazia. Tente novamente:", {
      masked: false,
      placeholder: "escreva sua pergunta",
    });
    bus.emit("router:capture:start", {
      echo: "normal",
      handler: (input) => handleAskCapture(bus, input, apiKey),
      onCancel: () => {
        finishCapture(bus);
        bus.emit("output:append", "IA ask: cancelado.");
      },
    });
    return;
  }

  finishCapture(bus);
  const prompt = buildAskPrompt(question);
  callGemini(bus, prompt, apiKey).then((response) => {
    if (!response) return;
    response.split("\n").forEach((line) => bus.emit("output:append", line));
  });
}

export function iaCommand(bus) {
  return async ({ raw = "" } = {}) => {
    const trimmed = raw.trim();
    const normalized = trimmed.toLowerCase();
    const pairBrainSession = getPairBrainSession();

    if (normalized === "ia") {
      const existing = getGeminiKey();
      if (existing) {
        bus.emit("output:append", `IA: configurada (${maskKey(existing)})`);
        bus.emit("output:append", "Sugestões: IA help | IA test | IA off");
        return;
      }

      emitPrompt(bus, "Cole sua Gemini API Key:", {
        masked: true,
        placeholder: "gemini api key",
      });
      bus.emit("router:capture:start", {
        echo: "mask",
        handler: handleKeyCapture,
        onCancel: () => {
          finishCapture(bus);
          bus.emit("output:append", "IA: configuração cancelada.");
        },
      });
      return;
    }

    if (normalized === "ia help") {
      bus.emit(
        "output:append",
        [
          "Comandos IA disponíveis:",
          "- IA: configurar ou mostrar status",
          "- IA help: mostra esta ajuda",
          "- IA test: testa a conexão com o Gemini",
          "- IA off: remove a chave da IA",
          '- IA ask "<pergunta>": consulta geral',
          "- IA pair brain: modo crítico guiado por 3 notas",
          '- IA insight note id="uuid": gera insights para uma nota',
          "- IA suggest links [LIMIT n]: sugere comandos LINK",
          "- IA summarize today: resume notas das últimas 24h",
          '- IA title note id="uuid": sugere 3 titles para a nota',
        ].join("\n")
      );
      return;
    }

    if (normalized === "ia off") {
      clearGeminiKey();
      bus.emit("output:append", "OK: IA desativada.");
      return;
    }

    if (normalized.startsWith("ia ask")) {
      const apiKey = ensureGeminiKey(bus);
      if (!apiKey) return;

      const question = parseAskQuestion(trimmed);
      if (!question) {
        emitPrompt(bus, "Faça sua pergunta:", {
          masked: false,
          placeholder: "escreva sua pergunta",
        });
        bus.emit("router:capture:start", {
          echo: "normal",
          handler: (value) => handleAskCapture(bus, value, apiKey),
          onCancel: () => {
            finishCapture(bus);
            bus.emit("output:append", "IA ask: cancelado.");
          },
        });
        return;
      }

      const prompt = buildAskPrompt(question);
      const response = await callGemini(bus, prompt, apiKey);
      if (!response) return;
      response.split("\n").forEach((line) => bus.emit("output:append", line));
      return;
    }

    if (normalized === "ia pair brain") {
      if (pairBrainSession.active) {
        bus.emit("output:append", "PAIR BRAIN já está ativo. Responda ou use cancel.");
        return;
      }

      const apiKey = ensureGeminiKey(bus);
      if (!apiKey) return;

      const { client, error } = getSupabaseClient();
      if (error || !client) {
        bus.emit(
          "output:append",
          "Supabase não configurado. Use auth --register ou auth para autenticar."
        );
        return;
      }

      const user = await getAuthenticatedUser(bus, client);
      if (!user) return;

      let data = null;
      let queryError = null;
      ({ data, error: queryError } = await client
        .from("notes")
        .select(NOTE_FIELDS.join(","))
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAIR_BRAIN_NOTE_LIMIT));

      if (queryError) {
        ({ data, error: queryError } = await client
          .from("notes")
          .select(NOTE_FIELDS.join(","))
          .eq("user_id", user.id)
          .order("id", { ascending: false })
          .limit(PAIR_BRAIN_NOTE_LIMIT));
      }

      if (queryError) {
        bus.emit("output:append", `Erro ao buscar notas: ${queryError.message}`);
        return;
      }

      const validNotes = (data ?? []).filter((note) => (note.body ?? "").trim());
      if (validNotes.length < 3) {
        bus.emit("output:append", "É preciso ter pelo menos 3 notas com conteúdo.");
        return;
      }

      const selection = await selectPairBrainNotes(bus, validNotes, apiKey);
      if (!selection) return;

      const { notes, questions } = selection;
      startPairBrainSession({ notes, questions });

      bus.emit(
        "output:append",
        "PAIR BRAIN iniciado. Vou escolher 3 notas e te desafiar com 3 perguntas."
      );
      showPairBrainQuestion(bus, apiKey);
      return;
    }

    if (normalized === "ia test") {
      const apiKey = ensureGeminiKey(bus);
      if (!apiKey) return;

      bus.emit("output:append", `IA model: ${GEMINI_MODEL} (${GEMINI_API_VERSION})`);
      const response = await callGemini(bus, "Responda apenas OK.", apiKey);
      if (!response) return;
      if (response === "OK") {
        bus.emit("output:append", "OK");
        return;
      }
      bus.emit("output:append", `ERR: resposta inesperada (${truncateOutput(response)})`);
      return;
    }

    if (normalized.startsWith("ia insight note")) {
      const apiKey = ensureGeminiKey(bus);
      if (!apiKey) return;

      const { client, error } = getSupabaseClient();
      if (error || !client) {
        bus.emit(
          "output:append",
          "Supabase não configurado. Use auth --register ou auth para autenticar."
        );
        return;
      }

      const user = await getAuthenticatedUser(bus, client);
      if (!user) return;

      const pairs = parseKeyValuePairs(trimmed);
      const noteId = pairs.id;
      if (!noteId) {
        bus.emit("output:append", 'Uso: IA insight note id="uuid"');
        return;
      }

      const { data, error: queryError } = await client
        .from("notes")
        .select(NOTE_FIELDS.join(","))
        .eq("id", noteId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (queryError) {
        bus.emit("output:append", `Erro ao buscar nota: ${queryError.message}`);
        return;
      }
      if (!data) {
        bus.emit("output:append", "Nota não encontrada.");
        return;
      }

      const prompt = buildInsightPrompt(data);
      const response = await callGemini(bus, prompt, apiKey);
      if (!response) return;
      response.split("\n").forEach((line) => bus.emit("output:append", line));
      return;
    }

    if (normalized.startsWith("ia suggest links")) {
      const apiKey = ensureGeminiKey(bus);
      if (!apiKey) return;

      const { client, error } = getSupabaseClient();
      if (error || !client) {
        bus.emit(
          "output:append",
          "Supabase não configurado. Use auth --register ou auth para autenticar."
        );
        return;
      }

      const user = await getAuthenticatedUser(bus, client);
      if (!user) return;

      const requestedLimit = parseLimit(trimmed);
      const limit =
        requestedLimit == null
          ? DEFAULT_SUGGEST_LIMIT
          : Math.min(Math.max(requestedLimit, 1), MAX_SUGGEST_LIMIT);

      let data = null;
      let queryError = null;
      ({ data, error: queryError } = await client
        .from("notes")
        .select(NOTE_FIELDS.join(","))
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit));

      if (queryError) {
        ({ data, error: queryError } = await client
          .from("notes")
          .select(NOTE_FIELDS.join(","))
          .eq("user_id", user.id)
          .order("id", { ascending: false })
          .limit(limit));
      }

      if (queryError) {
        bus.emit("output:append", `Erro ao buscar notas: ${queryError.message}`);
        return;
      }

      if (!data || data.length === 0) {
        bus.emit("output:append", "Nenhuma nota encontrada.");
        return;
      }

      const prompt = buildSuggestLinksPrompt(data);
      const response = await callGemini(bus, prompt, apiKey);
      if (!response) return;
      response.split("\n").forEach((line) => bus.emit("output:append", line));
      return;
    }

    if (normalized === "ia summarize today") {
      const apiKey = ensureGeminiKey(bus);
      if (!apiKey) return;

      const { client, error } = getSupabaseClient();
      if (error || !client) {
        bus.emit(
          "output:append",
          "Supabase não configurado. Use auth --register ou auth para autenticar."
        );
        return;
      }

      const user = await getAuthenticatedUser(bus, client);
      if (!user) return;

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error: queryError } = await client
        .from("notes")
        .select(NOTE_FIELDS.join(","))
        .eq("user_id", user.id)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

      if (queryError) {
        bus.emit("output:append", `Erro ao buscar notas: ${queryError.message}`);
        return;
      }

      if (!data || data.length === 0) {
        bus.emit("output:append", "Nenhuma nota nas últimas 24h.");
        return;
      }

      const prompt = buildSummarizeTodayPrompt(data);
      const response = await callGemini(bus, prompt, apiKey);
      if (!response) return;
      response.split("\n").forEach((line) => bus.emit("output:append", line));
      return;
    }

    if (normalized.startsWith("ia title note")) {
      const apiKey = ensureGeminiKey(bus);
      if (!apiKey) return;

      const { client, error } = getSupabaseClient();
      if (error || !client) {
        bus.emit(
          "output:append",
          "Supabase não configurado. Use auth --register ou auth para autenticar."
        );
        return;
      }

      const user = await getAuthenticatedUser(bus, client);
      if (!user) return;

      const pairs = parseKeyValuePairs(trimmed);
      const noteId = pairs.id;
      if (!noteId) {
        bus.emit("output:append", 'Uso: IA title note id="uuid"');
        return;
      }

      const { data, error: queryError } = await client
        .from("notes")
        .select(NOTE_FIELDS.join(","))
        .eq("id", noteId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (queryError) {
        bus.emit("output:append", `Erro ao buscar nota: ${queryError.message}`);
        return;
      }
      if (!data) {
        bus.emit("output:append", "Nota não encontrada.");
        return;
      }

      const prompt = buildTitlePrompt(data);
      const response = await callGemini(bus, prompt, apiKey);
      if (!response) return;
      response.split("\n").forEach((line) => bus.emit("output:append", line));
      return;
    }

    bus.emit(
      "output:append",
      'Uso: IA | IA help | IA test | IA off | IA ask "<pergunta>" | IA pair brain | IA insight note id="uuid" | IA suggest links [LIMIT n] | IA summarize today | IA title note id="uuid"'
    );
  };

  function handleKeyCapture(value) {
    const key = value.trim();
    if (key.length < MIN_KEY_LENGTH) {
      bus.emit(
        "output:append",
        `Chave inválida. Use pelo menos ${MIN_KEY_LENGTH} caracteres.`
      );
      emitPrompt(bus, "Cole sua Gemini API Key:", {
        masked: true,
        placeholder: "gemini api key",
      });
      bus.emit("router:capture:start", {
        echo: "mask",
        handler: handleKeyCapture,
        onCancel: () => {
          finishCapture(bus);
          bus.emit("output:append", "IA: configuração cancelada.");
        },
      });
      return;
    }

    setGeminiKey(key);
    finishCapture(bus);
    bus.emit("output:append", "⚠️ A chave ficará salva no seu navegador (localStorage).");
    bus.emit("output:append", "OK: IA configurada. Use `IA help`.");
  }
}
