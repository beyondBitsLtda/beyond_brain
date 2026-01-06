import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as supabaseConfig from "./config.js";

let client = null;
let clientInitError = null;

const hasSupabasePlaceholders =
  supabaseConfig.hasSupabasePlaceholders ??
  ((url, key) => {
    const placeholders = ["COLOQUE_SUA_SUPABASE_URL", "COLOQUE_SEU_SUPABASE_ANON_KEY"];
    return placeholders.includes(url) || placeholders.includes(key);
  });

function getCredentialStatus() {
  const rawUrl = supabaseConfig.SUPABASE_URL;
  const rawKey = supabaseConfig.SUPABASE_ANON_KEY;

  const trimmedUrl = rawUrl?.trim?.() ?? "";
  const trimmedKey = rawKey?.trim?.() ?? "";
  const missingExport = typeof rawUrl === "undefined" || typeof rawKey === "undefined";
  const hasPlaceholders = hasSupabasePlaceholders(trimmedUrl, trimmedKey);

  const errors = [];
  if (missingExport) {
    errors.push("As constantes SUPABASE_URL e SUPABASE_ANON_KEY precisam ser exportadas em config.js");
  }
  if (!trimmedUrl) errors.push("SUPABASE_URL está vazio");
  if (!trimmedKey) errors.push("SUPABASE_ANON_KEY está vazio");
  if (!missingExport && hasPlaceholders) errors.push("Substitua os placeholders do config.js pelos valores reais do seu projeto");

  return {
    ok: errors.length === 0,
    errors,
    url: trimmedUrl,
    key: trimmedKey,
  };
}

export function getSupabaseClient() {
  const status = getCredentialStatus();
  if (!status.ok) {
    client = null;
    clientInitError = status.errors.join(" | ");
    return { client: null, error: clientInitError };
  }

  if (client) {
    return { client, error: null };
  }

  try {
    client = createClient(status.url, status.key);
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
