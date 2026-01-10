import { generateText } from "./geminiClient.js";

const MODE_LABELS = {
  logic: "raciocínio lógico",
  math: "matemática mental",
  puzzle: "quebra-cabeças conceituais",
  programming: "lógica e pensamento computacional",
  daily: "modo misto",
};

function buildChallengePrompt(mode, difficulty) {
  const description = MODE_LABELS[mode] ?? MODE_LABELS.daily;
  return [
    "Você é um treinador cognitivo diário.",
    "Gere UM único desafio claro e curto.",
    `Modo: ${mode} (${description}).`,
    `Dificuldade: ${difficulty}.`,
    "Não inclua a resposta e não use múltiplas perguntas.",
    "Responda apenas com o texto do desafio.",
  ].join("\n");
}

function buildEvaluationPrompt(prompt, userAnswer) {
  return [
    "Você é um avaliador de desafios cognitivos.",
    "Avalie a resposta do usuário e retorne JSON estrito no formato:",
    "{\n  \"is_correct\": true,\n  \"expected_answer\": \"...\",\n  \"feedback\": \"...\"\n}",
    "Feedback curto e direto.",
    "Se não houver resposta esperada específica, use expected_answer como string vazia.",
    "Não inclua nenhum texto fora do JSON.",
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

export async function generateChallenge(mode, difficulty, apiKey) {
  const prompt = buildChallengePrompt(mode, difficulty);
  const response = await generateText(prompt, apiKey);
  const challenge = response.trim();
  if (!challenge) {
    throw new Error("Resposta vazia da IA.");
  }
  return challenge;
}

export async function evaluateAnswer(prompt, userAnswer, apiKey) {
  const evaluationPrompt = buildEvaluationPrompt(prompt, userAnswer);
  const response = await generateText(evaluationPrompt, apiKey);
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
