export async function fetchProfile(client, userId) {
  const { data, error } = await client
    .from("profiles")
    .select("username")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return { profile: null, error };
  }

  return { profile: data ?? null, error: null };
}

export async function createProfile(client, { userId, username }) {
  const trimmedUsername = username?.trim();
  const payload = {
    id: userId,
    username: trimmedUsername,
  };

  const { error, data } = await client
    .from("profiles")
    .insert(payload)
    .select()
    .eq("id", userId)
    .maybeSingle();
  return { profile: data ?? null, error };
}
