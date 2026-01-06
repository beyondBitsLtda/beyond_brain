import { getUsernameFallback, getSession } from "../sessionStore.js";

export function whoamiCommand(bus) {
  return () => {
    const { user, profile } = getSession();
    if (!user) {
      bus.emit("output:append", "Você não está autenticado.");
      return;
    }

    const username = getUsernameFallback();
    const email = user.email ?? "(sem email)";
    const profileStatus = profile?.username ? "carregado" : "não encontrado";

    bus.emit(
      "output:append",
      `Usuário atual: @${username} (email: ${email}, perfil: ${profileStatus})`
    );
  };
}
