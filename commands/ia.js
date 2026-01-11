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
import {
  SEMINAR_LIMITS,
  applySafetyFilters,
  enforceLimits,
  fetchNotes,
  requestSuggestionsFromGemini,
  validateAndNormalize,
} from "../ai/seminarEngine.js";
import {
  clearSeminarState,
  getSeminarState,
  setSeminarState,
} from "../ai/seminarState.js";
import { clearWeightState, getWeightState, setWeightState } from "../ai/weightState.js";
import {
  ensureRelationConfidenceColumn,
  ensureRelationWeightColumn,
} from "../schemaUtils.js";

const MIN_KEY_LENGTH = 20;
const MAX_OUTPUT_LENGTH = 1200;
const DEFAULT_SUGGEST_LIMIT = 10;
const MAX_SUGGEST_LIMIT = 20;
const PAIR_BRAIN_NOTE_LIMIT = 30;
const PAIR_BRAIN_MIN_COUNT = 1;
const PAIR_BRAIN_MAX_COUNT = 20;
const PAIR_BRAIN_DEFAULT_COUNT = 3;
const NOTE_FIELDS = ["id", "subject", "moment", "body", "created_at"];
const SEMINAR_ALLOWED_SELECTION = /^[0-9,\s]+$/;
const WEIGHT_SUGGEST_LIMIT = 20;

function mapConfidenceToWeight(confidence) {
  if (confidence >= 0.9) return 4;
  if (confidence >= 0.85) return 3;
  if (confidence >= 0.8) return 2;
  return null;
}

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

function buildPairBrainQuestionPrompt(note) {
  const body = (note.body ?? "").replace(/\s+/g, " ").trim();
  const shortBody = body.length > 360 ? `${body.slice(0, 357)}...` : body;
  return [
    "Você é um crítico construtivo, direto e respeitoso.",
    "Gere UMA pergunta específica sobre a nota.",
    "A pergunta deve apontar lacunas, contradições ou próximos passos.",
    "A resposta deve ter 1 parágrafo curto e terminar com '?'.",
    "",
    `Nota: ${note.subject ?? ""}`,
    `Momento: ${note.moment ?? ""}`,
    `Conteúdo: ${shortBody}`,
  ].join("\n");
}

function buildPairBrainRebuttalPrompt(note, question, answer) {
  const body = (note.body ?? "").replace(/\s+/g, " ").trim();
  const shortBody = body.length > 240 ? `${body.slice(0, 237)}...` : body;
  return [
    "Você é um crítico construtivo, direto e respeitoso.",
    "Retruca de forma incisiva, sem fazer nova pergunta.",
    "Máximo de 5 linhas. Seja curto e terminal-friendly.",
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
      if (entry.skipped) {
        base.push("Resposta: [skip]");
      }
      return base.join(" | ");
    })
    .join("\n");

  return [
    "Com base no diálogo abaixo, gere um fechamento curto.",
    'Comece com: "O que você deve fazer agora:"',
    "Use 1 a 3 bullets curtos.",
    "",
    items,
  ].join("\n");
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

function truncateBody(body, maxLength = 180) {
  if (!body) return "";
  const trimmed = body.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 3)}...`;
}


function buildWeightsPrompt(notes, relations) {
  const noteList = notes
    .map((note) => {
      const shortBody = truncateBody(note.body ?? "", 160);
      return `- id=${note.id} | subject=${note.subject ?? ""} | body=${shortBody}`;
    })
    .join("\n");
  const relList = relations
    .map((rel) => {
      const weight = rel.weight ?? 1;
      return `- from=${rel.from_note_id} | to=${rel.to_note_id} | type=${rel.type ?? "related"} | weight=${weight}`;
    })
    .join("\n");

  return [
    "Você é um assistente que ajusta o peso de relações.",
    "Sugira pesos 1..5 para relações existentes.",
    "Use reason curto em pt-BR.",
    "Responda apenas com JSON válido no formato:",
    `{\"weights\":[{\"from_id\":\"uuid\",\"to_id\":\"uuid\",\"type\":\"related\",\"weight\":3,\"reason\":\"texto curto\"}]}`,
    "",
    "Notas:",
    noteList,
    "",
    "Relações:",
    relList,
  ].join("\n");
}

function buildWeightsRetryPrompt(notes, relations) {
  const noteList = notes
    .map((note) => {
      const shortBody = truncateBody(note.body ?? "", 160);
      return `- id=${note.id} | subject=${note.subject ?? ""} | body=${shortBody}`;
    })
    .join("\n");
  const relList = relations
    .map((rel) => {
      const weight = rel.weight ?? 1;
      return `- from=${rel.from_note_id} | to=${rel.to_note_id} | type=${rel.type ?? "related"} | weight=${weight}`;
    })
    .join("\n");

  return [
    "Retorne apenas JSON válido no formato abaixo. Nada além de JSON.",
    `{\"weights\":[{\"from_id\":\"uuid\",\"to_id\":\"uuid\",\"type\":\"related\",\"weight\":3,\"reason\":\"texto curto\"}]}`,
    "",
    "Notas:",
    noteList,
    "",
    "Relações:",
    relList,
  ].join("\n");
}

function parseWeightsJson(raw) {
  try {
    const payload = JSON.parse(raw);
    if (!payload || !Array.isArray(payload.weights)) {
      return { ok: false, error: "Formato JSON inválido." };
    }
    return { ok: true, payload };
  } catch (error) {
    return { ok: false, error: "JSON inválido." };
  }
}

function normalizeWeightSuggestions(rawWeights, relations) {
  if (!Array.isArray(rawWeights)) return [];
  const relationKeys = new Set(
    relations.map((rel) => `${rel.from_note_id}|${rel.to_note_id}|${rel.type ?? "related"}`)
  );
  return rawWeights
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const fromId = String(item.from_id ?? "").trim();
      const toId = String(item.to_id ?? "").trim();
      const type = String(item.type ?? "related").trim();
      const weight = Number(item.weight);
      const reason = String(item.reason ?? "").trim();
      if (!fromId || !toId || !type) return null;
      const key = `${fromId}|${toId}|${type}`;
      if (!relationKeys.has(key)) return null;
      if (!Number.isFinite(weight)) return null;
      return {
        fromId,
        toId,
        type,
        weight: Math.min(Math.max(Math.round(weight), 1), 5),
        reason,
      };
    })
    .filter(Boolean)
    .slice(0, WEIGHT_SUGGEST_LIMIT);
}

function formatSeminarScope(scope) {
  if (!scope) return "n/a";
  if (scope.type === "today") return "today (24h)";
  if (scope.type === "week") return "week (7d)";
  if (scope.type === "last") return `last ${scope.count}`;
  return scope.type ?? "n/a";
}

function parseSeminarCommand(raw) {
  const match = raw.trim().match(/^ia\s+seminar(?:\s+(.+))?$/i);
  if (!match) return null;
  const args = (match[1] ?? "").trim();
  if (!args) {
    return {
      action: "preview",
      scope: { type: "last", count: SEMINAR_LIMITS.DEFAULT_LAST_COUNT },
    };
  }

  const normalized = args.toLowerCase();
  if (normalized === "status") {
    return { action: "status" };
  }
  if (normalized === "today") {
    return { action: "preview", scope: { type: "today" } };
  }
  if (normalized === "week") {
    return { action: "preview", scope: { type: "week" } };
  }
  if (normalized === "discard") {
    return { action: "discard" };
  }

  const lastMatch = normalized.match(/^last\s+(\d+)$/);
  if (lastMatch) {
    const count = Number.parseInt(lastMatch[1], 10);
    if (
      Number.isNaN(count) ||
      count < SEMINAR_LIMITS.MIN_LAST_COUNT ||
      count > SEMINAR_LIMITS.MAX_LAST_COUNT
    ) {
      return { error: "Uso: IA seminar last N (N entre 5 e 50)." };
    }
    return { action: "preview", scope: { type: "last", count } };
  }

  const applyMatch = normalized.match(/^apply\s+(.+)$/);
  if (applyMatch) {
    const selection = applyMatch[1].trim();
    if (selection === "all") {
      return { action: "apply", selection: "all" };
    }
    if (!SEMINAR_ALLOWED_SELECTION.test(selection)) {
      return { error: "Seleção inválida. Use: IA seminar apply all | 1,3,5" };
    }
    const indices = selection
      .split(",")
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value));
    if (!indices.length) {
      return { error: "Seleção inválida. Use: IA seminar apply all | 1,3,5" };
    }
    return { action: "apply", selection: indices };
  }

  return {
    error:
      "Uso: IA seminar | IA seminar last N | IA seminar today | IA seminar week | IA seminar status | IA seminar apply all | IA seminar apply 1,3 | IA seminar discard",
  };
}

function parseWeightsCommand(raw) {
  const match = raw.trim().match(/^ia\s+weights(?:\s+(.+))?$/i);
  if (!match) return null;
  const args = (match[1] ?? "").trim();
  if (!args || args === "today") {
    return { action: "preview", scope: { type: "today" } };
  }

  const normalized = args.toLowerCase();
  if (normalized === "discard") {
    return { action: "discard" };
  }

  const lastMatch = normalized.match(/^last\s+(\d+)$/);
  if (lastMatch) {
    const count = Number.parseInt(lastMatch[1], 10);
    if (
      Number.isNaN(count) ||
      count < SEMINAR_LIMITS.MIN_LAST_COUNT ||
      count > SEMINAR_LIMITS.MAX_LAST_COUNT
    ) {
      return { error: "Uso: IA weights last N (N entre 5 e 50)." };
    }
    return { action: "preview", scope: { type: "last", count } };
  }

  const applyMatch = normalized.match(/^apply\s+(.+)$/);
  if (applyMatch) {
    const selection = applyMatch[1].trim();
    if (selection === "all") {
      return { action: "apply", selection: "all" };
    }
    if (!SEMINAR_ALLOWED_SELECTION.test(selection)) {
      return { error: "Seleção inválida. Use: IA weights apply all | 1,3,5" };
    }
    const indices = selection
      .split(",")
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value));
    if (!indices.length) {
      return { error: "Seleção inválida. Use: IA weights apply all | 1,3,5" };
    }
    return { action: "apply", selection: indices };
  }

  return {
    error:
      "Uso: IA weights today | IA weights last N | IA weights apply all | IA weights apply 1,3 | IA weights discard",
  };
}

function formatSeminarSuggestion(suggestion, index) {
  const fromLabel = suggestion.fromSubject || suggestion.fromId;
  const toLabel = suggestion.toSubject || suggestion.toId;
  const confidence = suggestion.confidence.toFixed(2);
  return [
    `[${index + 1}] "${fromLabel}" -> "${toLabel}" (type=${suggestion.type}, conf=${confidence})`,
    `    reason: ${suggestion.reason || "sem razão"}`,
  ];
}

function parseSelection(selection, total) {
  if (selection === "all") {
    return Array.from({ length: total }, (_, index) => index + 1);
  }
  const unique = new Set();
  for (const value of selection) {
    if (!Number.isInteger(value) || value < 1 || value > total) {
      return null;
    }
    unique.add(value);
  }
  return [...unique];
}

async function ensureOwnedNotes(client, userId, noteIds) {
  const uniqueIds = [...new Set(noteIds.filter(Boolean))];
  if (!uniqueIds.length) {
    return { ok: false, missing: [] };
  }

  const { data, error } = await client
    .from("notes")
    .select("id")
    .in("id", uniqueIds)
    .eq("user_id", userId);

  if (error) {
    return { ok: false, missing: uniqueIds, error };
  }

  const foundIds = new Set((data ?? []).map((note) => note.id));
  const missing = uniqueIds.filter((id) => !foundIds.has(id));
  return { ok: missing.length === 0, missing };
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

function parsePairBrainArgs(raw) {
  const match = raw.trim().match(/^ia\s+pair\s+brain(?:\s+(.+))?$/i);
  if (!match) return null;
  const arg = (match[1] ?? "").trim();
  if (!arg) {
    return { mode: "fixed", targetCount: PAIR_BRAIN_DEFAULT_COUNT };
  }
  if (arg.toLowerCase() === "endless") {
    return { mode: "endless", targetCount: null };
  }
  if (/^\d+$/.test(arg)) {
    const parsed = Number.parseInt(arg, 10);
    const clamped = Math.min(
      PAIR_BRAIN_MAX_COUNT,
      Math.max(PAIR_BRAIN_MIN_COUNT, parsed)
    );
    return { mode: "fixed", targetCount: clamped };
  }
  return { error: "Uso: IA pair brain [N|endless]" };
}

function formatPairBrainProgress(session) {
  const current = session.currentIndex + 1;
  if (session.mode === "endless") {
    return `Pergunta ${current}/∞`;
  }
  const total = session.targetCount ?? 0;
  return `Nota ${current}/${total}`;
}

async function fetchPairBrainNotes(bus, client, userId) {
  let data = null;
  let queryError = null;
  ({ data, error: queryError } = await client
    .from("notes")
    .select(NOTE_FIELDS.join(","))
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAIR_BRAIN_NOTE_LIMIT));

  if (queryError) {
    ({ data, error: queryError } = await client
      .from("notes")
      .select(NOTE_FIELDS.join(","))
      .eq("user_id", userId)
      .order("id", { ascending: false })
      .limit(PAIR_BRAIN_NOTE_LIMIT));
  }

  if (queryError) {
    bus.emit("output:append", `Erro ao buscar notas: ${queryError.message}`);
    return null;
  }

  return (data ?? []).filter((note) => (note.body ?? "").trim());
}

async function generatePairBrainQuestion(bus, apiKey, note) {
  try {
    const question = await generateText(buildPairBrainQuestionPrompt(note), apiKey);
    return truncateOutput(question);
  } catch (error) {
    const message = error?.message ?? "Erro desconhecido.";
    bus.emit("output:append", `ERR: ${message}`);
    bus.emit("output:append", "ERR: IA indisponível, encerrando Pair Brain.");
    return null;
  }
}

async function generatePairBrainRebuttal(bus, apiKey, note, question, answer) {
  try {
    const rebuttal = await generateText(
      buildPairBrainRebuttalPrompt(note, question, answer),
      apiKey
    );
    return truncateOutput(rebuttal);
  } catch (error) {
    const message = error?.message ?? "Erro desconhecido.";
    bus.emit("output:append", `ERR: ${message}`);
    bus.emit("output:append", "ERR: IA indisponível, encerrando Pair Brain.");
    return null;
  }
}

async function generatePairBrainClosing(bus, apiKey, history) {
  try {
    const closing = await generateText(buildPairBrainClosingPrompt(history), apiKey);
    return truncateOutput(closing);
  } catch (error) {
    const message = error?.message ?? "Erro desconhecido.";
    bus.emit("output:append", `ERR: ${message}`);
    bus.emit("output:append", "ERR: IA indisponível, encerrando Pair Brain.");
    return null;
  }
}

async function pickNextEndlessNote(bus, client, userId) {
  const session = getPairBrainSession();
  let pool = session.pool;
  if (!pool.length || session.usedNoteIds.size >= pool.length) {
    const refreshed = await fetchPairBrainNotes(bus, client, userId);
    if (!refreshed || !refreshed.length) return null;
    session.pool = refreshed;
    session.usedNoteIds = new Set();
    pool = refreshed;
  }

  const lastId = session.lastNoteId;
  let candidate = pool.find(
    (note) => !session.usedNoteIds.has(note.id) && note.id !== lastId
  );

  if (!candidate) {
    const fallback = pool.find((note) => !session.usedNoteIds.has(note.id));
    if (fallback && fallback.id !== lastId) {
      candidate = fallback;
    }
  }

  if (!candidate) {
    const refreshed = await fetchPairBrainNotes(bus, client, userId);
    if (!refreshed || !refreshed.length) return null;
    session.pool = refreshed;
    session.usedNoteIds = new Set();
    candidate = refreshed.find((note) => note.id !== lastId) ?? null;
  }

  if (!candidate) return null;
  session.usedNoteIds.add(candidate.id);
  session.lastNoteId = candidate.id;
  return candidate;
}

async function showPairBrainQuestion(bus, apiKey, client, userId) {
  const session = getPairBrainSession();
  let note = null;

  if (session.mode === "fixed") {
    note = session.pool[session.currentIndex] ?? null;
  } else {
    note = await pickNextEndlessNote(bus, client, userId);
  }

  if (!note) {
    bus.emit(
      "output:append",
      "Sem notas com conteúdo suficiente para continuar o Pair Brain."
    );
    finishCapture(bus);
    clearPairBrainSession();
    return;
  }

  const question = await generatePairBrainQuestion(bus, apiKey, note);
  if (!question) {
    finishCapture(bus);
    clearPairBrainSession();
    return;
  }

  session.currentNote = note;
  session.currentQuestion = question;
  session.awaitingAnswer = true;

  const progress = formatPairBrainProgress(session);
  bus.emit("output:append", `${progress}: ${note.subject ?? ""}`);
  bus.emit("output:append", `Q${session.currentIndex + 1}: ${question}`);
  bus.emit("output:append", "Sua resposta:");
  bus.emit("input:placeholder", "digite sua resposta");
  bus.emit("input:unmask");
  bus.emit("router:capture:start", {
    echo: "normal",
    handler: (value) => handlePairBrainInput(bus, value, apiKey, client, userId),
    onCancel: () => {
      finishCapture(bus);
      clearPairBrainSession();
      bus.emit("output:append", "PAIR BRAIN cancelado.");
    },
  });
}

async function handlePairBrainInput(bus, value, apiKey, client, userId) {
  const session = getPairBrainSession();
  if (!session.active) {
    bus.emit("router:capture:stop");
    return;
  }

  const input = value.trim();
  const normalized = input.toLowerCase();

  if (normalized === "stop" || normalized === "cancel") {
    await finishPairBrain(bus, apiKey);
    return;
  }

  if (normalized === "status") {
    bus.emit("output:append", formatPairBrainProgress(session));
    return;
  }

  if (normalized === "skip") {
    recordPairBrainTurn({
      subject: session.currentNote?.subject ?? "",
      question: session.currentQuestion,
      answer: "",
      rebuttal: "",
      skipped: true,
    });
    session.awaitingAnswer = false;
    advancePairBrainIndex();
    if (session.mode === "fixed" && session.currentIndex >= session.targetCount) {
      await finishPairBrain(bus, apiKey);
      return;
    }
    await showPairBrainQuestion(bus, apiKey, client, userId);
    return;
  }

  if (!input) {
    bus.emit("output:append", "Resposta vazia. Tente novamente ou use cancel.");
    return;
  }

  if (!session.awaitingAnswer) {
    bus.emit("output:append", "Aguarde a próxima pergunta.");
    return;
  }

  session.awaitingAnswer = false;

  const note = session.currentNote;
  const question = session.currentQuestion;
  const rebuttal = await generatePairBrainRebuttal(bus, apiKey, note, question, input);
  if (!rebuttal) {
    finishCapture(bus);
    clearPairBrainSession();
    return;
  }

  rebuttal.split("\n").forEach((line) => bus.emit("output:append", line));
  recordPairBrainTurn({
    subject: note?.subject ?? "",
    question,
    answer: input,
    rebuttal,
  });

  advancePairBrainIndex();
  if (session.mode === "fixed" && session.currentIndex >= session.targetCount) {
    await finishPairBrain(bus, apiKey);
    return;
  }

  await showPairBrainQuestion(bus, apiKey, client, userId);
}

async function finishPairBrain(bus, apiKey) {
  const session = getPairBrainSession();
  const closing = await generatePairBrainClosing(bus, apiKey, session.history);
  if (closing) {
    closing.split("\n").forEach((line) => bus.emit("output:append", line));
  }
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
          "- IA pair brain [N|endless]: modo crítico guiado por notas",
          "- IA suggest links [LIMIT n]: sugere comandos LINK",
          "- IA summarize today: resume notas das últimas 24h",
          '- IA title note id="uuid": sugere 3 titles para a nota',
          "- IA seminar: sugere links em modo semiautomático (preview)",
          "- IA seminar last N | today | week | status | apply | discard",
          "- IA weights today | last N: sugere pesos (preview)",
          "- IA weights apply all | apply 1,3 | discard",
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

    if (normalized.startsWith("ia pair brain")) {
      const args = parsePairBrainArgs(trimmed);
      if (args?.error) {
        bus.emit("output:append", args.error);
        return;
      }

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

      const validNotes = await fetchPairBrainNotes(bus, client, user.id);
      if (!validNotes || !validNotes.length) {
        bus.emit("output:append", "Sem notas com conteúdo suficiente para Pair Brain.");
        return;
      }

      if (args.mode === "fixed") {
        const available = validNotes.length;
        let targetCount = args.targetCount ?? PAIR_BRAIN_DEFAULT_COUNT;
        if (available < targetCount) {
          bus.emit(
            "output:append",
            `Só encontrei ${available} notas com conteúdo; a sessão terá ${available} perguntas.`
          );
          targetCount = available;
        }

        startPairBrainSession({
          mode: "fixed",
          targetCount,
          pool: validNotes.slice(0, targetCount),
        });
        bus.emit(
          "output:append",
          `PAIR BRAIN iniciado: ${targetCount} perguntas.`
        );
      } else {
        startPairBrainSession({
          mode: "endless",
          targetCount: null,
          pool: validNotes,
        });
        bus.emit("output:append", "PAIR BRAIN iniciado: modo endless.");
      }

      await showPairBrainQuestion(bus, apiKey, client, user.id);
      return;
    }

    if (normalized.startsWith("ia ideas")) {
      bus.emit("output:append", "Comando removido.");
      return;
    }

    if (normalized.startsWith("ia weights")) {
      const parsed = parseWeightsCommand(trimmed);
      if (parsed?.error) {
        bus.emit("output:append", parsed.error);
        return;
      }

      if (parsed?.action === "discard") {
        const state = getWeightState();
        if (!state.suggestions?.length) {
          bus.emit("output:append", "IA weights: nenhum preview pendente.");
          return;
        }
        clearWeightState();
        bus.emit("output:append", "IA weights: preview descartado.");
        return;
      }

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

      if (parsed?.action === "apply") {
        const state = getWeightState();
        if (!state.suggestions?.length) {
          bus.emit("output:append", "IA weights: nenhum preview pendente.");
          return;
        }

        const hasWeightColumn = await ensureRelationWeightColumn({
          client,
          userId: user.id,
          bus,
        });
        if (!hasWeightColumn) {
          bus.emit("output:append", "Não foi possível aplicar pesos sem a coluna weight.");
          return;
        }

        const selection = parseSelection(parsed.selection, state.suggestions.length);
        if (!selection) {
          bus.emit("output:append", "Seleção inválida. Use: IA weights apply all | 1,3,5");
          return;
        }

        const pendingSelection = selection.filter(
          (index) => !state.appliedIds?.includes(index)
        );
        if (!pendingSelection.length) {
          bus.emit("output:append", "IA weights: itens selecionados já aplicados.");
          return;
        }

        let applied = [...(state.appliedIds ?? [])];
        let updated = 0;
        let skipped = 0;
        let failed = 0;

        for (const selectionIndex of pendingSelection) {
          const suggestion = state.suggestions[selectionIndex - 1];
          if (!suggestion) {
            skipped += 1;
            applied.push(selectionIndex);
            continue;
          }

          const { data, error: updateError } = await client
            .from("note_relations")
            .update({ weight: suggestion.weight })
            .eq("user_id", user.id)
            .eq("from_note_id", suggestion.fromId)
            .eq("to_note_id", suggestion.toId)
            .eq("type", suggestion.type)
            .select("from_note_id");

          if (updateError) {
            failed += 1;
            bus.emit(
              "output:append",
              `Erro ao aplicar peso [${selectionIndex}]: ${updateError.message}`
            );
            continue;
          }
          if (!data || data.length === 0) {
            skipped += 1;
            applied.push(selectionIndex);
            continue;
          }

          updated += 1;
          applied.push(selectionIndex);
        }

        setWeightState({ ...state, appliedIds: applied });
        bus.emit(
          "output:append",
          `IA weights — aplicado: ${updated}, ignorados: ${skipped}, erros: ${failed}.`
        );
        if (updated > 0) {
          bus.emit("graph:refresh");
        }
        return;
      }

      if (parsed?.action === "preview") {
        const apiKey = ensureGeminiKey(bus);
        if (!apiKey) return;

        const { notes, error: notesError } = await fetchNotes({
          client,
          userId: user.id,
          scope: parsed.scope,
        });

        if (notesError) {
          bus.emit("output:append", `Erro ao buscar notas: ${notesError.message}`);
          return;
        }

        if (!notes || notes.length === 0) {
          bus.emit("output:append", "IA weights: nenhuma nota encontrada.");
          return;
        }

        const noteIds = notes.map((note) => note.id);
        const ids = noteIds.join(",");
        const hasWeightColumn = await ensureRelationWeightColumn({
          client,
          userId: user.id,
          bus,
        });
        const relationFields = [
          "from_note_id",
          "to_note_id",
          "type",
          hasWeightColumn ? "weight" : null,
        ]
          .filter(Boolean)
          .join(",");

        const { data: relations, error: relError } = await client
          .from("note_relations")
          .select(relationFields)
          .eq("user_id", user.id)
          .or(`from_note_id.in.(${ids}),to_note_id.in.(${ids})`);

        if (relError) {
          bus.emit("output:append", `Erro ao buscar relações: ${relError.message}`);
          return;
        }

        if (!relations || relations.length === 0) {
          bus.emit("output:append", "IA weights: nenhuma relação encontrada.");
          return;
        }

        let rawWeights = [];
        try {
          const prompt = buildWeightsPrompt(notes, relations);
          const firstRaw = await generateText(prompt, apiKey);
          const parsedWeights = parseWeightsJson(firstRaw);
          if (parsedWeights.ok) {
            rawWeights = parsedWeights.payload.weights ?? [];
          } else {
            const retryPrompt = buildWeightsRetryPrompt(notes, relations);
            const retryRaw = await generateText(retryPrompt, apiKey);
            const retryParsed = parseWeightsJson(retryRaw);
            if (!retryParsed.ok) {
              throw new Error("Resposta inválida do Gemini. JSON inválido.");
            }
            rawWeights = retryParsed.payload.weights ?? [];
          }
        } catch (error) {
          bus.emit(
            "output:append",
            `ERR: ${error?.message ?? "Falha ao gerar pesos."}`
          );
          return;
        }

        const suggestions = normalizeWeightSuggestions(rawWeights, relations);

        setWeightState({
          lastGeneratedAt: new Date().toISOString(),
          scope: parsed.scope,
          noteCount: notes.length,
          suggestions,
          appliedIds: [],
        });

        if (!suggestions.length) {
          bus.emit("output:append", "IA weights: nenhuma sugestão encontrada.");
          return;
        }

        bus.emit("output:append", "IA weights — sugestões encontradas (preview):");
        suggestions.forEach((suggestion, index) => {
          bus.emit(
            "output:append",
            `[${index + 1}] ${suggestion.fromId} -> ${suggestion.toId} (type=${suggestion.type}, peso=${suggestion.weight})`
          );
          bus.emit("output:append", `    motivo: ${suggestion.reason || "sem motivo"}`);
        });
        bus.emit("output:append", "");
        bus.emit("output:append", "- `IA weights apply all`");
        bus.emit("output:append", "- `IA weights apply 1,2`");
        bus.emit("output:append", "- `IA weights discard`");
        return;
      }
    }

    if (normalized.startsWith("ia seminar")) {
      const parsed = parseSeminarCommand(trimmed);
      if (parsed?.error) {
        bus.emit("output:append", parsed.error);
        return;
      }

      if (parsed?.action === "status") {
        const state = getSeminarState();
        bus.emit("output:append", "Seminário — status:");
        bus.emit("output:append", `- Escopo: ${formatSeminarScope(state.scope)}`);
        bus.emit("output:append", `- Notas analisadas: ${state.noteCount ?? 0}`);
        bus.emit(
          "output:append",
          `- Preview pendente: ${state.suggestions?.length ? "sim" : "não"}`
        );
        if (state.lastGeneratedAt) {
          bus.emit("output:append", `- Gerado em: ${state.lastGeneratedAt}`);
        }
        if (state.appliedIds?.length) {
          bus.emit("output:append", `- Aplicados: ${state.appliedIds.length}`);
        }
        return;
      }

      if (parsed?.action === "discard") {
        const state = getSeminarState();
        if (!state.suggestions?.length) {
          bus.emit("output:append", "Seminário: nenhum preview pendente.");
          return;
        }
        clearSeminarState();
        bus.emit("output:append", "Seminário: preview descartado.");
        return;
      }

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

      if (parsed?.action === "apply") {
        const state = getSeminarState();
        if (!state.suggestions?.length) {
          bus.emit("output:append", "Seminário: nenhum preview pendente.");
          return;
        }

        const selection = parseSelection(parsed.selection, state.suggestions.length);
        if (!selection) {
          bus.emit(
            "output:append",
            "Seleção inválida. Use: IA seminar apply all | 1,3,5"
          );
          return;
        }

        const pendingSelection = selection.filter(
          (index) => !state.appliedIds?.includes(index)
        );

        if (!pendingSelection.length) {
          bus.emit("output:append", "Seminário: itens selecionados já aplicados.");
          return;
        }

        const pendingSuggestions = pendingSelection.map(
          (index) => state.suggestions[index - 1]
        );

        const noteIds = pendingSuggestions.flatMap((suggestion) => [
          suggestion.fromId,
          suggestion.toId,
        ]);

        const ownership = await ensureOwnedNotes(client, user.id, noteIds);
        if (ownership.error) {
          bus.emit(
            "output:append",
            `Erro ao validar notas: ${ownership.error.message}`
          );
          return;
        }

        const missingNoteIds = new Set(ownership.missing ?? []);
        const missingSelections = [];
        const actionableSuggestions = [];
        pendingSuggestions.forEach((suggestion, idx) => {
          const selectionIndex = pendingSelection[idx];
          if (
            missingNoteIds.has(suggestion.fromId) ||
            missingNoteIds.has(suggestion.toId)
          ) {
            missingSelections.push(selectionIndex);
          } else {
            actionableSuggestions.push({ ...suggestion, selectionIndex });
          }
        });

        if (missingSelections.length) {
          bus.emit(
            "output:append",
            `Aviso: ${missingSelections.length} sugestões ignoradas por nota ausente.`
          );
        }

        const hasWeightColumn = await ensureRelationWeightColumn({
          client,
          userId: user.id,
          bus,
        });
        const hasConfidenceColumn = await ensureRelationConfidenceColumn({
          client,
          userId: user.id,
          bus,
        });

        let inserted = 0;
        let skipped = 0;
        let failed = 0;
        const applied = [...(state.appliedIds ?? [])];

        for (const suggestion of actionableSuggestions) {
          const { selectionIndex, fromId, toId, type } = suggestion;
          const suggestedWeight = mapConfidenceToWeight(suggestion.confidence ?? 0);
          if (suggestedWeight === null) {
            skipped += 1;
            applied.push(selectionIndex);
            continue;
          }

          const existingFields = [
            "id",
            hasWeightColumn ? "weight" : null,
            hasConfidenceColumn ? "confidence" : null,
          ]
            .filter(Boolean)
            .join(",");
          const { data: existing, error: existingError } = await client
            .from("note_relations")
            .select(existingFields)
            .eq("from_note_id", fromId)
            .eq("to_note_id", toId)
            .eq("type", type)
            .eq("user_id", user.id)
            .limit(1)
            .maybeSingle();

          if (existingError) {
            failed += 1;
            bus.emit(
              "output:append",
              `Erro ao verificar relação [${selectionIndex}]: ${existingError.message}`
            );
            continue;
          }

          if (existing) {
            let updates = null;
            if (hasWeightColumn) {
              const currentWeight = Number(existing.weight ?? 1);
              const nextWeight = Math.max(currentWeight, suggestedWeight);
              if (nextWeight !== currentWeight) {
                updates = { ...(updates ?? {}), weight: nextWeight };
              }
            }
            if (hasConfidenceColumn) {
              updates = { ...(updates ?? {}), confidence: suggestion.confidence };
            }
            if (updates) {
              const { error: updateError } = await client
                .from("note_relations")
                .update(updates)
                .eq("id", existing.id)
                .eq("user_id", user.id);
              if (updateError) {
                failed += 1;
                bus.emit(
                  "output:append",
                  `Erro ao atualizar relação [${selectionIndex}]: ${updateError.message}`
                );
                continue;
              }
              inserted += 1;
              applied.push(selectionIndex);
              continue;
            }

            skipped += 1;
            applied.push(selectionIndex);
            continue;
          }

          const payload = {
            from_note_id: fromId,
            to_note_id: toId,
            type,
            user_id: user.id,
          };
          if (hasWeightColumn) {
            payload.weight = suggestedWeight;
          }
          if (hasConfidenceColumn) {
            payload.confidence = suggestion.confidence;
          }

          const { error: insertError } = await client.from("note_relations").insert(payload);

          if (insertError) {
            failed += 1;
            bus.emit(
              "output:append",
              `Erro ao aplicar relação [${selectionIndex}]: ${insertError.message}`
            );
            continue;
          }

          inserted += 1;
          applied.push(selectionIndex);
        }

        setSeminarState({
          ...state,
          appliedIds: applied,
        });

        bus.emit(
          "output:append",
          `Seminário — aplicado: ${inserted}, duplicados: ${skipped}, erros: ${failed}.`
        );
        if (inserted > 0) {
          bus.emit("graph:refresh");
        }
        return;
      }

      if (parsed?.action === "preview") {
        const apiKey = ensureGeminiKey(bus);
        if (!apiKey) return;

        const { notes, error: notesError } = await fetchNotes({
          client,
          userId: user.id,
          scope: parsed.scope,
        });

        if (notesError) {
          bus.emit(
            "output:append",
            `Erro ao buscar notas: ${notesError.message}`
          );
          return;
        }

        if (!notes || notes.length === 0) {
          bus.emit("output:append", "Seminário: nenhuma nota encontrada.");
          return;
        }

        let rawLinks = [];
        try {
          rawLinks = await requestSuggestionsFromGemini(notes, apiKey);
        } catch (error) {
          bus.emit(
            "output:append",
            `ERR: ${error?.message ?? "Falha ao gerar sugestões."}`
          );
          return;
        }

        const normalizedLinks = validateAndNormalize(rawLinks);
        const filtered = applySafetyFilters(normalizedLinks, notes);
        const limited = enforceLimits(filtered);

        setSeminarState({
          lastGeneratedAt: new Date().toISOString(),
          scope: parsed.scope,
          noteCount: notes.length,
          suggestions: limited,
          appliedIds: [],
        });

        if (!limited.length) {
          bus.emit("output:append", "Seminário — nenhuma sugestão encontrada.");
          return;
        }

        bus.emit("output:append", "Seminário — sugestões encontradas (preview):");
        limited
          .flatMap((suggestion, index) => formatSeminarSuggestion(suggestion, index))
          .forEach((line) => bus.emit("output:append", line));

        bus.emit("output:append", "");
        bus.emit("output:append", "- `IA seminar apply all`");
        bus.emit("output:append", "- `IA seminar apply 1,2`");
        bus.emit("output:append", "- `IA seminar discard`");
        return;
      }
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
      bus.emit("output:append", "Comando removido.");
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
      'Uso: IA | IA help | IA test | IA off | IA ask "<pergunta>" | IA pair brain [N|endless] | IA suggest links [LIMIT n] | IA summarize today | IA title note id="uuid" | IA seminar ... | IA weights ...'
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
