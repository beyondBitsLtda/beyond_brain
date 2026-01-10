import { generateBrainTrainText } from "./geminiClient.js";

const MODE_LABELS = {
  logic: "raciocínio lógico",
  math: "matemática mental",
  puzzle: "quebra-cabeças conceituais",
  programming: "programação (lógica e pensamento computacional)",
  daily: "modo misto",
};

function buildChallengePrompt(mode, difficulty, language, category) {
  const description = MODE_LABELS[mode] ?? MODE_LABELS.daily;
  const languageLine = language ? `Linguagem: ${language}.` : null;
  const categoryLine = category ? `Categoria: ${category}.` : null;
  return [
    "Você é um treinador cognitivo diário.",
    "Gere UM único desafio claro e curto.",
    `Modo: ${description}.`,
    `Dificuldade: ${difficulty}.`,
    languageLine,
    categoryLine,
    mode === "programming"
      ? "Crie um desafio de programação em pt-BR."
      : "Crie um desafio em pt-BR.",
    "Não inclua a resposta no desafio.",
    "Evite enunciados muito longos.",
    "Responda apenas com o texto do desafio.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildEvaluationPrompt(prompt, userAnswer, language, category) {
  const languageLine = language ? `Linguagem: ${language}.` : null;
  const categoryLine = category ? `Categoria: ${category}.` : null;
  return [
    "Você é um avaliador de desafios cognitivos.",
    "Avalie em pt-BR.",
    "Avalie a resposta do usuário e retorne JSON estrito no formato:",
    "{\n  \"is_correct\": true,\n  \"expected_answer\": \"...\",\n  \"feedback\": \"...\"\n}",
    "Feedback curto e direto.",
    "Se não houver resposta esperada específica, use expected_answer como string vazia.",
    "Não inclua nenhum texto fora do JSON.",
    "",
    languageLine,
    categoryLine,
    "",
    "Desafio:",
    prompt,
    "",
    "Resposta do usuário:",
    userAnswer,
  ].join("\n");
}

function extractJsonPayload(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return null;
}

function normalizeEvaluation(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("JSON inválido.");
  }

  const isCorrect = Boolean(payload.is_correct);
  const expected = typeof payload.expected_answer === "string" ? payload.expected_answer : "";
  const feedback = typeof payload.feedback === "string" ? payload.feedback : "";

  if (!feedback) {
    throw new Error("Feedback ausente.");
  }

  return {
    isCorrect,
    expectedAnswer: expected,
    feedback,
  };
}

export async function generateChallenge(mode, difficulty, apiKey, { language, category } = {}) {
  const prompt = buildChallengePrompt(mode, difficulty, language, category);
  const response = await generateBrainTrainText(prompt, apiKey);
  const challenge = response.trim();
  if (!challenge) {
    throw new Error("Resposta vazia da IA.");
  }
  return challenge;
}

export async function evaluateAnswer(prompt, userAnswer, apiKey, { language, category } = {}) {
  const evaluationPrompt = buildEvaluationPrompt(prompt, userAnswer, language, category);
  const response = await generateBrainTrainText(evaluationPrompt, apiKey);
  const jsonPayload = extractJsonPayload(response);
  if (!jsonPayload) {
    throw new Error("JSON inválido.");
  }

  let parsed = null;
  try {
    parsed = JSON.parse(jsonPayload);
  } catch (error) {
    throw new Error("JSON inválido.");
  }

  return normalizeEvaluation(parsed);
}
