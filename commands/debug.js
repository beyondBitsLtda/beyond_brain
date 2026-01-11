import { getSupabaseClient } from "../supabaseClient.js";
import { getAuthenticatedUser } from "../notesService.js";
import { getByIndex } from "../state/selectionRegistry.js";

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

export function debugCommand(bus) {
  return async ({ raw = "" } = {}) => {
    const trimmed = raw.trim();
    if (!/^debug\b/i.test(trimmed)) {
      bus.emit("output:append", "Uso: DEBUG INSIGHT id=\"uuid\" | DEBUG INSIGHT \"#N\"");
      return;
    }

    const payload = trimmed.replace(/^debug\s+/i, "");
    if (!/^insight\b/i.test(payload)) {
      bus.emit("output:append", "Uso: DEBUG INSIGHT id=\"uuid\" | DEBUG INSIGHT \"#N\"");
      return;
    }

    const target = payload.replace(/^insight\s*/i, "");
    const noteId = resolveNoteId(bus, target);
    if (!noteId) {
      bus.emit("output:append", "Uso: DEBUG INSIGHT id=\"uuid\" | DEBUG INSIGHT \"#N\"");
      return;
    }

    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(bus, client);
    if (!user) return;

    const { data, error: queryError } = await client
      .from("notes")
      .select("id,subject,is_idea")
      .eq("id", noteId)
      .eq("user_id", user.id)
      .single();

    if (queryError) {
      bus.emit("output:append", `Erro ao buscar nota: ${queryError.message}`);
      return;
    }

    bus.emit("output:append", `Insight debug (db) id: ${data?.id ?? ""}`);
    bus.emit("output:append", `Insight debug (db) subject: ${data?.subject ?? ""}`);
    bus.emit("output:append", `Insight debug (db) is_idea: ${data?.is_idea}`);

    bus.emit("graph:debug:insight", { noteId });
  };
}
