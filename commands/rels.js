import { getSupabaseClient } from "../supabaseClient.js";
import { clearSession } from "../sessionStore.js";

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
  return `- (${rel.type}) ${rel.from} -> ${rel.to}`;
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

    const pairs = parseKeyValuePairs(raw);
    const from = pairs.from?.trim();
    const to = pairs.to?.trim();
    const type = pairs.type?.trim();

    if (!from || !to || !type) {
      bus.emit(
        "output:append",
        "Uso: LINK from=\"uuid\" to=\"uuid\" type=\"...\""
      );
      return;
    }

    const noteCheck = await ensureOwnedNotes(client, user.id, [from, to]);
    if (!noteCheck.ok) {
      bus.emit(
        "output:append",
        "Não é permitido criar relação com nota inexistente ou que pertença a outro usuário."
      );
      return;
    }

    const { data: existing, error: existingError } = await client
      .from("relations")
      .select("id")
      .eq("from", from)
      .eq("to", to)
      .eq("type", type)
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      bus.emit("output:append", `Erro ao verificar relação: ${existingError.message}`);
      return;
    }

    if (existing) {
      bus.emit("output:append", "Essa relação já existe.");
      return;
    }

    const { error: insertError } = await client
      .from("relations")
      .insert({ from, to, type, user_id: user.id });

    if (insertError) {
      bus.emit("output:append", `Erro ao criar relação: ${insertError.message}`);
      return;
    }

    bus.emit("output:append", `Relação criada: (${type}) ${from} -> ${to}`);
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
    const from = pairs.from?.trim();
    const to = pairs.to?.trim();
    const type = pairs.type?.trim();

    if (!from || !to) {
      bus.emit("output:append", "Uso: UNLINK from=\"uuid\" to=\"uuid\"");
      return;
    }

    let query = client
      .from("relations")
      .delete()
      .eq("from", from)
      .eq("to", to)
      .eq("user_id", user.id);
    if (type) {
      query = query.eq("type", type);
    }

    const { data, error: deleteError } = await query.select("id");
    if (deleteError) {
      bus.emit("output:append", `Erro ao remover relação: ${deleteError.message}`);
      return;
    }

    if (!data || data.length === 0) {
      bus.emit("output:append", "Nenhuma relação encontrada para remover.");
      return;
    }

    bus.emit("output:append", `Relação removida (${data.length}).`);
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
        .from("relations")
        .select("from,to,type,created_at")
        .eq("user_id", user.id)
        .or(`from.eq.${noteId},to.eq.${noteId}`)
        .order("created_at", { ascending: false });

      if (relError) {
        bus.emit("output:append", `Erro ao listar relações: ${relError.message}`);
        return;
      }

      if (!data || data.length === 0) {
        bus.emit("output:append", "Nenhuma relação encontrada para esta nota.");
        return;
      }

      const lines = data.map((rel) => {
        const other = rel.from === noteId ? rel.to : rel.from;
        return `- (${rel.type}) ${other}`;
      });

      bus.emit("output:append", `Relações da nota ${noteId}:`);
      lines.forEach((line) => bus.emit("output:append", line));
      return;
    }

    const { data, error: relError } = await client
      .from("relations")
      .select("from,to,type,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (relError) {
      bus.emit("output:append", `Erro ao listar relações: ${relError.message}`);
      return;
    }

    if (!data || data.length === 0) {
      bus.emit("output:append", "Nenhuma relação encontrada.");
      return;
    }

    bus.emit("output:append", "Relações encontradas:");
    data.map(formatRelation).forEach((line) => bus.emit("output:append", line));
  };
}
