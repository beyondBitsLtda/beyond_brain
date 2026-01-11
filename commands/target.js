import { getSupabaseClient } from "../supabaseClient.js";
import { getAuthenticatedUser } from "../notesService.js";
import { getByIndex } from "../state/selectionRegistry.js";
import { clearRelationPicker, getRelationPickerState } from "../state/relationPickerState.js";
import { createRelationModal } from "../ui/relationModal.js";

const relationModal = createRelationModal(document.body);

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

function parseSelectionIndex(value) {
  if (!value) return null;
  const match = value.trim().match(/^#(\d+)$/);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isNaN(index) ? null : index;
}

export function targetCommand(bus) {
  return async ({ args = [] } = {}) => {
    const picker = getRelationPickerState();
    if (!picker.active || !picker.fromNoteId) {
      bus.emit("output:append", "Nenhuma seleção de relação ativa. Use o menu de ações da nota.");
      return;
    }

    const selectionIndex = parseSelectionIndex(args[0] ?? "");
    if (!selectionIndex) {
      bus.emit("output:append", 'Uso: target "#3"');
      return;
    }

    const selected = getByIndex(selectionIndex);
    if (!selected?.id) {
      bus.emit("output:append", "Nota destino inválida.");
      return;
    }

    if (picker.fromNoteId === selected.id) {
      bus.emit("output:append", "Selecione uma nota destino diferente da origem.");
      return;
    }

    const fromNote = {
      id: picker.fromNoteId,
      subject: picker.fromSubject || "(sem assunto)",
    };
    const toNote = {
      id: selected.id,
      subject: selected.subject ?? "(sem assunto)",
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
  };
}
