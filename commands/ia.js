import { getSupabaseClient } from "../supabaseClient.js";
import { clearSession } from "../sessionStore.js";
import {
  clearGeminiKey,
  getGeminiKey,
  maskKey,
  setGeminiKey,
} from "../ai/aiConfig.js";
import { requestGeminiText } from "../ai/geminiClient.js";

const MIN_KEY_LENGTH = 20;
const MAX_OUTPUT_LENGTH = 1200;
const DEFAULT_SUGGEST_LIMIT = 10;
const MAX_SUGGEST_LIMIT = 20;
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
    const text = await requestGeminiText({ prompt, apiKey });
    return truncateOutput(text);
  } catch (error) {
    const message = error?.message ?? "Erro desconhecido.";
    bus.emit("output:append", `ERR: ${message}`);
    return null;
  }
}

export function iaCommand(bus) {
  return async ({ raw = "" } = {}) => {
    const trimmed = raw.trim();
    const normalized = trimmed.toLowerCase();

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

    if (normalized === "ia test") {
      const apiKey = ensureGeminiKey(bus);
      if (!apiKey) return;

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
      'Uso: IA | IA help | IA test | IA off | IA insight note id="uuid" | IA suggest links [LIMIT n] | IA summarize today | IA title note id="uuid"'
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
