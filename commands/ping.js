import { getSupabaseClient } from "../supabaseClient.js";

export function pingCommand(bus) {
  return async () => {
    const { client, error } = getSupabaseClient();

    if (error || !client) {
      bus.emit(
        "output:append",
        "ping ERR: configure SUPABASE_URL e SUPABASE_ANON_KEY em config.js antes de usar este comando."
      );
      return;
    }

    bus.emit("output:append", "Verificando conexão com o Supabase...");
    try {
      const { error: sessionError } = await client.auth.getSession();

      if (sessionError) {
        bus.emit("output:append", `ping ERR: ${sessionError.message}`);
        return;
      }

      bus.emit("output:append", "ping OK");
    } catch (err) {
      const message = err?.message ?? "Erro desconhecido";
      bus.emit("output:append", `ping ERR: ${message}`);
    }
  };
}
