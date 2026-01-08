import { getSupabaseClient } from "./supabaseClient.js";
import { clearSession } from "./sessionStore.js";

const MAX_BODY_LENGTH = 300;
const PET_NAME_KEY = "bb_pet_name";
const PET_TOTAL_FEEDS_KEY = "bb_pet_stats_totalFeeds";
const DEFAULT_PET_NAME = "Pet";

const MOOD_VARIANTS = {
  calm: [
    ["  /\\_/\\ ", " ( -.- )", "  > ^ <"],
    ["  /\\_/\\ ", " ( -_- )", "  > ^ <"],
  ],
  happy: [
    ["  /\\_/\\ ", " ( ^_^ )", "  >🍪<"],
    ["  /\\_/\\ ", " ( ^o^ )", "  >🍪<"],
  ],
  hyper: [
    ["  /\\_/\\ ", " ( o_O )", "  >⚡<"],
    ["  /\\_/\\ ", " ( @o@ )", "  >⚡<"],
  ],
  wise: [
    ["  /\\_/\\ ", " ( •_• )", "  >📜<"],
    ["  /\\_/\\ ", " ( •‿• )", "  >📜<"],
  ],
};

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
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

function getStoredNumber(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function ensureTrimmedName(value) {
  const trimmed = value.trim();
  return trimmed;
}

function validatePetName(value) {
  const trimmed = ensureTrimmedName(value);
  if (!trimmed) {
    return { ok: false, error: "Nome inválido. Informe 1 a 20 caracteres." };
  }
  if (trimmed.length > 20) {
    return { ok: false, error: "Nome do pet deve ter até 20 caracteres." };
  }
  return { ok: true, name: trimmed };
}

export function loadPetConfig() {
  const stored = localStorage.getItem(PET_NAME_KEY);
  const name = stored && stored.trim() ? stored.trim() : DEFAULT_PET_NAME;
  return { name };
}

export function savePetConfig(config) {
  if (config?.name) {
    localStorage.setItem(PET_NAME_KEY, config.name);
  }
}

export function createPetManager(bus) {
  let config = loadPetConfig();
  const session = {
    active: false,
    feedCountSession: 0,
    feedSinceLastRecall: 0,
    nextRecallAt: randomInt(3, 5),
    wiseTurnsLeft: 0,
    lastInsertedId: null,
  };

  function setPetName(value) {
    const validation = validatePetName(value);
    if (!validation.ok) {
      bus.emit("output:append", validation.error);
      return false;
    }
    config = { ...config, name: validation.name };
    savePetConfig(config);
    return true;
  }

  function resetPetConfig() {
    localStorage.removeItem(PET_NAME_KEY);
    localStorage.removeItem(PET_TOTAL_FEEDS_KEY);
    config = loadPetConfig();
    session.feedCountSession = 0;
    session.feedSinceLastRecall = 0;
    session.nextRecallAt = randomInt(3, 5);
    session.wiseTurnsLeft = 0;
    session.lastInsertedId = null;
  }

  function getPetName() {
    return config.name || DEFAULT_PET_NAME;
  }

  async function getAuthenticatedUser(client) {
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) {
      clearSession();
      bus.emit("output:append", "Você precisa estar logado para usar este comando.");
      return null;
    }
    return data.user;
  }

  function getMood() {
    if (session.wiseTurnsLeft > 0) return "wise";
    if (session.feedCountSession <= 1) return "calm";
    if (session.feedCountSession <= 4) return "happy";
    return "hyper";
  }

  function getMoodReason() {
    if (session.wiseTurnsLeft > 0) return "após o recall";
    if (session.feedCountSession <= 1) return "poucos feeds na sessão";
    if (session.feedCountSession <= 4) return "bons feeds na sessão";
    return "muitos feeds rápidos";
  }

  function pickMoodAscii(mood) {
    const variants = MOOD_VARIANTS[mood] ?? MOOD_VARIANTS.calm;
    const index = Math.floor(Math.random() * variants.length);
    return variants[index];
  }

  function renderPetHeader() {
    const petName = getPetName();
    const mood = getMood();
    const ascii = pickMoodAscii(mood);
    const remaining = Math.max(session.nextRecallAt - session.feedSinceLastRecall, 0);

    bus.emit("output:append", "🐾 PET MODE");
    ascii.forEach((line) => bus.emit("output:append", line));
    bus.emit(
      "output:append",
      `${petName} está: ${mood} (próximo recall em ${remaining} feeds)`
    );

    if (session.wiseTurnsLeft > 0) {
      session.wiseTurnsLeft -= 1;
    }
  }

  function enterPetMode() {
    session.active = true;
    session.feedCountSession = 0;
    session.feedSinceLastRecall = 0;
    session.nextRecallAt = randomInt(3, 5);
    session.wiseTurnsLeft = 0;
    session.lastInsertedId = null;

    bus.emit("output:clear");
    renderPetHeader();
    bus.emit("output:append", "Digite uma nota para alimentar o pet.");
    bus.emit(
      "output:append",
      "Enter = salvar | /exit = sair | /help = ajuda | /recall = lembrar agora | /stats"
    );
    bus.emit("input:placeholder", "pet");
    bus.emit("input:focus");
    bus.emit("router:capture:start", {
      echo: "normal",
      handler: (line) => {
        handlePetLine(line);
      },
    });
  }

  function exitPetMode() {
    session.active = false;
    bus.emit("router:capture:stop");
    bus.emit("input:placeholder", "");
    bus.emit("output:append", "Modo pet encerrado.");
  }

  function updateTotalFeeds() {
    const total = getStoredNumber(PET_TOTAL_FEEDS_KEY) + 1;
    localStorage.setItem(PET_TOTAL_FEEDS_KEY, String(total));
  }

  async function handleStats() {
    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(client);
    if (!user) return;

    const remaining = Math.max(session.nextRecallAt - session.feedSinceLastRecall, 0);
    const { count, error: countError } = await client
      .from("notes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("subject", "pet");

    if (countError) {
      bus.emit("output:append", `Erro ao contar notas pet: ${countError.message}`);
      return;
    }

    bus.emit("output:append", `Feeds na sessão: ${session.feedCountSession}`);
    bus.emit(
      "output:append",
      `Feeds desde o último recall: ${session.feedSinceLastRecall}`
    );
    bus.emit("output:append", `Próximo recall em ${remaining} feeds.`);
    bus.emit("output:append", `Total de notas pet: ${count ?? 0}`);
  }

  async function feed(text) {
    const trimmed = text.trim();
    if (!trimmed) {
      bus.emit("output:append", "Digite algo para alimentar o pet.");
      return;
    }
    if (trimmed.length > MAX_BODY_LENGTH) {
      bus.emit(
        "output:append",
        `Body excede ${MAX_BODY_LENGTH} caracteres. Reduza e tente novamente.`
      );
      return;
    }

    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(client);
    if (!user) return;

    const payload = {
      subject: "pet",
      moment: "Pet Feeding",
      body: trimmed,
      user_id: user.id,
    };

    const { data, error: insertError } = await client
      .from("notes")
      .insert(payload)
      .select("id")
      .maybeSingle();

    if (insertError) {
      bus.emit("output:append", `Erro ao inserir nota: ${insertError.message}`);
      return;
    }

    const id = data?.id ?? "(desconhecido)";
    session.lastInsertedId = data?.id ?? null;
    session.feedCountSession += 1;
    session.feedSinceLastRecall += 1;
    updateTotalFeeds();

    bus.emit("output:append", `🍪 ${getPetName()} foi alimentado! (id ${id})`);
    renderPetHeader();

    if (session.feedSinceLastRecall >= session.nextRecallAt) {
      await recallNow({ avoidId: session.lastInsertedId });
      session.feedSinceLastRecall = 0;
      session.nextRecallAt = randomInt(3, 5);
      renderPetHeader();
    }
  }

  function computeDegrees(noteIds, relations) {
    const degrees = new Map();
    noteIds.forEach((id) => degrees.set(id, 0));
    relations.forEach((rel) => {
      if (degrees.has(rel.from_note_id)) {
        degrees.set(rel.from_note_id, degrees.get(rel.from_note_id) + 1);
      }
      if (degrees.has(rel.to_note_id)) {
        degrees.set(rel.to_note_id, degrees.get(rel.to_note_id) + 1);
      }
    });
    return degrees;
  }

  function pickRecallNote(notes, relations, avoidId) {
    const candidates = notes.filter((note) => note.id !== avoidId);
    const poolBase = candidates.length > 0 ? candidates : notes;
    if (poolBase.length === 0) return null;

    const degrees = computeDegrees(
      poolBase.map((note) => note.id),
      relations
    );
    const orphans = poolBase.filter((note) => (degrees.get(note.id) ?? 0) === 0);
    const pool = orphans.length > 0 ? orphans : poolBase;
    const index = Math.floor(Math.random() * pool.length);
    return pool[index];
  }

  async function recallNow({ avoidId } = {}) {
    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(client);
    if (!user) return;

    const { data: notes, error: notesError } = await client
      .from("notes")
      .select("id,subject,body,created_at")
      .eq("user_id", user.id)
      .eq("subject", "pet")
      .order("created_at", { ascending: false })
      .limit(100);

    if (notesError) {
      bus.emit("output:append", `Erro ao buscar notas pet: ${notesError.message}`);
      return;
    }

    if (!notes || notes.length === 0) {
      bus.emit("output:append", "🐾 Ainda não tenho memórias. Alimente-me mais!");
      return;
    }

    const { data: relations, error: relError } = await client
      .from("note_relations")
      .select("from_note_id,to_note_id")
      .eq("user_id", user.id);

    if (relError) {
      bus.emit("output:append", `Erro ao carregar relações: ${relError.message}`);
      return;
    }

    const picked = pickRecallNote(notes, relations ?? [], avoidId);
    if (!picked) {
      bus.emit("output:append", "🐾 Ainda não tenho memórias. Alimente-me mais!");
      return;
    }

    bus.emit("output:append", `🐾 ${getPetName()} trouxe uma lembrança:`);
    bus.emit(
      "output:append",
      `— ${picked.subject} | ${formatDateTime(picked.created_at)}`
    );
    bus.emit("output:append", picked.body);
    bus.emit(
      "output:append",
      "Sugestão: crie um LINK desta ideia para outra nota se fizer sentido."
    );
    session.wiseTurnsLeft = 2;
  }

  function isBarePetCommand(trimmed, commandLower) {
    if (!trimmed) return false;
    if (trimmed.startsWith("/")) return false;
    if (!commandLower) return false;
    if (commandLower === "name") {
      return trimmed === commandLower || trimmed.startsWith(`${commandLower} `);
    }
    return trimmed === commandLower;
  }

  function handlePetLine(line) {
    const trimmed = line.trim();
    const hasSlashPrefix = trimmed.startsWith("/");
    const normalized = hasSlashPrefix ? trimmed.slice(1).trim() : trimmed;
    const [command = "", ...rest] = normalized.split(/\s+/);
    const commandLower = command.toLowerCase();
    const remainder = rest.join(" ");

    if (hasSlashPrefix || isBarePetCommand(trimmed, commandLower)) {
      if (!commandLower) {
        bus.emit("output:append", "Comando do pet não reconhecido. Use /help.");
        return;
      }

      if (commandLower === "exit") {
        exitPetMode();
        return;
      }

      if (commandLower === "help") {
        bus.emit(
          "output:append",
          "/exit, /recall, /stats, /name <nome>, /mood"
        );
        return;
      }

      if (commandLower === "recall") {
        recallNow({ avoidId: null }).then(() => {
          session.feedSinceLastRecall = 0;
          session.nextRecallAt = randomInt(3, 5);
          renderPetHeader();
        });
        return;
      }

      if (commandLower === "stats") {
        handleStats();
        return;
      }

      if (commandLower === "name") {
        if (!remainder) {
          bus.emit("output:append", "Uso: /name <nome>");
          return;
        }
        const ok = setPetName(remainder);
        if (ok) {
          bus.emit("output:append", `OK: nome do pet atualizado para ${getPetName()}`);
          renderPetHeader();
        }
        return;
      }

      if (commandLower === "mood") {
        bus.emit(
          "output:append",
          `Humor atual: ${getMood()} (${getMoodReason()}).`
        );
        return;
      }

      bus.emit("output:append", "Comando do pet não reconhecido. Use /help.");
      return;
    }

    feed(trimmed);
  }

  return {
    enterPetMode,
    exitPetMode,
    handlePetLine,
    feed,
    recallNow,
    pickRecallNote,
    computeDegrees,
    getMood,
    renderPetHeader,
    setPetName,
    resetPetConfig,
    getPetName,
  };
}
