import { GEMINI_API_VERSION, GEMINI_MODEL } from "./geminiConfig.js";

const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}/models/${GEMINI_MODEL}:generateContent`;

function buildRequestBody(prompt) {
  return {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
  };
}

function normalizeErrorMessage(status, payload) {
  if (status === 401 || status === 403) {
    return "Chave inválida ou sem permissão.";
  }
  if (status === 429) {
    return "Limite de requisições atingido. Tente novamente mais tarde.";
  }
  const apiMessage = payload?.error?.message;
  if (apiMessage) {
    return apiMessage;
  }
  return `Erro ${status} ao contatar Gemini.`;
}

export async function requestGeminiText({ prompt, apiKey }) {
  if (!apiKey) {
    throw new Error("Chave Gemini ausente.");
  }

  let response = null;
  try {
    response = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildRequestBody(prompt)),
    });
  } catch (error) {
    throw new Error("Falha de rede ao contatar Gemini.");
  }

  let payload = null;
  if (!response.ok) {
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }
    throw new Error(normalizeErrorMessage(response.status, payload));
  }

  try {
    payload = await response.json();
  } catch (error) {
    throw new Error("Resposta inválida do Gemini.");
  }

  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Resposta vazia do Gemini.");
  }

  return String(text).trim();
}
