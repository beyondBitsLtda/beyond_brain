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
  console.log("[idea]", ...args);
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

function formatDateTime(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (val) => String(val).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(" ");
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

async function updateInsightStatus({ bus, client, user, noteId, isIdea }) {
  const hasIdeaColumns = await ensureNoteIdeaColumns({ client, userId: user.id, bus });
  if (!hasIdeaColumns) {
    bus.emit("output:append", "Não foi possível atualizar ideias sem as colunas de ideia.");
    return false;
  }

  const updates = isIdea
    ? {
        is_idea: true,
        idea_source: "manual",
        idea_marked_at: new Date().toISOString(),
      }
    : {
        is_idea: false,
        idea_source: null,
        idea_marked_at: null,
      };

  const { hasLevelSet } = getNoteIdeaColumnAvailability();
  const selectFields = [
    "id",
    "is_idea",
    "idea_level",
    hasLevelSet ? "level_set" : null,
    "subject",
  ]
    .filter(Boolean)
    .join(",");
  const { data, error } = await client
    .from("notes")
    .update(updates)
    .eq("id", noteId)
    .eq("user_id", user.id)
    .select(selectFields);

  if (error) {
    if (reportUpdatePermissionError(bus, error)) return false;
    bus.emit("output:append", `Erro ao atualizar ideia: ${error.message}`);
    return false;
  }
  if (!data || data.length === 0) {
    bus.emit("output:append", "Nenhuma nota encontrada para atualizar.");
    return false;
  }

  debugLog("updateInsightStatus response", data[0]);
  bus.emit(
    "output:append",
    isIdea ? `Nota ${noteId} marcada como ideia.` : `Nota ${noteId} removida de ideias.`
  );
  const refreshed = await fetchNoteIdeaState({ client, user, noteId });
  bus.emit("graph:node:update", {
    id: noteId,
    is_idea: refreshed?.is_idea ?? data[0]?.is_idea ?? isIdea,
    idea_level: refreshed?.idea_level ?? data[0]?.idea_level,
    level_set: refreshed?.level_set ?? data[0]?.level_set,
    subject: refreshed?.subject ?? data[0]?.subject,
  });
  return true;
}

async function updateLevelStatus({ bus, client, user, noteId, ideaLevel }) {
  const hasIdeaColumns = await ensureNoteIdeaColumns({ client, userId: user.id, bus });
  if (!hasIdeaColumns) {
    bus.emit("output:append", "Não foi possível atualizar níveis sem as colunas de ideia.");
    return false;
  }
  const { hasLevelSet } = getNoteIdeaColumnAvailability();
  if (!hasLevelSet) {
    bus.emit("output:append", "Não foi possível atualizar níveis sem a coluna level_set.");
    return false;
  }

  const level = Math.min(Math.max(Number(ideaLevel ?? 1), 1), 3);
  const { data, error } = await client
    .from("notes")
    .update({ idea_level: level, level_set: true })
    .eq("id", noteId)
    .eq("user_id", user.id)
    .select("id,is_idea,idea_level,level_set,subject");

  if (error) {
    if (reportUpdatePermissionError(bus, error)) return false;
    bus.emit("output:append", `Erro ao atualizar nível: ${error.message}`);
    return false;
  }
  if (!data || data.length === 0) {
    bus.emit("output:append", "Nenhuma nota encontrada para atualizar.");
    return false;
  }

  debugLog("updateLevelStatus response", data[0]);
  bus.emit("output:append", `Nível definido como ${level}.`);
  const refreshed = await fetchNoteIdeaState({ client, user, noteId });
  bus.emit("graph:node:update", {
    id: noteId,
    is_idea: refreshed?.is_idea ?? data[0]?.is_idea ?? false,
    idea_level: refreshed?.idea_level ?? data[0]?.idea_level ?? level,
    level_set: refreshed?.level_set ?? data[0]?.level_set ?? true,
    subject: refreshed?.subject ?? data[0]?.subject,
  });
  return true;
}

async function clearLevelStatus({ bus, client, user, noteId }) {
  const hasIdeaColumns = await ensureNoteIdeaColumns({ client, userId: user.id, bus });
  if (!hasIdeaColumns) {
    bus.emit("output:append", "Não foi possível remover nível sem as colunas de ideia.");
    return false;
  }
  const { hasLevelSet } = getNoteIdeaColumnAvailability();
  if (!hasLevelSet) {
    bus.emit("output:append", "Não foi possível remover nível sem a coluna level_set.");
    return false;
  }

  const { data, error } = await client
    .from("notes")
    .update({ level_set: false })
    .eq("id", noteId)
    .eq("user_id", user.id)
    .select("id,is_idea,idea_level,level_set,subject");

  if (error) {
    if (reportUpdatePermissionError(bus, error)) return false;
    bus.emit("output:append", `Erro ao remover nível: ${error.message}`);
    return false;
  }
  if (!data || data.length === 0) {
    bus.emit("output:append", "Nenhuma nota encontrada para atualizar.");
    return false;
  }

  debugLog("clearLevelStatus response", data[0]);
  bus.emit("output:append", "Nível removido.");
  const refreshed = await fetchNoteIdeaState({ client, user, noteId });
  bus.emit("graph:node:update", {
    id: noteId,
    is_idea: refreshed?.is_idea ?? data[0]?.is_idea ?? false,
    idea_level: refreshed?.idea_level ?? data[0]?.idea_level,
    level_set: refreshed?.level_set ?? data[0]?.level_set ?? false,
    subject: refreshed?.subject ?? data[0]?.subject,
  });
  return true;
}

export function ideaCommand(bus) {
  return async ({ raw = "" } = {}) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    if (/^ideas\b/i.test(trimmed)) {
      const { client, error } = getSupabaseClient();
      if (error || !client) {
        bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
        return;
      }

      const user = await getAuthenticatedUser(bus, client);
      if (!user) return;

      const hasIdeaColumns = await ensureNoteIdeaColumns({ client, userId: user.id, bus });
      if (!hasIdeaColumns) {
        bus.emit("output:append", "Não foi possível listar ideias sem as colunas de ideia.");
        return;
      }

      const { hasLevelSet } = getNoteIdeaColumnAvailability();
      const listFields = [
        "id",
        "subject",
        "created_at",
        "idea_level",
        hasLevelSet ? "level_set" : null,
      ]
        .filter(Boolean)
        .join(",");
      const { data, error: queryError } = await client
        .from("notes")
        .select(listFields)
        .eq("user_id", user.id)
        .eq("is_idea", true)
        .order("created_at", { ascending: false });

      if (queryError) {
        bus.emit("output:append", `Erro ao listar ideias: ${queryError.message}`);
        return;
      }

      if (!data || data.length === 0) {
        bus.emit("output:append", "Nenhuma ideia marcada.");
        return;
      }

      bus.emit("output:append", "Ideias marcadas:");
      data.forEach((note, index) => {
        const createdAt = formatDateTime(note.created_at ?? "");
        const level = note.level_set ? note.idea_level ?? 1 : "-";
        bus.emit(
          "output:append",
          `- [${index + 1}] (nível ${level}) ${note.subject ?? ""} | ${createdAt}`
        );
      });
      return;
    }

    if (!/^idea\b/i.test(trimmed)) {
      bus.emit("output:append", "Uso: IDEA ...");
      return;
    }

    const payload = trimmed.replace(/^idea\s+/i, "");
    if (!payload) {
      bus.emit("output:append", "Uso: IDEA note \"#N\" | IDEA id=\"uuid\" | IDEA off \"#N\" | IDEA level \"#N\" set=2");
      return;
    }

    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(bus, client);
    if (!user) return;

    if (/^off\b/i.test(payload)) {
      const noteId = resolveNoteId(bus, payload.replace(/^off\s*/i, ""));
      if (!noteId) {
        bus.emit("output:append", "Uso: IDEA off \"#N\" | IDEA off id=\"uuid\"");
        return;
      }
      await updateInsightStatus({ bus, client, user, noteId, isIdea: false });
      return;
    }

    if (/^level\b/i.test(payload)) {
      const pairs = parseKeyValuePairs(payload);
      const setValue = pairs.set ?? pairs.level;
      const level = Number(setValue);
      if (!Number.isFinite(level) || level < 1 || level > 3) {
        bus.emit("output:append", "Nível inválido. Use set=1..3.");
        return;
      }
      const noteId = resolveNoteId(bus, payload.replace(/^level\s*/i, ""));
      if (!noteId) {
        bus.emit("output:append", "Uso: IDEA level \"#N\" set=2 | IDEA level id=\"uuid\" set=2");
        return;
      }
      await updateLevelStatus({ bus, client, user, noteId, ideaLevel: level });
      return;
    }

    const cleaned = payload.replace(/^note\s*/i, "");
    const noteId = resolveNoteId(bus, cleaned);
    if (!noteId) {
      bus.emit("output:append", "Uso: IDEA note \"#N\" | IDEA id=\"uuid\"");
      return;
    }
    await updateInsightStatus({ bus, client, user, noteId, isIdea: true });
  };
}
