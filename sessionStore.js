const state = {
  user: null,
  profile: null,
};

export function setSession(user, profile) {
  state.user = user ?? null;
  state.profile = profile ?? null;
}

export function clearSession() {
  setSession(null, null);
}

export function getSession() {
  return {
    user: state.user,
    profile: state.profile,
  };
}

export function setProfile(profile) {
  state.profile = profile ?? null;
}

export function getUsernameFallback() {
  const { user, profile } = getSession();
  if (profile?.username) return profile.username;
  return user?.user_metadata?.username ?? user?.email ?? "user";
}
