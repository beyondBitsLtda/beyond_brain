import { getSupabaseClient } from "../supabaseClient.js";
import { clearSession, getSession, getUsernameFallback, setSession } from "../sessionStore.js";
import { createProfile, fetchProfile } from "../supabaseProfiles.js";

const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

function normalizeErrorMessage(error) {
  if (!error) return "Erro desconhecido";
  if (typeof error === "string") return error;
  return error.message ?? "Erro desconhecido";
}

function emitPrompt(bus, label, { masked = false, placeholder = "" } = {}) {
  bus.emit("output:append", label);
  bus.emit(masked ? "input:mask" : "input:unmask");
  bus.emit("input:placeholder", placeholder);
  bus.emit("input:focus");
}

function finishCapture(bus) {
  bus.emit("router:capture:stop");
  bus.emit("input:unmask");
  bus.emit("input:placeholder", "");
}

async function populateSessionFromExisting(client) {
  const { data, error } = await client.auth.getSession();
  if (error || !data?.session) {
    clearSession();
    return;
  }

  const user = data.session.user;
  const { profile } = await fetchProfile(client, user.id);
  setSession(user, profile ?? null);
}

export function authCommand({ bus }) {
  return ({ args = [] } = {}) => {
    const isRegister = args.includes("--register");

    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit(
        "output:append",
        "Credenciais do Supabase não configuradas. Edite config.js para definir SUPABASE_URL e SUPABASE_ANON_KEY."
      );
      return;
    }

    const startFlow = isRegister ? startRegisterFlow : startLoginFlow;
    startFlow(client);
  };

  function startLoginFlow(client) {
    let email = "";
    let password = "";

    function askEmail() {
      emitPrompt(bus, "Email:", { placeholder: "email" });
      bus.emit("router:capture:start", {
        echo: "normal",
        handler: handleEmail,
      });
    }

    function handleEmail(value) {
      email = value.trim();
      if (!email) {
        bus.emit("output:append", "Email não pode ser vazio. Tente novamente.");
        askEmail();
        return;
      }

      askPassword();
    }

    function askPassword() {
      emitPrompt(bus, "Senha:", { masked: true, placeholder: "senha" });
      bus.emit("router:capture:start", {
        echo: "mask",
        handler: handlePassword,
      });
    }

    async function handlePassword(value) {
      password = value;
      if (!password) {
        bus.emit("output:append", "Senha não pode ser vazia. Tente novamente.");
        askPassword();
        return;
      }

      await login(email, password, client);
    }

    askEmail();
  }

  function startRegisterFlow(client) {
    let email = "";
    let username = "";
    let password = "";

    function askEmail() {
      emitPrompt(bus, "Email para cadastro:", { placeholder: "email" });
      bus.emit("router:capture:start", {
        echo: "normal",
        handler: handleEmail,
      });
    }

    function handleEmail(value) {
      email = value.trim();
      if (!email) {
        bus.emit("output:append", "Email não pode ser vazio. Tente novamente.");
        askEmail();
        return;
      }
      askUsername();
    }

    function askUsername() {
      emitPrompt(bus, "Username:", { placeholder: "username" });
      bus.emit("router:capture:start", {
        echo: "normal",
        handler: handleUsername,
      });
    }

    async function handleUsername(value) {
      username = value.trim();
      if (!username) {
        bus.emit("output:append", "Username não pode ser vazio. Tente novamente.");
        askUsername();
        return;
      }

      askPassword();
    }

    function askPassword() {
      emitPrompt(bus, "Senha (mín. 8, maiúscula, minúscula e número):", {
        masked: true,
        placeholder: "senha forte",
      });
      bus.emit("router:capture:start", {
        echo: "mask",
        handler: handlePassword,
      });
    }

    async function handlePassword(value) {
      password = value;
      if (!STRONG_PASSWORD_REGEX.test(password)) {
        bus.emit(
          "output:append",
          "Senha fraca. Use pelo menos 8 caracteres com maiúsculas, minúsculas e números."
        );
        askPassword();
        return;
      }

      await register(email, password, username, client);
    }

    askEmail();
  }

  async function login(email, password, client) {
    bus.emit("output:append", "Autenticando...");
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        throw error;
      }

      const user = data?.session?.user ?? data?.user;
      if (!user) {
        throw new Error("Não foi possível recuperar o usuário da sessão.");
      }

      const { profile, error: profileError } = await fetchProfile(client, user.id);
      if (profileError) {
        bus.emit("output:append", `Aviso: falha ao carregar perfil (${normalizeErrorMessage(profileError)}).`);
      }

      if (!profile) {
        finishCapture(bus);
        await promptProfileCreation({ user, client });
        return;
      }

      setSession(user, profile ?? null);
      finishCapture(bus);
      bus.emit("output:clear", "");
      const username = getUsernameFallback();
      bus.emit("output:append", `Welcome to your future brain, @${username}`);
    } catch (err) {
      finishCapture(bus);
      bus.emit("output:append", `Erro ao autenticar: ${normalizeErrorMessage(err)}`);
      bus.emit("output:append", "Tente novamente.\n");
      startLoginFlow(client);
    }
  }

  async function register(email, password, username, client) {
    bus.emit("output:append", "Registrando usuário...");
    try {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: { username },
        },
      });

      if (error) {
        throw error;
      }

      const sessionUser = data?.session?.user ?? null;
      if (!sessionUser) {
        finishCapture(bus);
        clearSession();
        bus.emit("output:append", `Cadastro criado. Enviamos um email de confirmação para ${email}.`);
        bus.emit("output:append", "Confirme o email e depois faça login com `auth`.");
        return;
      }

      const { profile, error: profileError } = await createProfile(client, {
        userId: sessionUser.id,
        username,
      });

      if (profileError) {
        throw profileError;
      }

      setSession(sessionUser, profile ?? null);
      finishCapture(bus);
      bus.emit("output:clear", "");
      const displayName = getUsernameFallback();
      bus.emit("output:append", `Welcome to your future brain, @${displayName}`);
    } catch (err) {
      finishCapture(bus);
      const normalized = normalizeErrorMessage(err);
      const friendly =
        err?.code === "23505"
          ? "Username já está em uso. Escolha outro."
          : normalized;
      bus.emit("output:append", `Erro ao registrar: ${friendly}`);
      bus.emit("output:append", "Reiniciando cadastro...\n");
      startRegisterFlow(client);
    }
  }

  async function promptProfileCreation({ user, client }) {
    return new Promise((resolve) => {
      let username = "";

      function askUsername() {
        emitPrompt(bus, "Username:", { placeholder: "username" });
        bus.emit("router:capture:start", {
          echo: "normal",
          handler: handleUsername,
        });
      }

      async function handleUsername(value) {
        username = value.trim();
        if (!username) {
          bus.emit("output:append", "Username não pode ser vazio. Tente novamente.");
          askUsername();
          return;
        }

        try {
          const { profile, error } = await createProfile(client, {
            userId: user.id,
            username,
          });

          if (error) {
            throw error;
          }

          setSession(user, profile ?? { username });
          finishCapture(bus);
          bus.emit("output:clear", "");
          const displayName = getUsernameFallback();
          bus.emit("output:append", `Welcome to your future brain, @${displayName}`);
          resolve();
        } catch (err) {
          const friendly =
            err?.code === "23505"
              ? "Username já está em uso. Escolha outro."
              : normalizeErrorMessage(err);
          bus.emit("output:append", `Erro ao criar perfil: ${friendly}`);
          askUsername();
        }
      }

      askUsername();
    });
  }
}

export async function bootstrapSession(bus) {
  const { client, error } = getSupabaseClient();
  if (error || !client) {
    clearSession();
    return;
  }

  await populateSessionFromExisting(client);
  const username = getUsernameFallback();
  const { user } = getSession();
  if (user) {
    bus.emit("output:append", `Sessão restaurada para @${username}`);
  }
}
