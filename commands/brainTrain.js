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
  recordBrainTrainResult,
  setBrainTrainState,
  setBrainTrainCategory,
  setBrainTrainAnswer,
  setBrainTrainAttemptId,
  setBrainTrainFeedback,
  setBrainTrainContext,
  setBrainTrainLanguage,
  startNextBrainTrainRound,
  startProgrammingSetup,
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

function exitEditorIfProgramming(bus, session) {
  if (session.mode === "programming") {
    bus.emit("editor:close");
  }
}

function normalizeDecisionValue(value) {
  if (!value) return "";
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parseYesNo(value) {
  if (isCancelInput(value)) return "cancel";
  const normalized = normalizeDecisionValue(value);
  if (["y", "s", "sim"].includes(normalized)) return "yes";
  if (["n", "nao"].includes(normalized)) return "no";
  return "invalid";
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

function buildAttemptPayload({
  userId,
  mode,
  difficulty,
  prompt,
  userAnswer,
  isCorrect,
  points,
  aiFeedback,
  aiExpected,
  language,
  category,
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

  if (language) {
    payload.language = language;
  }

  if (category) {
    payload.category = category;
  }

  return payload;
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
  language,
  category,
}) {
  const payload = buildAttemptPayload({
    userId,
    mode,
    difficulty,
    prompt,
    userAnswer,
    isCorrect,
    points,
    aiFeedback,
    aiExpected,
    language,
    category,
  });

  const attemptInsert = async (insertPayload) =>
    client
      .from("brain_train_attempts")
      .insert(insertPayload)
      .select("id")
      .maybeSingle();

  let { data, error } = await attemptInsert(payload);
  if (error && (payload.language || payload.category)) {
    const message = String(error.message ?? "").toLowerCase();
    const missingColumn =
      message.includes("column") && (message.includes("language") || message.includes("category"));
    if (missingColumn) {
      const fallbackPayload = buildAttemptPayload({
        userId,
        mode,
        difficulty,
        prompt,
        userAnswer,
        isCorrect,
        points,
        aiFeedback,
        aiExpected,
      });
      ({ data, error } = await attemptInsert(fallbackPayload));
    }
  }

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
  if (!session.active || session.state !== "await_save_decision") {
    return;
  }

  const decision = parseYesNo(value);
  if (decision === "cancel") {
    finishCapture(bus);
    exitEditorIfProgramming(bus, session);
    clearBrainTrainSession();
    bus.emit("output:append", "Brain Train cancelado.");
    return;
  }

  if (decision === "invalid") {
    bus.emit("output:append", "Digite y/n.");
    return;
  }

  if (decision === "no") {
    finishCapture(bus);
    bus.emit("output:append", "Treino salvo apenas no histórico.");
    setBrainTrainState("await_continue_decision");
    bus.emit("output:append", "Quer continuar treinando? (y/n)");
    bus.emit("input:placeholder", "y/n");
    bus.emit("router:capture:start", {
      echo: "normal",
      handler: (continueValue) =>
        handleContinueDecision(bus, continueValue, client, userId),
      onCancel: () => {
        finishCapture(bus);
        exitEditorIfProgramming(bus, session);
        clearBrainTrainSession();
        bus.emit("output:append", "Brain Train cancelado.");
      },
    });
    return;
  }

  finishCapture(bus);

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
  } else {
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
  }

  setBrainTrainState("await_continue_decision");
  bus.emit("output:append", "Quer continuar treinando? (y/n)");
  bus.emit("input:placeholder", "y/n");
  bus.emit("router:capture:start", {
    echo: "normal",
    handler: (continueValue) =>
      handleContinueDecision(bus, continueValue, client, userId),
    onCancel: () => {
      finishCapture(bus);
      exitEditorIfProgramming(bus, session);
      clearBrainTrainSession();
      bus.emit("output:append", "Brain Train cancelado.");
    },
  });
}

async function handleContinueDecision(bus, value, client, userId) {
  const session = getBrainTrainSession();
  if (!session.active || session.state !== "await_continue_decision") {
    return;
  }

  const decision = parseYesNo(value);
  if (decision === "cancel") {
    finishCapture(bus);
    exitEditorIfProgramming(bus, session);
    clearBrainTrainSession();
    bus.emit("output:append", "Brain Train cancelado.");
    return;
  }

  if (decision === "invalid") {
    bus.emit("output:append", "Digite y/n.");
    return;
  }

  if (decision === "no") {
    finishCapture(bus);
    exitEditorIfProgramming(bus, session);
    bus.emit(
      "output:append",
      `Treino encerrado. Perguntas: ${session.totalQuestions} | Acertos: ${session.totalCorrect} | Pontos: ${session.totalPoints}`
    );
    clearBrainTrainSession();
    return;
  }

  finishCapture(bus);
  const apiKey = ensureGeminiKey(bus);
  if (!apiKey) {
    exitEditorIfProgramming(bus, session);
    clearBrainTrainSession();
    return;
  }
  await startBrainTrain(bus, client, userId, apiKey, {
    mode: session.mode,
    difficulty: session.difficulty,
    language: session.language,
    category: session.category,
    continueSession: true,
  });
}

async function handleAnswerCapture(bus, value, client, userId, apiKey) {
  const session = getBrainTrainSession();
  if (!session.active || session.state !== "await_answer") {
    exitEditorIfProgramming(bus, session);
    return;
  }

  const input = value.trim();
  const normalized = input.toLowerCase();

  if (normalized === "cancel" || normalized === "stop") {
    finishCapture(bus);
    exitEditorIfProgramming(bus, session);
    clearBrainTrainSession();
    bus.emit("output:append", "Brain Train cancelado.");
    return;
  }

  if (!input) {
    bus.emit("output:append", "Resposta vazia. Tente novamente.");
    return;
  }

  finishCapture(bus);
  exitEditorIfProgramming(bus, session);
  setBrainTrainAnswer(input);

  let evaluation = null;
  try {
    evaluation = await evaluateAnswer(session.prompt, input, apiKey, {
      language: session.language,
      category: session.category,
    });
  } catch (error) {
    console.error("Erro ao avaliar Brain Train:", error);
    bus.emit("output:append", "Erro ao avaliar resposta. Tente novamente mais tarde.");
    clearBrainTrainSession();
    return;
  }

  const isCorrect = Boolean(evaluation.isCorrect);
  const points = isCorrect ? POINTS_BY_DIFFICULTY[session.difficulty] : 0;
  const expected = normalizeExpected(evaluation.expectedAnswer);
  recordBrainTrainResult({ isCorrect, points });

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
    language: session.language,
    category: session.category,
  });

  if (error || !attemptId) {
    console.error("Erro ao salvar Brain Train:", error);
    bus.emit("output:append", "Erro ao salvar treino. Tente novamente mais tarde.");
    clearBrainTrainSession();
    return;
  }

  setBrainTrainAttemptId(attemptId);
  setBrainTrainFeedback({ feedback: evaluation.feedback, expected });
  setBrainTrainState("await_save_decision");

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

async function startBrainTrain(
  bus,
  client,
  userId,
  apiKey,
  { mode, difficulty, language, category, continueSession = false }
) {
  let challenge = "";
  try {
    challenge = await generateChallenge(mode, difficulty, apiKey, { language, category });
  } catch (error) {
    console.error("Erro ao gerar Brain Train:", error);
    bus.emit("output:append", "Erro ao gerar desafio. Tente novamente mais tarde.");
    return;
  }

  if (continueSession) {
    startNextBrainTrainRound({ prompt: challenge });
  } else {
    startBrainTrainSession({ mode, difficulty, prompt: challenge });
  }
  setBrainTrainContext({ language, category });

  bus.emit("output:append", formatHeader(mode, difficulty));
  bus.emit("output:append", "");
  bus.emit("output:append", "Desafio:");
  bus.emit("output:append", challenge);
  bus.emit("output:append", "");
  bus.emit("output:append", "Sua resposta:");
  bus.emit("input:placeholder", "digite sua resposta");
  bus.emit("input:unmask");
  bus.emit("router:capture:start", {
    echo: mode === "programming" ? "none" : "normal",
    handler: (value) => handleAnswerCapture(bus, value, client, userId, apiKey),
    onCancel: () => {
      finishCapture(bus);
      if (mode === "programming") {
        bus.emit("editor:close");
      }
      clearBrainTrainSession();
      bus.emit("output:append", "Brain Train cancelado.");
    },
  });

  if (mode === "programming") {
    bus.emit("editor:open", {
      language,
      tabSize: 2,
      onSubmit: (code) => bus.emit("command:submit", { raw: code }),
      onCancel: () => bus.emit("input:escape"),
    });
  }
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

function isCancelInput(value) {
  const normalized = value.trim().toLowerCase();
  return normalized === "cancel" || normalized === "stop";
}

async function handleProgrammingCategoryCapture(
  bus,
  value,
  client,
  userId,
  apiKey
) {
  const session = getBrainTrainSession();
  if (!session.active || !session.awaitingCategory) {
    finishCapture(bus);
    return;
  }

  if (isCancelInput(value)) {
    finishCapture(bus);
    clearBrainTrainSession();
    bus.emit("output:append", "Brain Train cancelado.");
    return;
  }

  const input = value.trim();
  const category = input ? input : "geral";
  setBrainTrainCategory(category);
  finishCapture(bus);

  await startBrainTrain(bus, client, userId, apiKey, {
    mode: "programming",
    difficulty: session.difficulty,
    language: session.language,
    category,
  });
}

function handleProgrammingLanguageCapture(bus, value, client, userId, apiKey) {
  const session = getBrainTrainSession();
  if (!session.active || !session.awaitingLanguage) {
    finishCapture(bus);
    return;
  }

  if (isCancelInput(value)) {
    finishCapture(bus);
    clearBrainTrainSession();
    bus.emit("output:append", "Brain Train cancelado.");
    return;
  }

  const input = value.trim();
  if (!input) {
    bus.emit("output:append", "Linguagem vazia. Informe uma linguagem ou use cancel.");
    return;
  }

  setBrainTrainLanguage(input);
  finishCapture(bus);

  bus.emit(
    "output:append",
    "Quer focar em alguma categoria? (ex: algoritmos, estruturas de dados, bugs, SQL, front-end, back-end, testes, arquitetura)."
  );
  bus.emit("output:append", "Se não, digite ENTER ou 'geral'.");
  bus.emit("input:placeholder", "categoria ou geral");
  bus.emit("router:capture:start", {
    echo: "normal",
    handler: (categoryValue) =>
      handleProgrammingCategoryCapture(bus, categoryValue, client, userId, apiKey),
    onCancel: () => {
      finishCapture(bus);
      clearBrainTrainSession();
      bus.emit("output:append", "Brain Train cancelado.");
    },
  });
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

    if (parsed.mode === "programming") {
      startProgrammingSetup({ mode: parsed.mode, difficulty: parsed.difficulty });
      bus.emit(
        "output:append",
        "Qual linguagem? (ex: JavaScript, Python, Java, C#, etc.)"
      );
      bus.emit("input:placeholder", "linguagem");
      bus.emit("router:capture:start", {
        echo: "normal",
        handler: (languageValue) =>
          handleProgrammingLanguageCapture(bus, languageValue, client, user.id, apiKey),
        onCancel: () => {
          finishCapture(bus);
          clearBrainTrainSession();
          bus.emit("output:append", "Brain Train cancelado.");
        },
      });
      return;
    }

    await startBrainTrain(bus, client, user.id, apiKey, {
      mode: parsed.mode,
      difficulty: parsed.difficulty,
    });
  };
}
