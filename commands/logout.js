import { getSupabaseClient } from "../supabaseClient.js";
import { clearSession } from "../sessionStore.js";

export function logoutCommand(bus) {
  return async () => {
    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit(
        "output:append",
        "Supabase não configurado. Edite config.js para usar autenticação."
      );
      return;
    }

    bus.emit("output:append", "Encerrando sessão...");
    try {
      const { error: signOutError } = await client.auth.signOut();
      if (signOutError) {
        throw signOutError;
      }
      clearSession();
      bus.emit("output:append", "Logout realizado com sucesso.");
    } catch (err) {
      const message = err?.message ?? "Erro desconhecido";
      bus.emit("output:append", `Erro ao sair: ${message}`);
    }
  };
}
