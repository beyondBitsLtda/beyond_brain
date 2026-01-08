import { getSupabaseClient } from "../supabaseClient.js";
import { clearSession } from "../sessionStore.js";

function parseQuotedValue(raw) {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

async function getAuthenticatedUser(bus, client) {
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) {
    clearSession();
    bus.emit("output:append", "ERR: autentique-se primeiro com `auth`.");
    return null;
  }
  return data.user;
}

export function petCommand(bus, petManager) {
  return async ({ args = [], raw = "" } = {}) => {
    const trimmed = raw.trim();
    const normalized = trimmed.toLowerCase();

    if (normalized.startsWith("pet name")) {
      const nameRaw = trimmed.replace(/^pet\s+name\s*/i, "");
      const name = parseQuotedValue(nameRaw);
      if (!name) {
        bus.emit("output:append", "Uso: pet name \"NOME\"");
        return;
      }
      const ok = petManager.setPetName(name);
      if (ok) {
        bus.emit(
          "output:append",
          `OK: nome do pet atualizado para ${petManager.getPetName()}`
        );
      }
      return;
    }

    if (normalized === "pet reset") {
      petManager.resetPetConfig();
      bus.emit("output:append", "OK: pet resetado.");
      return;
    }

    if (normalized !== "pet") {
      bus.emit("output:append", "Uso: pet | pet name \"NOME\" | pet reset");
      return;
    }

    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(bus, client);
    if (!user) return;

    petManager.enterPetMode();
  };
}
