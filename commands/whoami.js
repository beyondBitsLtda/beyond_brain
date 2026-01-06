import { getSupabaseClient } from "../supabaseClient.js";
import { clearSession, getUsernameFallback, setSession } from "../sessionStore.js";
import { fetchProfile } from "../supabaseProfiles.js";

export function whoamiCommand(bus) {
  return async () => {
    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const { data, error: sessionError } = await client.auth.getUser();
    if (sessionError || !data?.user) {
      clearSession();
      bus.emit("output:append", "Você não está logado.");
      return;
    }

    const user = data.user;
    const { profile, error: profileError } = await fetchProfile(client, user.id);
    if (profileError) {
      bus.emit("output:append", `Você está logado, mas não foi possível carregar o perfil (${profileError.message}).`);
      setSession(user, null);
      return;
    }

    setSession(user, profile ?? null);
    const username = getUsernameFallback();
    bus.emit("output:append", `@${username}`);
  };
}
