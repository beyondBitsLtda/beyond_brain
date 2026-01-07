import { getSupabaseClient } from "../supabaseClient.js";
import { clearSession } from "../sessionStore.js";

const TABLE_MAX_WIDTH = 40;
const BODY_PREVIEW_LENGTH = 120;
const NOTE_FIELDS = ["id", "subject", "moment", "created_at", "body"];

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

function normalizeCellValue(value, field) {
  if (value === null || value === undefined) return "";
  if (field === "created_at") {
    return formatDateTime(value);
  }
  if (value instanceof Date) {
    return formatDateTime(value);
  }
  return String(value);
}

function truncateCell(value, width) {
  if (value.length <= width) return value;
  if (width <= 3) return value.slice(0, width);
  return `${value.slice(0, width - 3)}...`;
}

function formatTableSQLServer(rows, fields, maxWidth = TABLE_MAX_WIDTH) {
  const widths = fields.map((field) => field.length);
  rows.forEach((row) => {
    fields.forEach((field, index) => {
      const value = normalizeCellValue(row[field], field);
      widths[index] = Math.max(widths[index], value.length);
    });
  });

  const finalWidths = widths.map((width) => Math.min(maxWidth, width));
  const border = `+${finalWidths.map((width) => "-".repeat(width + 2)).join("+")}+`;

  const formatRow = (values) =>
    `| ${values
      .map((value, index) => truncateCell(value, finalWidths[index]).padEnd(finalWidths[index]))
      .join(" | ")} |`;

  const header = formatRow(fields);
  const dataRows = rows.map((row) =>
    formatRow(fields.map((field) => normalizeCellValue(row[field], field)))
  );

  return [border, header, border, ...dataRows, border];
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

function truncateBody(value) {
  if (!value) return "";
  if (value.length <= BODY_PREVIEW_LENGTH) return value;
  return `${value.slice(0, BODY_PREVIEW_LENGTH - 3)}...`;
}

function fallbackOrderError(error) {
  if (!error?.message) return false;
  return error.message.toLowerCase().includes("created_at");
}

export function lastCommand(bus) {
  return async () => {
    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit(
        "output:append",
        "Supabase não configurado. Use auth --register ou auth para autenticar."
      );
      return;
    }

    const user = await getAuthenticatedUser(bus, client);
    if (!user) return;

    let usedFallback = false;
    let data = null;
    let queryError = null;

    ({ data, error: queryError } = await client
      .from("notes")
      .select(NOTE_FIELDS.join(","))
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1));

    if (queryError && fallbackOrderError(queryError)) {
      usedFallback = true;
      ({ data, error: queryError } = await client
        .from("notes")
        .select(NOTE_FIELDS.join(","))
        .eq("user_id", user.id)
        .order("id", { ascending: false })
        .limit(1));
    }

    if (queryError) {
      bus.emit("output:append", `Erro ao buscar nota: ${queryError.message}`);
      return;
    }

    if (!data || data.length === 0) {
      bus.emit("output:append", "Nenhuma nota encontrada.");
      return;
    }

    const row = { ...data[0], body: truncateBody(data[0].body) };
    const table = formatTableSQLServer([row], NOTE_FIELDS);
    table.forEach((line) => bus.emit("output:append", line));

    if (usedFallback) {
      bus.emit(
        "output:append",
        "Aviso: created_at indisponível; ordenação por id aplicada como fallback."
      );
    }
  };
}
