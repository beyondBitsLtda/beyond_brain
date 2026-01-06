// Configure as credenciais do Supabase aqui.
// Substitua os valores placeholder pela URL do projeto e pela chave anônima.
export const SUPABASE_URL = "COLOQUE_SUA_SUPABASE_URL";
export const SUPABASE_ANON_KEY = "COLOQUE_SEU_SUPABASE_ANON_KEY";

export function hasSupabasePlaceholders() {
  const placeholders = ["COLOQUE_SUA_SUPABASE_URL", "COLOQUE_SEU_SUPABASE_ANON_KEY"];
  return placeholders.includes(SUPABASE_URL) || placeholders.includes(SUPABASE_ANON_KEY);
}
