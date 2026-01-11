let relationWeightAvailable = null;
let relationConfidenceAvailable = null;

let warnedRelationWeight = false;
let warnedRelationConfidence = false;

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
