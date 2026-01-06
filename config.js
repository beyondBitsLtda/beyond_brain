// config.js
// Configure as credenciais do Supabase aqui.
// Substitua os valores placeholder pela URL do projeto e pela chave anônima.

export const SUPABASE_URL = "https://wcwikmszduuqlytikjwq.supabase.co";

export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indjd2lrbXN6ZHV1cWx5dGlrandxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc2NjM0MjAsImV4cCI6MjA4MzIzOTQyMH0.vhwQILCuokH7iilCnR7zP35hCWpVGUfFuayfZq-mQco";

export function hasSupabasePlaceholders(url = SUPABASE_URL, key = SUPABASE_ANON_KEY) {
  const normalizedUrl = (url ?? "").trim().toLowerCase();
  const normalizedKey = (key ?? "").trim().toLowerCase();

  const tokens = ["coloque", "your_", "todo", "supabase_url", "supabase_anon_key", "your-project.supabase.co", "your-anon-key"];

  return (
    normalizedUrl === "" ||
    normalizedKey === "" ||
    tokens.some((token) => normalizedUrl.includes(token) || normalizedKey.includes(token))
  );
}
