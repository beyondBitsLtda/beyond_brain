import { getSupabaseClient } from "../supabaseClient.js";
import {
  getAuthenticatedUser,
  getBodyColumnMigrationHint,
  insertNote,
} from "../notesService.js";
import {
  clear,
  getByIndex,
  getLastList,
  getLastSelect,
  getLastSelectMeta,
  setList,
} from "../state/selectionRegistry.js";
import {
  clearDeleteBySubjectState,
  getDeleteBySubjectState,
  isDeleteBySubjectExpired,
  setDeleteBySubjectState,
} from "../state/deleteBySubjectState.js";
import {
  clearRelationPicker,
  getRelationPickerState,
  startRelationPicker,
} from "../state/relationPickerState.js";
import { listRelationsForNote } from "./rels.js";
import { createConfirmModal } from "../ui/confirmModal.js";
import { createRelationModal } from "../ui/relationModal.js";
import {
  getKindStyle,
  getNoteKind,
  getRefLabel,
  isIdeaOrTask,
  normalizeRef,
} from "../refUtils.js";
const NOTE_FIELDS = [
  "id",
  "subject",
  "moment",
  "body",
  "ref",
  "created_at",
];
const UPDATE_FIELDS = ["subject", "moment", "body", "ref"];
const TABLE_MAX_WIDTH = 40;
const BODY_SUMMARY_LIMIT = 140;
const ID_PREFIX_LENGTH = 8;
const DELETE_PREVIEW_LIMIT = 5;
const SELECT_INDEX_PAD = 2;
const relationModal = createRelationModal(document.body);
const confirmModal = createConfirmModal(document.body);

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

function parseShowFields(raw) {
  const match = raw.match(/SHOW\s+(.+?)(?:\s+WHERE|\s+LIMIT|$)/i);
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
  return `${value.slice(0, width - 1)}…`;
}

function normalizeSummary(value, limit = BODY_SUMMARY_LIMIT) {
  if (!value) return "";
  const collapsed = String(value).replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit - 1)}…`;
}

function formatShortId(id) {
  return String(id ?? "").slice(0, ID_PREFIX_LENGTH);
}

function formatSelectIndex(value) {
  const index = Number.isFinite(value) ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(index)) return "";
  return String(index).padStart(SELECT_INDEX_PAD, "0");
}

function mergeRequestedFields(...fieldGroups) {
  const merged = fieldGroups.flat().filter(Boolean);
  if (merged.length === 0) return null;
  return Array.from(new Set(merged));
}

function formatNoteTable(notes, { showRef } = {}) {
  const fields = ["index", "badge", "subject"];
  if (showRef) {
    fields.push("ref");
  }
  fields.push("created_at", "body");

  const headerLabels = {
    index: "#",
    badge: "tag",
    subject: "subject",
    ref: "ref",
    created_at: "created_at",
    body: "body",
  };
  const rows = notes.map((note, index) => ({
    index: formatSelectIndex(index + 1),
    badge: getKindStyle(getNoteKind(note)).badge,
    subject: note.subject ?? "",
    ref: showRef ? getRefLabel(note) : "",
    created_at: formatDateTime(note.created_at ?? ""),
    body: normalizeSummary(note.body ?? ""),
  }));

  const widths = fields.map((field) => (headerLabels[field] ?? field).length);
  rows.forEach((row) => {
    fields.forEach((field, index) => {
      widths[index] = Math.max(widths[index], String(row[field]).length);
    });
  });

  const maxWidths = {
    index: 2,
    badge: 7,
    subject: 28,
    ref: 16,
    created_at: 19,
    body: 50,
  };

  const finalWidths = fields.map((field, index) =>
    Math.min(maxWidths[field] ?? TABLE_MAX_WIDTH, widths[index])
  );
  const border = `+${finalWidths.map((width) => "-".repeat(width + 2)).join("+")}+`;
  const formatRow = (values) =>
    `| ${values
      .map((value, index) => truncateCell(String(value), finalWidths[index]).padEnd(finalWidths[index]))
      .join(" | ")} |`;

  const header = formatRow(fields.map((field) => headerLabels[field] ?? field));
  const dataRows = rows.map((row) =>
    formatRow(fields.map((field) => row[field]))
  );

  return { lines: [border, header, border, ...dataRows, border], rows };
}

async function createRelationFromList({ bus, fromId, toId, type }) {
  const { client, error } = getSupabaseClient();
  if (error || !client) {
    return {
      ok: false,
      errorMessage: "Supabase não configurado. Use auth --register ou auth para autenticar.",
    };
  }

  const user = await getAuthenticatedUser(bus, client);
  if (!user) {
    return { ok: false, errorMessage: "Você precisa estar logado para usar este comando." };
  }

  if (fromId === toId) {
    return { ok: false, errorMessage: "Não é permitido criar relação da nota com ela mesma." };
  }

  const { data: existing, error: existingError } = await client
    .from("note_relations")
    .select("id")
    .eq("from_note_id", fromId)
    .eq("to_note_id", toId)
    .eq("type", type)
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    return {
      ok: false,
      errorMessage: `Erro ao verificar relação na note_relations: ${existingError.message}`,
    };
  }

  if (existing) {
    return { ok: false, errorMessage: "Essa relação já existe." };
  }

  const { error: insertError } = await client
    .from("note_relations")
    .insert({
      from_note_id: fromId,
      to_note_id: toId,
      type,
      user_id: user.id,
    });

  if (insertError) {
    if (insertError.code === "23505") {
      return { ok: false, errorMessage: "Essa relação já existe." };
    }
    return {
      ok: false,
      errorMessage: `Erro ao criar relação na note_relations: ${insertError.message}`,
    };
  }

  bus.emit("output:append", `Relação criada: (${type}) ${fromId} -> ${toId}`);
  bus.emit("graph:refresh");
  return { ok: true };
}

function startRelationPickerFromNote(bus, note) {
  if (!note?.id) return;
  startRelationPicker({ fromNoteId: note.id, fromSubject: note.subject ?? "" });
  bus.emit(
    "output:append",
    'Selecione a nota destino clicando em outra linha ou use "target #3".'
  );
}

function handleRelationTargetSelection(bus, note) {
  const picker = getRelationPickerState();
  if (!picker.active || !picker.fromNoteId || !note?.id) {
    return false;
  }

  if (picker.fromNoteId === note.id) {
    bus.emit("output:append", "Selecione uma nota destino diferente da origem.");
    return true;
  }

  const fromNote = {
    id: picker.fromNoteId,
    subject: picker.fromSubject || "(sem assunto)",
  };
  const toNote = {
    id: note.id,
    subject: note.subject ?? "(sem assunto)",
  };
  clearRelationPicker();

  relationModal.open({
    fromNote,
    toNote,
    defaultType: "related",
    onConfirm: async (type) => {
      const result = await createRelationFromList({
        bus,
        fromId: fromNote.id,
        toId: toNote.id,
        type,
      });
      if (result.ok) {
        return true;
      }
      return { errorMessage: result.errorMessage };
    },
    onCancel: () => {
      bus.emit("output:append", "Operação cancelada.");
    },
  });

  return true;
}

function renderNotesOutput(bus, notes, { showRef } = {}) {
  setList(notes, { showRef });
  const { lines, rows } = formatNoteTable(notes, { showRef });
  lines.forEach((line, index) => {
    const rowIndex = index - 3;
    if (rowIndex >= 0 && rowIndex < rows.length) {
      const note = notes[rowIndex];
      const kind = getNoteKind(note);
      const { cssClass } = getKindStyle(kind);
      const className = ["terminal__line--clickable", cssClass].filter(Boolean).join(" ");
      bus.emit("output:append", {
        text: line,
        className,
        data: {
          openIndex: rowIndex + 1,
          noteId: note?.id,
          idx: formatSelectIndex(rowIndex + 1),
        },
        onClick: () => handleRelationTargetSelection(bus, note),
        actionPopover: {
          key: `row:${note?.id ?? rowIndex}`,
          title: note?.subject ?? "Nota",
          items: [
            {
              label: "Ver nota",
              action: () => {
                const selected = getByIndex(rowIndex + 1);
                if (selected) {
                  bus.emit("noteViewer:open", {
                    ...selected,
                    __index: rowIndex + 1,
                  });
                }
              },
            },
            {
              label: "Criar relação...",
              action: () => {
                startRelationPickerFromNote(bus, note);
              },
            },
            {
              label: "Consultar relações",
              action: () => {
                if (!note?.id) return;
                listRelationsForNote(bus, note.id);
              },
            },
            {
              label: "Deletar nota",
              danger: true,
              action: async () => {
                if (!note?.id) return;
                confirmModal.open({
                  title: "Deletar nota?",
                  message: note.subject ?? "(sem assunto)",
                  confirmLabel: "Sim, deletar",
                  cancelLabel: "Não",
                  danger: true,
                  onConfirm: async () => {
                    const { client, error } = getSupabaseClient();
                    if (error || !client) {
                      const message =
                        "Supabase não configurado. Use auth --register ou auth para autenticar.";
                      confirmModal.setError(message);
                      bus.emit("output:append", message);
                      return false;
                    }
                    const user = await getAuthenticatedUser(bus, client);
                    if (!user) return false;
                    const removed = await deleteNoteById({
                      bus,
                      client,
                      userId: user.id,
                      id: note.id,
                    });
                    if (!removed) return false;
                    const updatedList = getLastList().filter((item) => item.id !== note.id);
                    if (updatedList.length === 0) {
                      clear();
                      bus.emit("output:append", "Nenhuma nota encontrada.");
                      confirmModal.close();
                      return true;
                    }
                    bus.emit("output:append", "Lista atualizada:");
                    const { showRef } = getLastSelectMeta();
                    renderNotesOutput(bus, updatedList, { showRef });
                    confirmModal.close();
                    return true;
                  },
                });
              },
            },
          ],
        },
      });
    } else {
      bus.emit("output:append", line);
    }
  });
  const first = formatSelectIndex(1);
  const second = formatSelectIndex(2);
  const third = formatSelectIndex(3);
  bus.emit("output:append", "Options:");
  bus.emit(
    "output:append",
    `  mark ${first} ideia | mark ${second} task | mark ${third} clear`
  );
  bus.emit("output:append", `  open ${first}`);
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

function clearExpiredDeleteBySubject(bus) {
  const state = getDeleteBySubjectState();
  if (isDeleteBySubjectExpired(state)) {
    clearDeleteBySubjectState();
    bus.emit("output:append", "Confirmação expirada. Rode novamente o DELETE NOTE subject=\"...\".");
    return true;
  }
  return false;
}

function startConfirmPrompt(bus, { message, placeholder, onConfirm }) {
  bus.emit("output:append", message);
  bus.emit("input:placeholder", placeholder ?? "y");
  bus.emit("input:focus");
  bus.emit("router:capture:start", {
    echo: "normal",
    handler: async (value) => {
      bus.emit("router:capture:stop");
      bus.emit("input:placeholder", "");
      const normalized = value.trim().toLowerCase();
      if (normalized === "y" || normalized === "yes") {
        await onConfirm();
        return;
      }
      bus.emit("output:append", "Operação cancelada.");
    },
    onCancel: () => {
      bus.emit("router:capture:stop");
      bus.emit("input:placeholder", "");
      bus.emit("output:append", "Operação cancelada.");
    },
  });
}

function summarizeRefs(notes) {
  const summary = {
    ideia: 0,
    task: 0,
    empty: 0,
    others: 0,
  };
  const refCounts = new Map();

  notes.forEach((note) => {
    const normalized = normalizeRef(note.ref);
    const kind = getNoteKind(note);
    if (!normalized) {
      summary.empty += 1;
      return;
    }
    if (kind === "ideia") {
      summary.ideia += 1;
    } else if (kind === "task") {
      summary.task += 1;
    } else {
      summary.others += 1;
    }
    refCounts.set(normalized, (refCounts.get(normalized) ?? 0) + 1);
  });

  return { summary, refCounts };
}

function emitRefSummary(bus, summary) {
  bus.emit("output:append", "REF SUMMARY:");
  bus.emit("output:append", `ideia: ${summary.ideia}`);
  bus.emit("output:append", `task: ${summary.task}`);
  bus.emit("output:append", `empty: ${summary.empty}`);
  bus.emit("output:append", `others: ${summary.others}`);
}

function emitRefList(bus, entries, title) {
  bus.emit("output:append", title);
  if (entries.length === 0) {
    bus.emit("output:append", "(nenhuma ref encontrada)");
    return;
  }
  entries.forEach(([ref, count]) => {
    bus.emit("output:append", `"${ref}": ${count}`);
  });
}

async function updateNoteRef({ bus, id, refValue }) {
  const { client, error } = getSupabaseClient();
  if (error || !client) {
    bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
    return { ok: false };
  }

  const user = await getAuthenticatedUser(bus, client);
  if (!user) return { ok: false };

  const { data, error: updateError } = await client
    .from("notes")
    .update({ ref: refValue || null })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");

  if (updateError) {
    bus.emit("output:append", `Erro ao atualizar ref: ${updateError.message}`);
    return { ok: false };
  }

  if (!data || data.length === 0) {
    bus.emit("output:append", "Nenhuma nota encontrada para atualizar ref.");
    return { ok: false };
  }

  bus.emit("graph:refresh");
  return { ok: true };
}

async function deleteNoteById({ bus, client, userId, id }) {
  clearDeleteBySubjectState();
  const { data, error: deleteError } = await client
    .from("notes")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");

  if (deleteError) {
    bus.emit("output:append", `Erro ao deletar nota: ${deleteError.message}`);
    return false;
  }

  if (!data || data.length === 0) {
    bus.emit("output:append", "Nenhuma nota encontrada para deletar.");
    return false;
  }

  bus.emit("output:append", `Nota ${id} removida.`);
  bus.emit("graph:refresh");
  return true;
}

async function deleteRelationsForNotes({ bus, client, userId, noteIds }) {
  if (!noteIds.length) return 0;
  const ids = noteIds.join(",");
  const { data, error } = await client
    .from("note_relations")
    .delete()
    .eq("user_id", userId)
    .or(`from_note_id.in.(${ids}),to_note_id.in.(${ids})`)
    .select("from_note_id");

  if (error) {
    bus.emit("output:append", `Erro ao remover relações: ${error.message}`);
    return 0;
  }

  return data?.length ?? 0;
}

async function handleDeleteBySubject({ bus, client, user, subject }) {
  clearExpiredDeleteBySubject(bus);
  clearDeleteBySubjectState();

  const { data, error } = await client
    .from("notes")
    .select("id,subject,created_at")
    .eq("subject", subject)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    bus.emit("output:append", `Erro ao buscar notas: ${error.message}`);
    return;
  }

  if (!data || data.length === 0) {
    bus.emit("output:append", `Nenhuma nota encontrada para subject "${subject}".`);
    return;
  }

  const preview = data.slice(0, DELETE_PREVIEW_LIMIT);
  bus.emit(
    "output:append",
    `Você está prestes a deletar ${data.length} notas com subject "${subject}". Isso é irreversível.`
  );
  bus.emit("output:append", "Preview:");
  preview.forEach((note) => {
    const created = formatDateTime(note.created_at ?? "");
    bus.emit("output:append", `- ${created} | ${formatShortId(note.id)}`);
  });
  if (data.length > preview.length) {
    bus.emit("output:append", `...e mais ${data.length - preview.length} notas.`);
  }

  bus.emit("output:append", `Digite: CONFIRM DELETE subject="${subject}"`);
  setDeleteBySubjectState({ subject, noteIds: data.map((note) => note.id) });
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
    const ref = normalizeRef(pairs.ref);

    if (!subject || !moment || !body) {
      bus.emit(
        "output:append",
        "Uso: INSERT NOTE subject=\"...\" moment=\"...\" body=\"...\" [ref=\"...\"]"
      );
      return;
    }

    const { data, error: insertError } = await insertNote({
      client,
      userId: user.id,
      subject,
      moment,
      body,
      ref,
    });

    if (insertError) {
      bus.emit("output:append", `Erro ao inserir nota: ${insertError.message}`);
      const hint = getBodyColumnMigrationHint(insertError);
      if (hint) {
        bus.emit("output:append", hint);
      }
      return;
    }

    bus.emit("output:append", `Nota criada com id ${data?.id ?? "(desconhecido)"}.`);
  };
}

export function selectNoteCommand(bus, focusManager) {
  return async ({ raw = "" } = {}) => {
    if (!ensureNoteKeyword(bus, raw, "SELECT")) return;

    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(bus, client);
    if (!user) return;

    const explicitFields = mergeRequestedFields(
      parseSelectFields(raw),
      parseShowFields(raw)
    );
    const requestedFields = resolveSelectFields(bus, explicitFields);
    if (!requestedFields) return;
    const showRef = explicitFields?.includes("ref") ?? false;

    const { conditions, error: whereError } = parseWhereClause(raw);
    if (whereError) {
      bus.emit("output:append", whereError);
      return;
    }

    if (conditions.length === 0) {
      const focusId = focusManager?.getFocusNoteId?.();
      if (focusId) {
        const focusSubject = focusManager?.getFocusSubject?.() ?? "sem assunto";
        bus.emit("output:append", `Focus ativo: ${focusSubject} (${focusId}).`);
      }
    }

    const baseFields = ["id", "subject", "moment", "body", "created_at", "ref"];
    const selectFields = Array.from(new Set([...requestedFields, ...baseFields]));

    let query = client
      .from("notes")
      .select(selectFields.join(","))
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
      clear();
      return;
    }

    renderNotesOutput(bus, data, { showRef });
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
      if (key === "ref") {
        updates[key] = normalizeRef(value);
      } else {
        updates[key] = value.trim();
      }
    }

    if (Object.keys(updates).length === 0) {
      bus.emit("output:append", "Nenhum campo válido para atualizar.");
      return;
    }

    const { data, error: updateError } = await client
      .from("notes")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id");

    if (updateError) {
      bus.emit("output:append", `Erro ao atualizar nota: ${updateError.message}`);
      const hint = getBodyColumnMigrationHint(updateError);
      if (hint) {
        bus.emit("output:append", hint);
      }
      return;
    }

    if (!data || data.length === 0) {
      bus.emit("output:append", "Nenhuma nota encontrada para atualizar.");
      return;
    }

    bus.emit("output:append", `Nota ${id} atualizada.`);
  };
}

export function setRefCommand(bus) {
  return async ({ raw = "" } = {}) => {
    const match = raw.match(/^setref\s+("([^"]+)"|(\S+))\s+(\S+)/i);
    if (!match) {
      bus.emit("output:append", 'Uso: setref "<id>" ideia|task|clear');
      return;
    }

    const id = match[2] ?? match[3];
    const value = match[4]?.toLowerCase();
    if (!id || !value) {
      bus.emit("output:append", 'Uso: setref "<id>" ideia|task|clear');
      return;
    }

    let refValue = "";
    if (value === "clear") {
      refValue = "";
    } else if (isIdeaOrTask(value)) {
      refValue = normalizeRef(value);
    } else {
      bus.emit("output:append", 'Uso: setref "<id>" ideia|task|clear');
      return;
    }

    const result = await updateNoteRef({ bus, id, refValue });
    if (!result.ok) return;

    bus.emit("output:append", `Ref da nota ${id} atualizada.`);
  };
}

export function refsCommand(bus) {
  return async ({ raw = "" } = {}) => {
    const normalized = raw.trim();
    if (!normalized.toLowerCase().startsWith("refs")) {
      bus.emit("output:append", "Uso: refs [--kinds|\"texto\"]");
      return;
    }

    const isKinds = /^refs\s+--kinds\b/i.test(normalized);
    let filter = null;
    if (!isKinds) {
      const filterMatch = normalized.match(/^refs\s+(.+)$/i);
      if (filterMatch) {
        filter = stripQuotes(filterMatch[1]).trim() || null;
      }
    }

    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(bus, client);
    if (!user) return;

    const { data, error: selectError } = await client
      .from("notes")
      .select("ref")
      .eq("user_id", user.id);

    if (selectError) {
      bus.emit("output:append", `Erro ao listar refs: ${selectError.message}`);
      return;
    }

    const notes = data ?? [];
    if (notes.length === 0) {
      bus.emit("output:append", "Nenhuma nota encontrada.");
      return;
    }

    const { summary, refCounts } = summarizeRefs(notes);
    emitRefSummary(bus, summary);

    if (isKinds) {
      return;
    }

    const filterLower = filter ? filter.toLowerCase() : null;
    const entries = Array.from(refCounts.entries())
      .filter(([ref]) => (!filterLower ? true : ref.toLowerCase().includes(filterLower)))
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      });

    const title = filter ? `REFS MATCHING "${filter}"` : "TOP REFS:";
    emitRefList(bus, entries, title);
  };
}

export function markCommand(bus) {
  return async ({ raw = "" } = {}) => {
    const match = raw.match(/^mark\s+(\d+)\s+(\S+)/i);
    if (!match) {
      bus.emit("output:append", "Uso: mark <index> ideia|task|clear");
      return;
    }

    const index = Number.parseInt(match[1], 10);
    const value = match[2]?.toLowerCase();
    const lastSelect = getLastSelect();
    if (!lastSelect.length || Number.isNaN(index)) {
      bus.emit("output:append", "ERR :: Invalid index. Run SELECT NOTE first.");
      return;
    }

    const target = lastSelect.find((entry) => entry.idx === index);
    if (!target?.id) {
      bus.emit("output:append", "ERR :: Invalid index. Run SELECT NOTE first.");
      return;
    }

    let refValue = "";
    if (value === "clear") {
      refValue = "";
    } else if (isIdeaOrTask(value)) {
      refValue = normalizeRef(value);
    } else {
      bus.emit("output:append", "Uso: mark <index> ideia|task|clear");
      return;
    }

    const result = await updateNoteRef({ bus, id: target.id, refValue });
    if (!result.ok) return;

    bus.emit("output:append", `OK :: Ref atualizada para ${formatSelectIndex(index)}.`);

    const lastList = getLastList();
    if (lastList.length > 0) {
      const updated = lastList.map((note, idx) =>
        idx + 1 === index ? { ...note, ref: refValue || null } : note
      );
      const { showRef } = getLastSelectMeta();
      bus.emit("output:append", "Tabela atualizada:");
      renderNotesOutput(bus, updated, { showRef });
    }
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

    if (clearExpiredDeleteBySubject(bus)) {
      return;
    }

    const pairs = parseKeyValuePairs(raw);
    const subject = pairs.subject?.trim();
    const id = pairs.id?.trim();

    if (subject && !id) {
      await handleDeleteBySubject({ bus, client, user, subject });
      return;
    }

    clearDeleteBySubjectState();

    if (!id) {
      bus.emit("output:append", "Uso: DELETE NOTE id=\"...\" | DELETE NOTE subject=\"...\"");
      return;
    }

    startConfirmPrompt(bus, {
      message: `Deletar nota ${id}? (y/n)`,
      onConfirm: async () => {
        await deleteNoteById({ bus, client, userId: user.id, id });
      },
    });
  };
}

export function confirmDeleteCommand(bus) {
  return async ({ raw = "" } = {}) => {
    const normalized = raw.trim();
    if (!normalized.toUpperCase().startsWith("CONFIRM DELETE")) {
      bus.emit("output:append", "Uso: CONFIRM DELETE subject=\"...\"");
      return;
    }

    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(bus, client);
    if (!user) return;

    const pairs = parseKeyValuePairs(raw);
    const subject = pairs.subject?.trim();
    if (!subject) {
      bus.emit("output:append", "Uso: CONFIRM DELETE subject=\"...\"");
      return;
    }

    const state = getDeleteBySubjectState();
    if (!state.pending) {
      bus.emit("output:append", "Nenhuma deleção pendente.");
      return;
    }

    if (isDeleteBySubjectExpired(state)) {
      clearDeleteBySubjectState();
      bus.emit("output:append", "Confirmação expirada. Rode novamente o DELETE NOTE subject=\"...\".");
      return;
    }

    if (state.subject !== subject) {
      bus.emit(
        "output:append",
        `Nenhuma confirmação pendente para subject "${subject}".`
      );
      return;
    }

    const noteIds = state.noteIds;
    clearDeleteBySubjectState();

    if (!noteIds.length) {
      bus.emit("output:append", "Nenhuma nota encontrada para deletar.");
      return;
    }

    const { data, error: deleteError } = await client
      .from("notes")
      .delete()
      .in("id", noteIds)
      .eq("user_id", user.id)
      .select("id");

    if (deleteError) {
      bus.emit("output:append", `Erro ao deletar notas: ${deleteError.message}`);
      return;
    }

    const deletedCount = data?.length ?? 0;
    const relationsDeleted = await deleteRelationsForNotes({
      bus,
      client,
      userId: user.id,
      noteIds,
    });

    bus.emit(
      "output:append",
      `Notas deletadas: ${deletedCount} | Relações removidas: ${relationsDeleted}`
    );
    bus.emit("graph:refresh");
  };
}
