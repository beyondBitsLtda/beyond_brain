import { getSupabaseClient } from "../supabaseClient.js";
import { clearSession } from "../sessionStore.js";

function finishCapture(bus) {
  bus.emit("router:capture:stop");
  bus.emit("input:unmask");
  bus.emit("input:placeholder", "");
}

async function getAuthenticatedUser(bus, client) {
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) {
    clearSession();
    bus.emit("output:append", "ERR: é necessário estar autenticado para executar este comando.");
    return null;
  }
  return data.user;
}

function isResetBrainCommand(raw, expectedRoot) {
  const normalized = raw.trim().toUpperCase();
  if (normalized === expectedRoot) return true;
  return normalized === `${expectedRoot} BRAIN`;
}

export function resetBrainCommand(bus) {
  return async ({ raw = "" } = {}) => {
    if (!isResetBrainCommand(raw, "RESET") && !isResetBrainCommand(raw, "NUKE")) {
      bus.emit("output:append", "Uso: RESET BRAIN");
      return;
    }

    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(bus, client);
    if (!user) return;

    bus.emit(
      "output:append",
      "⚠️ Isso apagará TODAS as suas notas e relações. Essa ação é irreversível."
    );
    bus.emit("output:append", "Digite YES para confirmar ou qualquer outra coisa para cancelar:");
    bus.emit("input:placeholder", "YES");
    bus.emit("input:focus");
    bus.emit("router:capture:start", {
      echo: "normal",
      handler: async (value) => {
        const confirmation = value.trim();
        finishCapture(bus);

        if (confirmation !== "YES") {
          bus.emit("output:append", "Operação cancelada.");
          return;
        }

        try {
          const { error: relError } = await client
            .from("note_relations")
            .delete()
            .eq("user_id", user.id);

          if (relError) {
            throw relError;
          }

          const { error: notesError } = await client
            .from("notes")
            .delete()
            .eq("user_id", user.id);

          if (notesError) {
            throw notesError;
          }

          bus.emit("output:clear");
          bus.emit("output:append", "🧠 Brain resetado com sucesso. Comece do zero.");
          bus.emit("graph:refresh");
        } catch (err) {
          console.error("Erro ao resetar brain:", err);
          bus.emit("output:append", "ERR: não foi possível resetar o brain.");
        }
      },
    });
  };
}
