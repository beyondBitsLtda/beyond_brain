import { getSupabaseClient } from "../supabaseClient.js";
import { clearSession } from "../sessionStore.js";

function stripQuotes(value) {
  if (!value) return "";
  return value.replace(/^"|"$/g, "").trim();
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

function formatFocusStatus(subject, id) {
  const label = subject?.trim() ? subject.trim() : "sem assunto";
  return `FOCUS ON: ${label} (${id})`;
}

export function focusCommand(bus, focusManager) {
  return async ({ args = [] } = {}) => {
    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(bus, client);
    if (!user) return;

    if (args[0] === "clear") {
      focusManager.clearFocus();
      bus.emit("output:append", "Focus removido.");
      bus.emit("graph:refresh");
      return;
    }

    const noteId = stripQuotes(args[0] ?? "");
    if (!noteId) {
      bus.emit("output:append", 'Uso: focus "uuid" | focus clear');
      return;
    }

    const { data, error: noteError } = await client
      .from("notes")
      .select("id,subject")
      .eq("id", noteId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (noteError) {
      bus.emit("output:append", `Erro ao carregar nota: ${noteError.message}`);
      return;
    }

    if (!data?.id) {
      bus.emit("output:append", "Nota não encontrada ou sem permissão.");
      return;
    }

    focusManager.setFocus(data.id, data.subject ?? "");
    bus.emit("output:append", formatFocusStatus(data.subject, data.id));
    bus.emit("graph:refresh");
  };
}
