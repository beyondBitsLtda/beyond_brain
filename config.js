
// config.js
// Configure as credenciais do Supabase aqui.
// Substitua os valores placeholder pela URL do projeto e pela chave anônima.

export const SUPABASE_URL = "https://wcwikmszduuqlytikjwq.supabase.co";

export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indjd2lrbXN6ZHV1cWx5dGlrandxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc2NjM0MjAsImV4cCI6MjA4MzIzOTQyMH0.vhwQILCuokH7iilCnR7zP35hCWpVGUfFuayfZq-mQco";

// helper para o app saber se está configurado
export function hasSupabaseCreds() {
  return (
    typeof SUPABASE_URL === "string" &&
    SUPABASE_URL.startsWith("http") &&
    typeof SUPABASE_ANON_KEY === "string" &&
    SUPABASE_ANON_KEY.length > 20
  );
}
