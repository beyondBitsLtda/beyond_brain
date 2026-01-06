import { getSupabaseClient } from "../supabaseClient.js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config.js";

export function pingCommand(bus) {
  return async () => {
    const { client, error } = getSupabaseClient();

    if (error || !client) {
      const message =
        typeof error === "string" ? error : "Configure SUPABASE_URL e SUPABASE_ANON_KEY em config.js";
      bus.emit("output:append", `ping ERR: ${message}`);
      return;
    }

    bus.emit("output:append", "Verificando conexão com o Supabase...");
    try {
      const { data, error: sessionError } = await client.auth.getSession();

      if (sessionError) {
        bus.emit("output:append", `ping ERR: ${sessionError.message}`);
        return;
      }

      const sessionStatus = data?.session?.user ? "sessão ativa" : "sem sessão";
      const restUrl = `${SUPABASE_URL}/rest/v1/`;
      const restResponse = await fetch(restUrl, {
        method: "HEAD",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      });

      if (!restResponse.ok && restResponse.status !== 404) {
        bus.emit(
          "output:append",
          `ping ERR: REST ${restResponse.status} ${restResponse.statusText || ""}`.trim()
        );
        return;
      }

      bus.emit("output:append", `ping OK (${sessionStatus})`);
    } catch (err) {
      const message = err?.message ?? "Erro desconhecido";
      bus.emit("output:append", `ping ERR: ${message}`);
    }
  };
}
