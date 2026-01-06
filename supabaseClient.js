import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, hasSupabasePlaceholders } from "./config.js";

let client = null;
let clientInitError = null;

function hasValidCredentials() {
  if (hasSupabasePlaceholders()) return false;
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function getSupabaseClient() {
  if (!hasValidCredentials()) {
    client = null;
    clientInitError =
      "Credenciais do Supabase não configuradas. Edite config.js para definir SUPABASE_URL e SUPABASE_ANON_KEY.";
    return { client: null, error: clientInitError };
  }

  if (client) {
    return { client, error: null };
  }

  try {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    clientInitError = null;
    return { client, error: null };
  } catch (error) {
    client = null;
    clientInitError = error;
    return { client: null, error: clientInitError };
  }
}

export function getSupabaseInitError() {
  return clientInitError;
}
