import { clearSession } from "./sessionStore.js";

export const MAX_BODY_LENGTH = 300;

export async function getAuthenticatedUser(
  bus,
  client,
  message = "Você precisa estar logado para usar este comando."
) {
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) {
    clearSession();
    if (bus?.emit) {
      bus.emit("output:append", message);
    }
    return null;
  }
  return data.user;
}

export async function insertNote({ client, userId, subject, moment, body, ref }) {
  if (!client || !userId) {
    return { data: null, error: new Error("Missing client or user.") };
  }

  const payload = {
    subject,
    moment,
    body,
    ref: ref || null,
    user_id: userId,
  };

  const { data, error } = await client
    .from("notes")
    .insert(payload)
    .select("id")
    .maybeSingle();

  return { data, error };
}
