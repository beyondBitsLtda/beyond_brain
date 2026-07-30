/**
 * Ingestão do "Beyond Brain".
 *
 * O Beyond Brain guarda as notas na tabela `notes` do MESMO projeto Supabase
 * (colunas: id, user_id, subject, moment, body, ref, created_at).
 * Aqui lemos essas notas e as normalizamos como documentos para indexar no pgvector.
 *
 * Roda com a service role (bypassa RLS), então lê as notas de qualquer usuário.
 * Para um cérebro pessoal, filtre pelo seu usuário com BRAIN_USER_ID (opcional).
 */

import { supabase } from "../supabase.js";

export async function loadBrainDocuments() {
  const userId = (process.env.BRAIN_USER_ID || "").trim();

  let query = supabase
    .from("notes")
    .select("id,user_id,subject,moment,body,ref,created_at")
    .order("created_at", { ascending: false });

  if (userId) query = query.eq("user_id", userId);

  const { data, error } = await query;
  if (error) {
    console.warn(`[brain] falha ao ler notes: ${error.message} — pulando Brain.`);
    return [];
  }

  const docs = (data || []).map((n) => {
    const content = [
      n.subject && `Assunto: ${n.subject}`,
      n.moment && `Momento: ${n.moment}`,
      n.body,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      id: `brain:${n.id}`,
      source: "brain",
      board: n.ref ? `Beyond Brain · ${n.ref}` : "Beyond Brain",
      title: n.subject || "(sem assunto)",
      content,
      url: null,
      last_modified: n.created_at,
      metadata: { ref: n.ref, moment: n.moment, noteId: n.id, userId: n.user_id },
    };
  });

  console.log(`[brain] ${docs.length} notas carregadas da tabela notes.`);
  return docs;
}
