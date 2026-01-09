import { generateText } from "./geminiClient.js";

const NOTE_FIELDS = ["id", "subject", "moment", "body", "created_at"];

export const SEMINAR_LIMITS = {
  MIN_CONFIDENCE: 0.8,
  MAX_LINKS_TOTAL: 25,
  MAX_LINKS_PER_NOTE: 2,
  MIN_LAST_COUNT: 5,
  MAX_LAST_COUNT: 50,
  DEFAULT_LAST_COUNT: 20,
  MAX_NOTES_PER_SCOPE: 50,
};

const ALLOWED_TYPES = new Set(["related", "ref", "expands", "contradicts"]);

const JSON_FORMAT_SNIPPET = `{
  "links": [
    {
      "from_id": "uuid",
      "to_id": "uuid",
      "type": "related",
      "confidence": 0.86,
      "reason": "texto curto"
    }
  ]
}`;

function truncateBody(body, maxLength = 180) {
  if (!body) return "";
  const trimmed = body.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 3)}...`;
}

function normalizeSubject(subject) {
  if (!subject) return "";
  return subject.replace(/\s+/g, " ").trim().toLowerCase();
}

function buildNotesPayload(notes) {
  return notes.map((note) => ({
    id: note.id,
    subject: note.subject ?? "",
    moment: note.moment ?? "",
    body: truncateBody(note.body ?? "", 180),
  }));
}

function buildSeminarPrompt(notes) {
  const compact = JSON.stringify(buildNotesPayload(notes));
  return [
    "Você é um assistente de conexão de ideias.",
    "Sugira links SOMENTE quando houver relação clara.",
    "Não sugira tudo com tudo.",
    "Máximo de 25 links.",
    "Tipos permitidos: related | ref | expands | contradicts.",
    "Inclua confidence (0..1) e reason curto.",
    "Retorne APENAS JSON válido no formato abaixo, sem texto extra.",
    "",
    JSON_FORMAT_SNIPPET,
    "",
    "Notas:",
    compact,
  ].join("\n");
}

function buildSeminarRetryPrompt(notes) {
  const compact = JSON.stringify(buildNotesPayload(notes));
  return [
    "Retorne apenas JSON válido no formato abaixo. Nada além de JSON.",
    "",
    JSON_FORMAT_SNIPPET,
    "",
    "Notas:",
    compact,
  ].join("\n");
}

function parseLinksJson(raw) {
  try {
    const payload = JSON.parse(raw);
    if (!payload || !Array.isArray(payload.links)) {
      return { ok: false, error: "Formato JSON inválido." };
    }
    return { ok: true, payload };
  } catch (error) {
    return { ok: false, error: "JSON inválido." };
  }
}

export async function requestSuggestionsFromGemini(notes, apiKey) {
  const prompt = buildSeminarPrompt(notes);
  const firstRaw = await generateText(prompt, apiKey);
  const firstParsed = parseLinksJson(firstRaw);
  if (firstParsed.ok) {
    return firstParsed.payload.links ?? [];
  }

  const retryPrompt = buildSeminarRetryPrompt(notes);
  const retryRaw = await generateText(retryPrompt, apiKey);
  const retryParsed = parseLinksJson(retryRaw);
  if (!retryParsed.ok) {
    throw new Error("Resposta inválida do Gemini. JSON inválido.");
  }

  return retryParsed.payload.links ?? [];
}

export function validateAndNormalize(rawLinks) {
  if (!Array.isArray(rawLinks)) {
    return [];
  }

  return rawLinks
    .map((link) => {
      if (!link || typeof link !== "object") return null;
      const fromId = String(link.from_id ?? "").trim();
      const toId = String(link.to_id ?? "").trim();
      const type = String(link.type ?? "").trim();
      const confidence = Number(link.confidence);
      const reason = String(link.reason ?? "").trim();
      if (!fromId || !toId || !type) return null;
      return {
        fromId,
        toId,
        type,
        confidence: Number.isFinite(confidence) ? confidence : 0,
        reason,
      };
    })
    .filter(Boolean);
}

export function applySafetyFilters(suggestions, notes) {
  const notesById = new Map(notes.map((note) => [note.id, note]));
  const seen = new Set();
  const filtered = [];

  for (const suggestion of suggestions) {
    const fromNote = notesById.get(suggestion.fromId);
    const toNote = notesById.get(suggestion.toId);
    if (!fromNote || !toNote) continue;
    if (suggestion.fromId === suggestion.toId) continue;
    if (!ALLOWED_TYPES.has(suggestion.type)) continue;
    if (suggestion.confidence < SEMINAR_LIMITS.MIN_CONFIDENCE) continue;

    const fromSubject = normalizeSubject(fromNote.subject);
    const toSubject = normalizeSubject(toNote.subject);
    if (fromSubject && toSubject && fromSubject === toSubject) continue;

    const key = `${suggestion.fromId}|${suggestion.toId}|${suggestion.type}`;
    if (seen.has(key)) continue;
    seen.add(key);

    filtered.push({
      ...suggestion,
      fromSubject: fromNote.subject ?? "",
      toSubject: toNote.subject ?? "",
    });
  }

  return filtered;
}

export function enforceLimits(suggestions) {
  const noteCounts = new Map();
  const limited = [];

  for (const suggestion of suggestions) {
    if (limited.length >= SEMINAR_LIMITS.MAX_LINKS_TOTAL) break;

    const fromCount = noteCounts.get(suggestion.fromId) ?? 0;
    const toCount = noteCounts.get(suggestion.toId) ?? 0;
    if (
      fromCount >= SEMINAR_LIMITS.MAX_LINKS_PER_NOTE ||
      toCount >= SEMINAR_LIMITS.MAX_LINKS_PER_NOTE
    ) {
      continue;
    }

    noteCounts.set(suggestion.fromId, fromCount + 1);
    noteCounts.set(suggestion.toId, toCount + 1);
    limited.push(suggestion);
  }

  return limited;
}

export async function fetchNotes({ client, userId, scope }) {
  let query = client
    .from("notes")
    .select(NOTE_FIELDS.join(","))
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (scope.type === "today") {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    query = query.gte("created_at", since).limit(SEMINAR_LIMITS.MAX_NOTES_PER_SCOPE);
  } else if (scope.type === "week") {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte("created_at", since).limit(SEMINAR_LIMITS.MAX_NOTES_PER_SCOPE);
  } else if (scope.type === "last") {
    query = query.limit(scope.count);
  }

  let { data, error } = await query;
  if (error) {
    let fallback = client
      .from("notes")
      .select(NOTE_FIELDS.join(","))
      .eq("user_id", userId)
      .order("id", { ascending: false });

    if (scope.type === "today") {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      fallback = fallback.gte("created_at", since).limit(SEMINAR_LIMITS.MAX_NOTES_PER_SCOPE);
    } else if (scope.type === "week") {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      fallback = fallback.gte("created_at", since).limit(SEMINAR_LIMITS.MAX_NOTES_PER_SCOPE);
    } else if (scope.type === "last") {
      fallback = fallback.limit(scope.count);
    }

    ({ data, error } = await fallback);
  }

  if (error) {
    return { notes: null, error };
  }

  return { notes: data ?? [], error: null };
}
