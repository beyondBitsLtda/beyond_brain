import { getSupabaseClient } from "../supabaseClient.js";
import { getAuthenticatedUser } from "../notesService.js";
import { getByIndex } from "../state/selectionRegistry.js";
import { ensureNoteIdeaColumns } from "../schemaUtils.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SELECTION_REGEX = /^#(\d+)$/;

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

    const { data, error: updateError } = await client
      .from("notes")
      .update({ level_set: false })
      .eq("id", noteId)
      .eq("user_id", user.id)
      .select("id,is_idea,idea_level,level_set,subject");

    if (updateError) {
      bus.emit("output:append", `Erro ao remover nível: ${updateError.message}`);
      return;
    }

    if (!data || data.length === 0) {
      bus.emit("output:append", "Nenhuma nota encontrada para atualizar.");
      return;
    }

    bus.emit("output:append", "Nível removido.");
    bus.emit("graph:node:update", {
      id: noteId,
      is_idea: data[0]?.is_idea ?? false,
      idea_level: data[0]?.idea_level,
      level_set: data[0]?.level_set ?? false,
      subject: data[0]?.subject,
    });
  };
}
