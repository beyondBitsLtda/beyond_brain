import { getSupabaseClient } from "../supabaseClient.js";
import { getAuthenticatedUser } from "../notesService.js";
import { getByIndex } from "../state/selectionRegistry.js";
import { ensureNoteIdeaColumns, getNoteIdeaColumnAvailability } from "../schemaUtils.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SELECTION_REGEX = /^#(\d+)$/;
const DEBUG_GRAPH = true;

function debugLog(...args) {
  if (!DEBUG_GRAPH) return;
  console.log("[level]", ...args);
}

function reportUpdatePermissionError(bus, error) {
  if (!error) return false;
  if (error.status === 401 || error.status === 403 || error.code === "42501") {
    bus.emit("output:append", "Sem permissão para atualizar notes (UPDATE policy). Verifique RLS.");
    return true;
  }
  return false;
}

async function fetchNoteIdeaState({ client, user, noteId }) {
  const { hasLevelSet } = getNoteIdeaColumnAvailability();
  const selectFields = [
    "id",
    "subject",
    "is_idea",
    "idea_level",
    hasLevelSet ? "level_set" : null,
  ]
    .filter(Boolean)
    .join(",");
  const { data, error } = await client
    .from("notes")
    .select(selectFields)
    .eq("id", noteId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    debugLog("fetchNoteIdeaState error", error);
    return null;
  }
  debugLog("fetchNoteIdeaState data", data);
  return data;
}

function parseKeyValuePairs(raw) {
  const pairs = {};
  const regex = /(\w+)=("[^"]*"|[^\s"]+)/g;
  let match = null;
  while ((match = regex.exec(raw)) !== null) {
    const value = match[2].replace(/^"|"$/g, "").trim();
    pairs[match[1].toLowerCase()] = value;
  }
  return pairs;
}

function parseSelectionIndex(value) {
  const match = SELECTION_REGEX.exec(value.trim());
  if (!match) return null;
  const selectionIndex = Number(match[1]);
  if (Number.isNaN(selectionIndex)) return null;
  return selectionIndex;
}

function resolveNoteId(bus, raw) {
  const pairs = parseKeyValuePairs(raw);
  if (pairs.id) {
    return pairs.id;
  }

  const selectionMatch = raw.match(SELECTION_REGEX);
  if (selectionMatch) {
    const selectionIndex = parseSelectionIndex(selectionMatch[0]);
    const selected = getByIndex(selectionIndex);
    if (!selected?.id) {
      bus.emit("output:append", "Seleção inválida. Rode SELECT NOTE primeiro.");
      return null;
    }
    return selected.id;
  }

  const trimmed = raw.trim();
  if (UUID_REGEX.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export function levelCommand(bus) {
  return async ({ raw = "" } = {}) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    const match = trimmed.match(/^level\s+off\b/i);
    if (!match) {
      bus.emit("output:append", "Uso: LEVEL off \"#N\" | LEVEL off id=\"uuid\"");
      return;
    }

    const payload = trimmed.replace(/^level\s+off\s*/i, "");
    const noteId = resolveNoteId(bus, payload);
    if (!noteId) {
      bus.emit("output:append", "Uso: LEVEL off \"#N\" | LEVEL off id=\"uuid\"");
      return;
    }

    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(bus, client);
    if (!user) return;

    const hasIdeaColumns = await ensureNoteIdeaColumns({ client, userId: user.id, bus });
    if (!hasIdeaColumns) {
      bus.emit("output:append", "Não foi possível remover nível sem as colunas de ideia.");
      return;
    }
    const { hasLevelSet } = getNoteIdeaColumnAvailability();
    if (!hasLevelSet) {
      bus.emit("output:append", "Não foi possível remover nível sem a coluna level_set.");
      return;
    }

    const { data, error: updateError } = await client
      .from("notes")
      .update({ level_set: false })
      .eq("id", noteId)
      .eq("user_id", user.id)
      .select("id,is_idea,idea_level,level_set,subject");

    if (updateError) {
      if (reportUpdatePermissionError(bus, updateError)) return;
      bus.emit("output:append", `Erro ao remover nível: ${updateError.message}`);
      return;
    }

    if (!data || data.length === 0) {
      bus.emit("output:append", "Nenhuma nota encontrada para atualizar.");
      return;
    }

    debugLog("levelCommand response", data[0]);
    bus.emit("output:append", "Nível removido.");
    const refreshed = await fetchNoteIdeaState({ client, user, noteId });
    bus.emit("graph:node:update", {
      id: noteId,
      is_idea: refreshed?.is_idea ?? data[0]?.is_idea ?? false,
      idea_level: refreshed?.idea_level ?? data[0]?.idea_level,
      level_set: refreshed?.level_set ?? data[0]?.level_set ?? false,
      subject: refreshed?.subject ?? data[0]?.subject,
    });
  };
}
