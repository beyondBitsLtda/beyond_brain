import { getSupabaseClient } from "../supabaseClient.js";
import { clearSession } from "../sessionStore.js";
import { clearDeleteBySubjectState } from "../state/deleteBySubjectState.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const selectionRegex = /^#(\d+)$/;
const lastDisambiguation = {
  from: [],
  to: [],
};
let pendingLink = null;
let relationIdColumnAvailable = null;

function parseQuotedValue(value) {
  if (!value) return "";
  return value.replace(/^"|"$/g, "").trim();
}

function parseKeyValuePairs(raw) {
  const payload = raw.replace(/^\s*\S+\s*/, "");
  const pairs = {};
  const regex = /(\w+)="([^"]*)"/g;
  let match = null;
  while ((match = regex.exec(payload)) !== null) {
    pairs[match[1].toLowerCase()] = match[2].trim();
  }
  return pairs;
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

async function ensureOwnedNotes(client, userId, noteIds) {
  const uniqueIds = [...new Set(noteIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return { ok: false, missing: noteIds };
  }

  const { data, error } = await client
    .from("notes")
    .select("id")
    .in("id", uniqueIds)
    .eq("user_id", userId);

  if (error) {
    return { ok: false, missing: uniqueIds, error };
  }

  const foundIds = new Set((data ?? []).map((note) => note.id));
  const missing = uniqueIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    return { ok: false, missing };
  }

  return { ok: true, missing: [] };
}

function formatRelation(rel) {
  return `- (${rel.type}) ${rel.from_note_id} -> ${rel.to_note_id}`;
}

function formatRelationLabel(rel) {
  const type = rel.type ?? "related";
  return `(${type}) ${rel.from_note_id} -> ${rel.to_note_id}`;
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

async function ensureRelationIdColumn(client, userId) {
  if (relationIdColumnAvailable !== null) {
    return relationIdColumnAvailable;
  }
  const { error } = await client
    .from("note_relations")
    .select("id")
    .eq("user_id", userId)
    .limit(1);
  if (error) {
    relationIdColumnAvailable = false;
    return false;
  }
  relationIdColumnAvailable = true;
  return true;
}

async function deleteRelationByComposite({ bus, client, userId, rel }) {
  let query = client
    .from("note_relations")
    .delete()
    .eq("from_note_id", rel.from_note_id)
    .eq("to_note_id", rel.to_note_id)
    .eq("user_id", userId);
  if (rel.type) {
    query = query.eq("type", rel.type);
  }

  const { data, error: deleteError } = await query.select("from_note_id");
  if (deleteError) {
    bus.emit("output:append", `Erro ao remover relação na note_relations: ${deleteError.message}`);
    return false;
  }

  if (!data || data.length === 0) {
    bus.emit("output:append", "Nenhuma relação encontrada para remover.");
    return false;
  }

  bus.emit("output:append", `Relação removida (${data.length}).`);
  bus.emit("graph:refresh");
  return true;
}

function formatDisambiguationOption(option, index) {
  const createdAt = option.created_at ? ` (${option.created_at})` : "";
  return `[${index + 1}] ${option.subject}${createdAt}`;
}

function normalizeSubject(value) {
  return value.trim().toLowerCase();
}

function isSelection(value) {
  return selectionRegex.test(value.trim());
}

function isSubjectReference(value) {
  const trimmed = value.trim();
  return !isSelection(trimmed) && !UUID_REGEX.test(trimmed);
}

function parseSelectionIndex(value) {
  const match = selectionRegex.exec(value.trim());
  if (!match) return null;
  const selectionIndex = Number(match[1]);
  if (Number.isNaN(selectionIndex)) return null;
  return selectionIndex;
}

async function fetchNotesBySubject(client, userId, subject) {
  const { data, error } = await client
    .from("notes")
    .select("id,subject,created_at")
    .eq("subject", subject)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    return { error };
  }

  return { data: data ?? [] };
}

async function createRelation({
  client,
  userId,
  fromId,
  toId,
  type,
  bus,
}) {
  if (fromId === toId) {
    bus.emit("output:append", "Não é permitido criar relação da nota com ela mesma.");
    return;
  }

  const noteCheck = await ensureOwnedNotes(client, userId, [fromId, toId]);
  if (!noteCheck.ok) {
    bus.emit(
      "output:append",
      "Não é permitido criar relação com nota inexistente ou que pertença a outro usuário."
    );
    return;
  }

  const { data: existing, error: existingError } = await client
    .from("note_relations")
    .select("id")
    .eq("from_note_id", fromId)
    .eq("to_note_id", toId)
    .eq("type", type)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    bus.emit("output:append", `Erro ao verificar relação na note_relations: ${existingError.message}`);
    return;
  }

  if (existing) {
    bus.emit("output:append", "Essa relação já existe.");
    return;
  }

  const { error: insertError } = await client
    .from("note_relations")
    .insert({
      from_note_id: fromId,
      to_note_id: toId,
      type,
      user_id: userId,
    });

  if (insertError) {
    if (insertError.code === "23505") {
      bus.emit("output:append", "Essa relação já existe.");
      return;
    }
    bus.emit("output:append", `Erro ao criar relação na note_relations: ${insertError.message}`);
    return;
  }

  bus.emit("output:append", `Relação criada: (${type}) ${fromId} -> ${toId}`);
  bus.emit("graph:refresh");
}

async function resolveNoteReference({
  input,
  client,
  userId,
  bus,
  disambiguation,
  label,
}) {
  if (!input) {
    bus.emit("output:append", `Parâmetro ${label} ausente.`);
    return null;
  }

  const trimmed = input.trim();
  const selectionMatch = selectionRegex.exec(trimmed);
  if (selectionMatch) {
    const selectionIndex = Number(selectionMatch[1]);
    const options = disambiguation[label] ?? [];
    if (!options.length) {
      bus.emit(
        "output:append",
        `Nenhuma seleção disponível para ${label}. Informe o subject para gerar opções.`
      );
      return null;
    }
    if (Number.isNaN(selectionIndex) || selectionIndex < 1 || selectionIndex > options.length) {
      bus.emit(
        "output:append",
        `Seleção inválida para ${label}. Use ${label}="#1" até ${label}="#${options.length}".`
      );
      return null;
    }
    const selected = options[selectionIndex - 1];
    return { id: selected.id, subject: selected.subject };
  }

  if (UUID_REGEX.test(trimmed)) {
    return { id: trimmed, subject: trimmed };
  }

  const { data, error } = await client
    .from("notes")
    .select("id,subject,created_at")
    .eq("subject", trimmed)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    bus.emit("output:append", `Erro ao buscar nota por subject: ${error.message}`);
    return null;
  }

  if (!data || data.length === 0) {
    bus.emit("output:append", `Nota não encontrada para subject: ${trimmed}`);
    return null;
  }

  if (data.length === 1) {
    return { id: data[0].id, subject: data[0].subject };
  }

  disambiguation[label] = data;
  bus.emit("output:append", `Mais de uma nota encontrada para subject: ${trimmed}`);
  data
    .map((option, index) => formatDisambiguationOption(option, index))
    .forEach((line) => bus.emit("output:append", line));
  bus.emit(
    "output:append",
    `Use LINK ${label}="#1" ... para selecionar.`
  );
  return null;
}

export function linkCommand(bus) {
  return async ({ raw = "" } = {}) => {
    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(bus, client);
    if (!user) return;

    if (pendingLink) {
      const trimmed = raw.trim();
      if (trimmed.toLowerCase() === "cancel") {
        pendingLink = null;
        bus.emit("output:append", "Operação de LINK cancelada.");
        return;
      }

      const pairs = parseKeyValuePairs(raw);
      const stage = pendingLink.stage;
      const options = pendingLink.options ?? [];
      const selectionSource = stage === "pick_from"
        ? (pairs.from?.trim() || trimmed)
        : (pairs.to?.trim() || trimmed);
      const selectionIndex = parseSelectionIndex(selectionSource);
      if (!selectionIndex || selectionIndex < 1 || selectionIndex > options.length) {
        const label = stage === "pick_from" ? "from" : "to";
        bus.emit(
          "output:append",
          `Seleção inválida para ${label}. Use #1 até #${options.length} ou "cancel".`
        );
        return;
      }

      const selected = options[selectionIndex - 1];
      if (stage === "pick_from") {
        pendingLink.fromSelectedId = selected.id;
        pendingLink.stage = "pick_to";
        bus.emit("output:append", "Selecione o destino (to) com #N:");
        return;
      }

      const fromId = pendingLink.fromSelectedId;
      if (!fromId) {
        pendingLink = null;
        bus.emit("output:append", "Seleção de origem perdida. Inicie o LINK novamente.");
        return;
      }
      if (fromId === selected.id) {
        bus.emit("output:append", "Não é permitido criar relação da nota com ela mesma.");
        bus.emit("output:append", "Selecione um destino (to) diferente com #N:");
        return;
      }

      const type = pendingLink.type;
      pendingLink = null;
      await createRelation({
        client,
        userId: user.id,
        fromId,
        toId: selected.id,
        type,
        bus,
      });
      return;
    }

    const pairs = parseKeyValuePairs(raw);
    const from = pairs.from?.trim();
    const to = pairs.to?.trim();
    const type = pairs.type?.trim();

    if (!from || !to || !type) {
      bus.emit(
        "output:append",
        "Uso: LINK from=\"uuid|subject\" to=\"uuid|subject\" type=\"...\""
      );
      return;
    }

    if (isSubjectReference(from) && isSubjectReference(to)) {
      const normalizedFrom = normalizeSubject(from);
      const normalizedTo = normalizeSubject(to);
      if (normalizedFrom === normalizedTo) {
        const { data, error: fetchError } = await fetchNotesBySubject(
          client,
          user.id,
          from
        );
        if (fetchError) {
          bus.emit("output:append", `Erro ao buscar nota por subject: ${fetchError.message}`);
          return;
        }

        if (!data || data.length === 0) {
          bus.emit("output:append", `Nota não encontrada para subject: ${from}`);
          return;
        }

        if (data.length === 1) {
          bus.emit("output:append", "Não é permitido LINK da nota para ela mesma.");
          return;
        }

        if (data.length === 2) {
          const [oldest, newest] = data;
          bus.emit(
            "output:append",
            `Resolvido automaticamente: from=#1 (mais antiga) -> to=#2 (mais recente).`
          );
          await createRelation({
            client,
            userId: user.id,
            fromId: oldest.id,
            toId: newest.id,
            type,
            bus,
          });
          return;
        }

        bus.emit(
          "output:append",
          `Foram encontradas ${data.length} notas com o subject "${from}". Escolha a ORIGEM e o DESTINO:`
        );
        data
          .map((option, index) => formatDisambiguationOption(option, index))
          .forEach((line) => bus.emit("output:append", line));
        bus.emit("output:append", "Selecione a origem (from) com #N:");
        pendingLink = {
          type,
          subject: from,
          options: data,
          stage: "pick_from",
          fromSelectedId: null,
        };
        return;
      }
    }

    const resolvedFrom = await resolveNoteReference({
      input: from,
      client,
      userId: user.id,
      bus,
      disambiguation: lastDisambiguation,
      label: "from",
    });
    if (!resolvedFrom) return;

    const resolvedTo = await resolveNoteReference({
      input: to,
      client,
      userId: user.id,
      bus,
      disambiguation: lastDisambiguation,
      label: "to",
    });
    if (!resolvedTo) return;

    await createRelation({
      client,
      userId: user.id,
      fromId: resolvedFrom.id,
      toId: resolvedTo.id,
      type,
      bus,
    });
  };
}

export function unlinkCommand(bus) {
  return async ({ raw = "" } = {}) => {
    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(bus, client);
    if (!user) return;

    const pairs = parseKeyValuePairs(raw);
    const id = pairs.id?.trim();
    const from = pairs.from?.trim();
    const to = pairs.to?.trim();
    const type = pairs.type?.trim();

    clearDeleteBySubjectState();

    if (id) {
      const hasId = await ensureRelationIdColumn(client, user.id);
      if (!hasId) {
        bus.emit("output:append", "A coluna id não está disponível. Use UNLINK from=\"...\" to=\"...\".");
        return;
      }
      startConfirmPrompt(bus, {
        message: `Deletar relação ${id}? (y/n)`,
        onConfirm: async () => {
          const { data, error: deleteError } = await client
            .from("note_relations")
            .delete()
            .eq("id", id)
            .eq("user_id", user.id)
            .select("id");

          if (deleteError) {
            bus.emit("output:append", `Erro ao remover relação na note_relations: ${deleteError.message}`);
            return;
          }

          if (!data || data.length === 0) {
            bus.emit("output:append", "Nenhuma relação encontrada para remover.");
            return;
          }

          bus.emit("output:append", `Relação removida (${data.length}).`);
          bus.emit("graph:refresh");
        },
      });
      return;
    }

    if (!from || !to) {
      bus.emit("output:append", "Uso: UNLINK from=\"uuid\" to=\"uuid\" [type=\"...\"] | UNLINK id=\"uuid\"");
      return;
    }

    startConfirmPrompt(bus, {
      message: `Deletar relação (${type ?? "related"}) ${from} -> ${to}? (y/n)`,
      onConfirm: async () => {
        await deleteRelationByComposite({
          bus,
          client,
          userId: user.id,
          rel: { from_note_id: from, to_note_id: to, type },
        });
      },
    });
  };
}

export function relsCommand(bus) {
  return async ({ args = [], raw = "" } = {}) => {
    const { client, error } = getSupabaseClient();
    if (error || !client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(bus, client);
    if (!user) return;

    if (args[0] === "note") {
      const noteId = parseQuotedValue(args[1] ?? "");
      if (!noteId) {
        bus.emit("output:append", "Uso: rels note \"uuid\"");
        return;
      }

      const noteCheck = await ensureOwnedNotes(client, user.id, [noteId]);
      if (!noteCheck.ok) {
        bus.emit("output:append", "Nota não encontrada ou sem permissão.");
        return;
      }

      const { data, error: relError } = await client
        .from("note_relations")
        .select("from_note_id,to_note_id,type")
        .eq("user_id", user.id)
        .or(`from_note_id.eq.${noteId},to_note_id.eq.${noteId}`)
        .order("id", { ascending: false });

      if (relError) {
        bus.emit("output:append", `Erro ao listar relações na note_relations: ${relError.message}`);
        return;
      }

      if (!data || data.length === 0) {
        bus.emit("output:append", "Nenhuma relação encontrada para esta nota.");
        return;
      }

      const lines = data.map((rel) => {
        const other = rel.from_note_id === noteId ? rel.to_note_id : rel.from_note_id;
        return {
          rel,
          text: `- (${rel.type}) ${other}`,
        };
      });

      bus.emit("output:append", `Relações da nota ${noteId}:`);
      lines.forEach(({ rel, text }) =>
        bus.emit("output:append", {
          text,
          className: "terminal__line--clickable",
          data: {
            fromNoteId: rel.from_note_id,
            toNoteId: rel.to_note_id,
            relType: rel.type,
          },
          contextMenu: {
            items: [
              {
                label: "Deletar relação",
                danger: true,
                action: async () => {
                  startConfirmPrompt(bus, {
                    message: `Deletar relação ${formatRelationLabel(rel)}? (y/n)`,
                    onConfirm: async () => {
                      await deleteRelationByComposite({
                        bus,
                        client,
                        userId: user.id,
                        rel,
                      });
                    },
                  });
                },
              },
            ],
          },
        })
      );
      return;
    }

    const { data, error: relError } = await client
      .from("note_relations")
      .select("from_note_id,to_note_id,type")
      .eq("user_id", user.id)
      .order("id", { ascending: false });

    if (relError) {
      bus.emit("output:append", `Erro ao listar relações na note_relations: ${relError.message}`);
      return;
    }

    if (!data || data.length === 0) {
      bus.emit("output:append", "Nenhuma relação encontrada.");
      return;
    }

    bus.emit("output:append", "Relações encontradas:");
    data.forEach((rel) => {
      bus.emit("output:append", {
        text: formatRelation(rel),
        className: "terminal__line--clickable",
        data: {
          fromNoteId: rel.from_note_id,
          toNoteId: rel.to_note_id,
          relType: rel.type,
        },
        contextMenu: {
          items: [
            {
              label: "Deletar relação",
              danger: true,
              action: async () => {
                startConfirmPrompt(bus, {
                  message: `Deletar relação ${formatRelationLabel(rel)}? (y/n)`,
                  onConfirm: async () => {
                    await deleteRelationByComposite({
                      bus,
                      client,
                      userId: user.id,
                      rel,
                    });
                  },
                });
              },
            },
          ],
        },
      });
    });
  };
}
