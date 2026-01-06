import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as supabaseConfig from "./config.js";

let client = null;
let clientInitError = null;

const SUPABASE_URL = supabaseConfig.SUPABASE_URL;
const SUPABASE_ANON_KEY = supabaseConfig.SUPABASE_ANON_KEY;
const hasSupabasePlaceholders =
  supabaseConfig.hasSupabasePlaceholders ??
  (() => {
    const placeholders = ["COLOQUE_SUA_SUPABASE_URL", "COLOQUE_SEU_SUPABASE_ANON_KEY"];
    return (
      placeholders.includes(SUPABASE_URL) || placeholders.includes(SUPABASE_ANON_KEY)
    );
  });

function hasValidCredentials() {
  if (hasSupabasePlaceholders()) return false;
  return Boolean(SUPABASE_URL?.trim() && SUPABASE_ANON_KEY?.trim());
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
