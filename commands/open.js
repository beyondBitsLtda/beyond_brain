import { getSupabaseClient } from "../supabaseClient.js";
import { getAuthenticatedUser } from "../notesService.js";
import { getByIndex, getLastList, getLastSelect } from "../state/selectionRegistry.js";

function parseKeyValuePairs(raw) {
  const pairs = {};
  const regex = /(\w+)="([^"]*)"/g;
  let match = null;
  while ((match = regex.exec(raw)) !== null) {
    pairs[match[1].toLowerCase()] = match[2];
  }
  return pairs;
}

function parseIndex(value) {
  if (!value) return null;
  const cleaned = value.startsWith("#") ? value.slice(1) : value;
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseOpenNoteId(raw) {
  const match = raw.match(/open\s+note\s+"([^"]+)"/i);
  if (!match) return null;
  return match[1]?.trim() || null;
}

export function openCommand(bus) {
  return async ({ args = [], raw = "" } = {}) => {
    const target = args[0];
    const index = parseIndex(target);
    const pairs = parseKeyValuePairs(raw);
    const id = pairs.id?.trim();
    const noteId = parseOpenNoteId(raw);

    if (index) {
      const note = getByIndex(index);
      if (!note) {
        bus.emit("output:append", "Nenhuma nota encontrada para este índice.");
        return;
      }
      bus.emit("noteViewer:open", { ...note, __index: index });
      return;
    }

    if (id || noteId) {
      const resolvedId = id ?? noteId;
      const { client, error } = getSupabaseClient();
      if (error || !client) {
        bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
        return;
      }

      const user = await getAuthenticatedUser(bus, client);
      if (!user) return;

      const { data, error: selectError } = await client
        .from("notes")
        .select("id,subject,moment,body,created_at")
        .eq("id", resolvedId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (selectError) {
        bus.emit("output:append", `Erro ao abrir nota: ${selectError.message}`);
        return;
      }

      if (!data) {
        bus.emit("output:append", "Nenhuma nota encontrada com esse id.");
        return;
      }

      const lastSelect = getLastSelect();
      const selectEntry = lastSelect.find((entry) => entry.id === data.id);
      const indexValue = selectEntry?.idx ?? null;
      bus.emit(
        "noteViewer:open",
        indexValue ? { ...data, __index: indexValue } : data
      );
      return;
    }

    if (getLastList().length === 0) {
      bus.emit("output:append", "Nenhuma lista ativa. Rode SELECT NOTE primeiro.");
      return;
    }

    bus.emit("output:append", "Uso: open 01 | open #N | open note \"uuid\" | open id=\"uuid\".");
  };
}
