import { getSupabaseClient } from "../supabaseClient.js";
import { clearSession } from "../sessionStore.js";

const MAX_BODY_LENGTH = 300;
const NOTE_FIELDS = ["id", "subject", "moment", "body", "ref", "created_at"];
const UPDATE_FIELDS = ["subject", "moment", "body", "ref"];

function parseKeyValuePairs(raw) {
  const pairs = {};
  const regex = /(\w+)="([^"]*)"/g;
  let match = null;
  while ((match = regex.exec(raw)) !== null) {
    pairs[match[1].toLowerCase()] = match[2];
  }
  return pairs;
}

function ensureNoteKeyword(bus, raw, action) {
  const normalized = raw.trim().toUpperCase();
  if (!normalized.startsWith(`${action} NOTE`)) {
    bus.emit("output:append", `Uso: ${action} NOTE ...`);
    return false;
  }
  return true;
}

function parseSelectFields(raw) {
  const match = raw.match(/FIELDS\(([^)]+)\)/i);
  if (!match) return null;
  return match[1]
    .split(",")
    .map((field) => field.trim().toLowerCase())
    .filter(Boolean);
}

function parseLimit(raw) {
  const match = raw.match(/LIMIT\s+(\d+)/i);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isNaN(value) ? null : value;
}

function stripQuotes(value) {
  const trimmed = value.trim();
  return trimmed.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
}

function parseWhereClause(raw) {
  const match = raw.match(/WHERE\s+(.+?)(?:\s+LIMIT\s+\d+\s*)?$/i);
  if (!match) return { conditions: [] };

  const clauseText = match[1].trim();
  if (!clauseText) return { conditions: [] };

  const clauses = clauseText.split(/\s+AND\s+/i).map((part) => part.trim());
  const conditions = [];

  for (const clause of clauses) {
    const clauseMatch = clause.match(/^(\w+)\s*(=|~|>=|<=)\s*(.+)$/);
    if (!clauseMatch) {
      return { error: `Condição inválida: ${clause}` };
    }

    const field = clauseMatch[1].toLowerCase();
    const operator = clauseMatch[2];
    const value = stripQuotes(clauseMatch[3]);

    conditions.push({ field, operator, value });
  }

  return { conditions };
}

function formatTable(rows, fields) {
  const widths = fields.map((field) => field.length);
  rows.forEach((row) => {
    fields.forEach((field, index) => {
      const value = row[field] ?? "";
      widths[index] = Math.max(widths[index], String(value).length);
    });
  });

  const header = fields
    .map((field, index) => field.padEnd(widths[index]))
    .join(" | ");
  const divider = widths.map((width) => "-".repeat(width)).join("-+-");
  const lines = rows.map((row) =>
    fields
      .map((field, index) => String(row[field] ?? "").padEnd(widths[index]))
      .join(" | ")
  );

  return [header, divider, ...lines];
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

function validateBodyLength(bus, body) {
  if (body.length > MAX_BODY_LENGTH) {
    bus.emit(
      "output:append",
      `Body excede ${MAX_BODY_LENGTH} caracteres. Reduza e tente novamente.`
    );
    return false;
  }
  return true;
}

function resolveSelectFields(bus, fields) {
  if (!fields) return NOTE_FIELDS;
  const invalid = fields.filter((field) => !NOTE_FIELDS.includes(field));
  if (invalid.length > 0) {
    bus.emit(
      "output:append",
      `FIELDS inválido: ${invalid.join(", ")}. Campos permitidos: ${NOTE_FIELDS.join(", ")}.`
    );
    return null;
  }
  return fields;
}

function applyWhereConditions(bus, query, conditions) {
  for (const condition of conditions) {
    const { field, operator, value } = condition;

    if (!NOTE_FIELDS.includes(field)) {
      bus.emit("output:append", `Campo inválido no WHERE: ${field}.`);
      return null;
    }

    if ((operator === ">=" || operator === "<=") && field !== "created_at") {
      bus.emit(
        "output:append",
        `Operador ${operator} permitido apenas para created_at.`
      );
      return null;
    }

    if (operator === "=") {
      query = query.eq(field, value);
      continue;
    }

    if (operator === "~") {
      query = query.ilike(field, `%${value}%`);
      continue;
    }

    if (operator === ">=") {
      query = query.gte(field, value);
      continue;
    }

    if (operator === "<=") {
      query = query.lte(field, value);
    }
  }

  return query;
}

export function insertNoteCommand(bus) {
  return async ({ raw = "" } = {}) => {
    if (!ensureNoteKeyword(bus, raw, "INSERT")) return;

    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(bus, client);
    if (!user) return;

    const pairs = parseKeyValuePairs(raw);
    const subject = pairs.subject?.trim();
    const moment = pairs.moment?.trim();
    const body = pairs.body?.trim();
    const ref = pairs.ref?.trim();

    if (!subject || !moment || !body) {
      bus.emit(
        "output:append",
        "Uso: INSERT NOTE subject=\"...\" moment=\"...\" body=\"...\" [ref=\"...\"]"
      );
      return;
    }

    if (!validateBodyLength(bus, body)) return;

    const payload = {
      subject,
      moment,
      body,
      ref: ref || null,
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

    bus.emit("output:append", `Nota criada com id ${data?.id ?? "(desconhecido)"}.`);
  };
}

export function selectNoteCommand(bus) {
  return async ({ raw = "" } = {}) => {
    if (!ensureNoteKeyword(bus, raw, "SELECT")) return;

    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(bus, client);
    if (!user) return;

    const requestedFields = resolveSelectFields(bus, parseSelectFields(raw));
    if (!requestedFields) return;

    const { conditions, error: whereError } = parseWhereClause(raw);
    if (whereError) {
      bus.emit("output:append", whereError);
      return;
    }

    let query = client
      .from("notes")
      .select(requestedFields.join(","))
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    query = applyWhereConditions(bus, query, conditions);
    if (!query) return;

    const limit = parseLimit(raw);
    if (limit !== null) {
      query = query.limit(limit);
    }

    const { data, error: selectError } = await query;
    if (selectError) {
      bus.emit("output:append", `Erro ao listar notas: ${selectError.message}`);
      return;
    }

    if (!data || data.length === 0) {
      bus.emit("output:append", "Nenhuma nota encontrada.");
      return;
    }

    formatTable(data, requestedFields).forEach((line) => bus.emit("output:append", line));
  };
}

export function updateNoteCommand(bus) {
  return async ({ raw = "" } = {}) => {
    if (!ensureNoteKeyword(bus, raw, "UPDATE")) return;

    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(bus, client);
    if (!user) return;

    const [beforeSet, afterSet] = raw.split(/\s+SET\s+/i);
    if (!afterSet) {
      bus.emit("output:append", "Uso: UPDATE NOTE id=\"...\" SET field=\"...\"");
      return;
    }

    const id = parseKeyValuePairs(beforeSet).id?.trim();
    if (!id) {
      bus.emit("output:append", "Uso: UPDATE NOTE id=\"...\" SET field=\"...\"");
      return;
    }

    const fields = parseKeyValuePairs(afterSet);
    const updates = {};
    for (const [key, value] of Object.entries(fields)) {
      if (!UPDATE_FIELDS.includes(key)) {
        bus.emit("output:append", `Campo inválido para atualização: ${key}.`);
        return;
      }
      updates[key] = value.trim();
    }

    if (Object.keys(updates).length === 0) {
      bus.emit("output:append", "Nenhum campo válido para atualizar.");
      return;
    }

    if (updates.body && !validateBodyLength(bus, updates.body)) return;

    const { data, error: updateError } = await client
      .from("notes")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id");

    if (updateError) {
      bus.emit("output:append", `Erro ao atualizar nota: ${updateError.message}`);
      return;
    }

    if (!data || data.length === 0) {
      bus.emit("output:append", "Nenhuma nota encontrada para atualizar.");
      return;
    }

    bus.emit("output:append", `Nota ${id} atualizada.`);
  };
}

export function deleteNoteCommand(bus) {
  return async ({ raw = "" } = {}) => {
    if (!ensureNoteKeyword(bus, raw, "DELETE")) return;

    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(bus, client);
    if (!user) return;

    const id = parseKeyValuePairs(raw).id?.trim();
    if (!id) {
      bus.emit("output:append", "Uso: DELETE NOTE id=\"...\"");
      return;
    }

    const { data, error: deleteError } = await client
      .from("notes")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id");

    if (deleteError) {
      bus.emit("output:append", `Erro ao deletar nota: ${deleteError.message}`);
      return;
    }

    if (!data || data.length === 0) {
      bus.emit("output:append", "Nenhuma nota encontrada para deletar.");
      return;
    }

    bus.emit("output:append", `Nota ${id} removida.`);
  };
}
