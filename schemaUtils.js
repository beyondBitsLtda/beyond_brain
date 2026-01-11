let relationWeightAvailable = null;
let relationConfidenceAvailable = null;
let noteIdeaAvailable = null;

let warnedRelationWeight = false;
let warnedRelationConfidence = false;
let warnedNoteIdea = false;

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
  const { error } = await client
    .from("notes")
    .select("is_idea,idea_level,level_set")
    .eq("user_id", userId)
    .limit(1);
  if (error) {
    noteIdeaAvailable = false;
    if (bus && !warnedNoteIdea) {
      warnedNoteIdea = true;
      bus.emit(
        "output:append",
        "Aviso: colunas de ideia não encontradas em notes. Rode a migração para habilitar nodos-ideia."
      );
    }
    return false;
  }
  noteIdeaAvailable = true;
  return true;
}
