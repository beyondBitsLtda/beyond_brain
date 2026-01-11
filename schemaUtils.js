let relationWeightAvailable = null;
let relationConfidenceAvailable = null;
let noteIdeaAvailable = null;
let noteLevelSetAvailable = null;

let warnedRelationWeight = false;
let warnedRelationConfidence = false;
let warnedNoteIdea = false;
let warnedNoteLevelSet = false;
let warnedNoteIdeaSql = false;

const NOTE_IDEA_SQL = [
  "alter table public.notes add column if not exists is_idea boolean not null default false;",
  "alter table public.notes add column if not exists level_set boolean not null default false;",
  "alter table public.notes add column if not exists idea_level integer not null default 1;",
].join("\n");

function reportNoteIdeaSql(bus) {
  if (!bus || warnedNoteIdeaSql) return;
  warnedNoteIdeaSql = true;
  bus.emit("output:append", `Schema notes incompleto. Rode:\n${NOTE_IDEA_SQL}`);
}

export async function ensureRelationWeightColumn({ client, userId, bus } = {}) {
  if (relationWeightAvailable !== null) return relationWeightAvailable;
  if (!client || !userId) return false;
  const { error } = await client
    .from("note_relations")
    .select("weight")
    .eq("user_id", userId)
    .limit(1);
  if (error) {
    relationWeightAvailable = false;
    if (bus && !warnedRelationWeight) {
      warnedRelationWeight = true;
      bus.emit(
        "output:append",
        "Aviso: coluna weight não encontrada em note_relations. Rode a migração para habilitar pesos."
      );
    }
    return false;
  }
  relationWeightAvailable = true;
  return true;
}

export async function ensureRelationConfidenceColumn({ client, userId, bus } = {}) {
  if (relationConfidenceAvailable !== null) return relationConfidenceAvailable;
  if (!client || !userId) return false;
  const { error } = await client
    .from("note_relations")
    .select("confidence")
    .eq("user_id", userId)
    .limit(1);
  if (error) {
    relationConfidenceAvailable = false;
    if (bus && !warnedRelationConfidence) {
      warnedRelationConfidence = true;
      bus.emit(
        "output:append",
        "Aviso: coluna confidence não encontrada em note_relations. Sugestões IA serão salvas sem confiança."
      );
    }
    return false;
  }
  relationConfidenceAvailable = true;
  return true;
}

export async function ensureNoteIdeaColumns({ client, userId, bus } = {}) {
  if (noteIdeaAvailable !== null) return noteIdeaAvailable;
  if (!client || !userId) return false;
  const fullCheck = await client
    .from("notes")
    .select("is_idea,idea_level,level_set")
    .eq("user_id", userId)
    .limit(1);
  if (!fullCheck.error) {
    noteIdeaAvailable = true;
    noteLevelSetAvailable = true;
    return true;
  }

  const partialCheck = await client
    .from("notes")
    .select("is_idea,idea_level")
    .eq("user_id", userId)
    .limit(1);
  if (!partialCheck.error) {
    noteIdeaAvailable = true;
    noteLevelSetAvailable = false;
    if (bus && !warnedNoteLevelSet) {
      warnedNoteLevelSet = true;
      bus.emit(
        "output:append",
        "Aviso: coluna level_set não encontrada em notes. Atualize o schema para habilitar níveis."
      );
    }
    reportNoteIdeaSql(bus);
    return true;
  }

  noteIdeaAvailable = false;
  noteLevelSetAvailable = false;
  if (bus && !warnedNoteIdea) {
    warnedNoteIdea = true;
    bus.emit(
      "output:append",
      "Aviso: colunas de ideia não encontradas em notes. Rode a migração para habilitar nodos-ideia."
    );
  }
  reportNoteIdeaSql(bus);
  return false;
}

export function getNoteIdeaColumnAvailability() {
  return {
    hasIdea: noteIdeaAvailable === true,
    hasLevelSet: noteLevelSetAvailable === true,
  };
}
