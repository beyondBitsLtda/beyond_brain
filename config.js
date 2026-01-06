// config.js
// Configure as credenciais do Supabase aqui.
// Substitua os valores placeholder pela URL do projeto e pela chave anônima.

export const SUPABASE_URL = "https://wcwikmszduuqlytikjwq.supabase.co";

export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indjd2lrbXN6ZHV1cWx5dGlrandxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc2NjM0MjAsImV4cCI6MjA4MzIzOTQyMH0.vhwQILCuokH7iilCnR7zP35hCWpVGUfFuayfZq-mQco";

export function hasSupabasePlaceholders() {
  return (
    SUPABASE_URL.includes("COLOQUE_") ||
    SUPABASE_ANON_KEY.includes("COLOQUE_")
  );
}
