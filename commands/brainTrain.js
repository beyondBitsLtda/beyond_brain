import { getSupabaseClient } from "../supabaseClient.js";
import {
  MAX_BODY_LENGTH,
  getAuthenticatedUser,
  insertNote,
} from "../notesService.js";
import { getGeminiKey } from "../ai/aiConfig.js";
import { generateChallenge, evaluateAnswer } from "../ai/brainTrainEngine.js";
import {
  clearBrainTrainSession,
  getBrainTrainSession,
  setBrainTrainAnswer,
  setBrainTrainAttemptId,
  setBrainTrainFeedback,
  startBrainTrainSession,
} from "../brainTrain/brainTrainSession.js";

const MODES = new Set(["logic", "math", "puzzle", "programming", "daily"]);
const DIFFICULTIES = new Set(["easy", "normal", "hard"]);
const POINTS_BY_DIFFICULTY = {
  easy: 5,
  normal: 10,
  hard: 20,
};

function ensureGeminiKey(bus) {
  const key = getGeminiKey();
  if (!key) {
    bus.emit("output:append", "ERR: IA não configurada. Use IA para configurar.");
    return null;
  }
  return key;
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
    pairs[match[1].toLowerCase()] = match[2];
  }
  return pairs;
}

function resolveMode(value) {
  if (!value) return "daily";
  const normalized = value.trim().toLowerCase();
  if (!MODES.has(normalized)) {
    return null;
  }
  return normalized;
}

function resolveDifficulty(value) {
  if (!value) return "normal";
  const normalized = value.trim().toLowerCase();
  if (!DIFFICULTIES.has(normalized)) {
    return null;
  }
  return normalized;
}

function getTodayDateString() {
  return new Date().toISOString().split("T")[0];
}

function getWeekStartDateString() {
  const start = new Date();
  start.setDate(start.getDate() - 6);
  return start.toISOString().split("T")[0];
}

function formatHeader(mode, difficulty) {
  return `Brain Train — mode: ${mode} | difficulty: ${difficulty}`;
}

function normalizeExpected(expected) {
  if (!expected) return "";
  return expected.trim();
}

function buildNoteBody({ prompt, answer, feedback, expected }) {
  const lines = [
    "Pergunta:",
    prompt,
    "",
    "Sua resposta:",
    answer,
    "",
    "Feedback:",
    feedback,
  ];

  const cleanedExpected = normalizeExpected(expected);
  if (cleanedExpected) {
    lines.push("", "Resposta esperada:", cleanedExpected);
  }

  return lines.join("\n");
}

function trimBody(body) {
  if (body.length <= MAX_BODY_LENGTH) return { body, trimmed: false };
  if (MAX_BODY_LENGTH <= 3) {
    return { body: body.slice(0, MAX_BODY_LENGTH), trimmed: true };
  }
  const trimmed = body.slice(0, MAX_BODY_LENGTH - 3);
  return { body: `${trimmed}...`, trimmed: true };
}

async function saveBrainTrainAttempt({
  client,
  userId,
  mode,
  difficulty,
  prompt,
  userAnswer,
  isCorrect,
  points,
  aiFeedback,
  aiExpected,
}) {
  const payload = {
    user_id: userId,
    train_date: getTodayDateString(),
    mode,
    difficulty,
    prompt,
    user_answer: userAnswer,
    is_correct: isCorrect,
    points,
    ai_feedback: aiFeedback,
    ai_expected: aiExpected || null,
  };

  const { data, error } = await client
    .from("brain_train_attempts")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (error) {
    return { attemptId: null, error };
  }

  return { attemptId: data?.id ?? null, error: null };
}

async function updateAttemptNote({ client, userId, attemptId, noteId }) {
  if (!attemptId || !noteId) return { error: null };
  const { error } = await client
    .from("brain_train_attempts")
    .update({ note_id: noteId })
    .eq("id", attemptId)
    .eq("user_id", userId);

  return { error };
}

async function handleNoteSave(bus, value, client, userId) {
  const session = getBrainTrainSession();
  if (!session.active || !session.awaitingNote) {
    finishCapture(bus);
    return;
  }

  const input = value.trim().toLowerCase();
  finishCapture(bus);

  if (input !== "y" && input !== "yes") {
    clearBrainTrainSession();
    bus.emit("output:append", "Treino salvo apenas no histórico.");
    return;
  }

  const subject = `Brain Train: ${session.mode}`;
  const moment = "Daily Training";
  const bodyRaw = buildNoteBody({
    prompt: session.prompt,
    answer: session.userAnswer,
    feedback: session.aiFeedback,
    expected: session.aiExpected,
  });
  const { body, trimmed } = trimBody(bodyRaw);

  const { data, error } = await insertNote({
    client,
    userId,
    subject,
    moment,
    body,
  });

  if (error || !data?.id) {
    bus.emit("output:append", "Erro ao salvar nota do Brain Train.");
    clearBrainTrainSession();
    return;
  }

  if (trimmed) {
    bus.emit(
      "output:append",
      `Nota salva com body reduzido para ${MAX_BODY_LENGTH} caracteres.`
    );
  }

  const { error: updateError } = await updateAttemptNote({
    client,
    userId,
    attemptId: session.attemptId,
    noteId: data.id,
  });

  if (updateError) {
    bus.emit("output:append", "Nota salva, mas não foi possível vincular ao treino.");
  } else {
    bus.emit("output:append", `Nota criada: ${data.id}`);
    bus.emit("graph:refresh");
  }

  clearBrainTrainSession();
}

async function handleAnswerCapture(bus, value, client, userId, apiKey) {
  const session = getBrainTrainSession();
  if (!session.active || !session.awaitingAnswer) {
    finishCapture(bus);
    return;
  }

  const input = value.trim();
  const normalized = input.toLowerCase();

  if (normalized === "cancel" || normalized === "stop") {
    finishCapture(bus);
    clearBrainTrainSession();
    bus.emit("output:append", "Brain Train cancelado.");
    return;
  }

  if (!input) {
    bus.emit("output:append", "Resposta vazia. Tente novamente.");
    return;
  }

  finishCapture(bus);
  setBrainTrainAnswer(input);

  let evaluation = null;
  try {
    evaluation = await evaluateAnswer(session.prompt, input, apiKey);
  } catch (error) {
    console.error("Erro ao avaliar Brain Train:", error);
    bus.emit("output:append", "Erro ao avaliar resposta. Tente novamente mais tarde.");
    clearBrainTrainSession();
    return;
  }

  const isCorrect = Boolean(evaluation.isCorrect);
  const points = isCorrect ? POINTS_BY_DIFFICULTY[session.difficulty] : 0;
  const expected = normalizeExpected(evaluation.expectedAnswer);

  const resultLabel = isCorrect ? "CORRETO" : "INCORRETO";
  bus.emit("output:append", `Resultado: ${resultLabel}`);
  bus.emit("output:append", `Pontos ganhos: ${points}`);
  bus.emit("output:append", "");
  bus.emit("output:append", "Feedback:");
  bus.emit("output:append", evaluation.feedback);
  if (expected) {
    bus.emit("output:append", "");
    bus.emit("output:append", `Resposta esperada: ${expected}`);
  }

  const { attemptId, error } = await saveBrainTrainAttempt({
    client,
    userId,
    mode: session.mode,
    difficulty: session.difficulty,
    prompt: session.prompt,
    userAnswer: input,
    isCorrect,
    points,
    aiFeedback: evaluation.feedback,
    aiExpected: expected,
  });

  if (error || !attemptId) {
    console.error("Erro ao salvar Brain Train:", error);
    bus.emit("output:append", "Erro ao salvar treino. Tente novamente mais tarde.");
    clearBrainTrainSession();
    return;
  }

  setBrainTrainAttemptId(attemptId);
  setBrainTrainFeedback({ feedback: evaluation.feedback, expected });

  bus.emit("output:append", "");
  bus.emit("output:append", "Salvar este treino como nota? (y/n)");
  bus.emit("input:placeholder", "y/n");
  bus.emit("router:capture:start", {
    echo: "normal",
    handler: (noteValue) => handleNoteSave(bus, noteValue, client, userId),
    onCancel: () => {
      finishCapture(bus);
      clearBrainTrainSession();
      bus.emit("output:append", "Brain Train cancelado.");
    },
  });
}

async function startBrainTrain(bus, client, userId, apiKey, { mode, difficulty }) {
  let challenge = "";
  try {
    challenge = await generateChallenge(mode, difficulty, apiKey);
  } catch (error) {
    console.error("Erro ao gerar Brain Train:", error);
    bus.emit("output:append", "Erro ao gerar desafio. Tente novamente mais tarde.");
    return;
  }

  startBrainTrainSession({ mode, difficulty, prompt: challenge });

  bus.emit("output:append", formatHeader(mode, difficulty));
  bus.emit("output:append", "");
  bus.emit("output:append", "Desafio:");
  bus.emit("output:append", challenge);
  bus.emit("output:append", "");
  bus.emit("output:append", "Sua resposta:");
  bus.emit("input:placeholder", "digite sua resposta");
  bus.emit("input:unmask");
  bus.emit("router:capture:start", {
    echo: "normal",
    handler: (value) => handleAnswerCapture(bus, value, client, userId, apiKey),
    onCancel: () => {
      finishCapture(bus);
      clearBrainTrainSession();
      bus.emit("output:append", "Brain Train cancelado.");
    },
  });
}

async function showScore(bus, client, userId, scope) {
  let query = client
    .from("brain_train_attempts")
    .select("points")
    .eq("user_id", userId);

  if (scope === "today") {
    query = query.eq("train_date", getTodayDateString());
  } else {
    query = query.gte("train_date", getWeekStartDateString());
  }

  const { data, error } = await query;
  if (error) {
    bus.emit("output:append", "Erro ao carregar score.");
    return;
  }

  const total = (data ?? []).reduce((sum, row) => sum + (row.points ?? 0), 0);
  const count = data?.length ?? 0;
  const label = scope === "today" ? "hoje" : "semana";
  bus.emit(
    "output:append",
    `Score ${label}: ${total} pontos (${count} treino${count === 1 ? "" : "s"}).`
  );
}

function formatHistoryLine(entry) {
  const status = entry.is_correct ? "CORRETO" : "INCORRETO";
  return `${entry.train_date} | ${entry.mode}/${entry.difficulty} | ${status} | ${entry.points} pts`;
}

async function showHistory(bus, client, userId, limit) {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const { data, error } = await client
    .from("brain_train_attempts")
    .select("train_date,mode,difficulty,is_correct,points,id")
    .eq("user_id", userId)
    .order("train_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(safeLimit);

  if (error) {
    bus.emit("output:append", "Erro ao carregar histórico.");
    return;
  }

  if (!data || data.length === 0) {
    bus.emit("output:append", "Nenhum treino encontrado.");
    return;
  }

  bus.emit("output:append", `Últimos ${data.length} treinos:`);
  data.forEach((entry) => {
    bus.emit("output:append", formatHistoryLine(entry));
  });
}

function parseBrainTrainCommand(raw) {
  const trimmed = raw.trim();
  const normalized = trimmed.toUpperCase();
  if (!normalized.startsWith("BRAIN TRAIN")) {
    return { error: "Uso: BRAIN TRAIN" };
  }

  if (normalized === "BRAIN TRAIN HELP") {
    return { action: "help" };
  }

  if (normalized.startsWith("BRAIN TRAIN SCORE")) {
    const match = trimmed.match(/score\s+(today|week)/i);
    if (!match) {
      return { error: "Uso: BRAIN TRAIN score today|week" };
    }
    return { action: "score", scope: match[1].toLowerCase() };
  }

  if (normalized.startsWith("BRAIN TRAIN HISTORY")) {
    const match = trimmed.match(/history\s+last\s+(\d+)/i);
    if (!match) {
      return { error: "Uso: BRAIN TRAIN history last N" };
    }
    const limit = Number.parseInt(match[1], 10);
    if (Number.isNaN(limit)) {
      return { error: "Uso: BRAIN TRAIN history last N" };
    }
    return { action: "history", limit };
  }

  const pairs = parseKeyValuePairs(trimmed);
  const mode = resolveMode(pairs.mode);
  if (pairs.mode && !mode) {
    return { error: "Modo inválido. Use logic|math|puzzle|programming|daily." };
  }

  const difficulty = resolveDifficulty(pairs.difficulty);
  if (pairs.difficulty && !difficulty) {
    return { error: "Dificuldade inválida. Use easy|normal|hard." };
  }

  return {
    action: "train",
    mode: mode ?? "daily",
    difficulty: difficulty ?? "normal",
  };
}

export function brainTrainCommand(bus) {
  return async ({ raw = "" } = {}) => {
    const session = getBrainTrainSession();
    if (session.active) {
      bus.emit("output:append", "Brain Train já está em andamento.");
      return;
    }

    const parsed = parseBrainTrainCommand(raw);
    if (parsed.error) {
      bus.emit("output:append", parsed.error);
      return;
    }

    if (parsed.action === "help") {
      bus.emit(
        "output:append",
        [
          "BRAIN TRAIN: inicia um treino cognitivo diário.",
          "Opções:",
          '- BRAIN TRAIN mode=\"logic|math|puzzle|programming|daily\"',
          '- BRAIN TRAIN mode=\"logic\" difficulty=\"easy|normal|hard\"',
          "- BRAIN TRAIN score today|week",
          "- BRAIN TRAIN history last N",
        ].join("\\n")
      );
      return;
    }

    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(bus, client);
    if (!user) return;

    if (parsed.action === "score") {
      await showScore(bus, client, user.id, parsed.scope);
      return;
    }

    if (parsed.action === "history") {
      await showHistory(bus, client, user.id, parsed.limit);
      return;
    }

    const apiKey = ensureGeminiKey(bus);
    if (!apiKey) return;

    await startBrainTrain(bus, client, user.id, apiKey, {
      mode: parsed.mode,
      difficulty: parsed.difficulty,
    });
  };
}
