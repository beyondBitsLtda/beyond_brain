import { getSupabaseClient } from "../supabaseClient.js";
import { clearSession } from "../sessionStore.js";
import { getBodyColumnMigrationHint } from "../notesService.js";
const DEFAULT_SUBJECT = "Quick Thought";

function parseKeyValuePairs(raw) {
  const pairs = {};
  const regex = /(\w+)="([^"]*)"/g;
  let match = null;
  while ((match = regex.exec(raw)) !== null) {
    pairs[match[1].toLowerCase()] = match[2];
  }
  return pairs;
}

function stripQuotes(value) {
  const trimmed = value.trim();
  return trimmed.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
}

function formatMoment(date = new Date()) {
  const pad = (val) => String(val).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join(" ");
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

export function nowCommand(bus) {
  return async ({ raw = "" } = {}) => {
    const trimmed = raw.trim();
    const remainder = trimmed.replace(/^now\b/i, "").trim();

    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(bus, client);
    if (!user) return;

    const pairs = parseKeyValuePairs(remainder);
    const subject = pairs.subject?.trim() || DEFAULT_SUBJECT;
    let body = pairs.body?.trim();

    if (!body && remainder && Object.keys(pairs).length === 0) {
      body = stripQuotes(remainder);
    }

    if (!body) {
      bus.emit("output:append", "Uso: now \"texto...\" ou now subject=\"...\" body=\"...\"");
      return;
    }

    const payload = {
      subject,
      moment: formatMoment(),
      body,
      user_id: user.id,
    };

    const { data, error: insertError } = await client
      .from("notes")
      .insert(payload)
      .select("id")
      .maybeSingle();

    if (insertError) {
      bus.emit("output:append", `Erro ao inserir nota: ${insertError.message}`);
      const hint = getBodyColumnMigrationHint(insertError);
      if (hint) {
        bus.emit("output:append", hint);
      }
      return;
    }

    const id = data?.id ?? "(desconhecido)";
    bus.emit("output:append", `OK: nota criada (id ${id})`);
    bus.emit("output:append", `${subject} (${id})`);
  };
}
