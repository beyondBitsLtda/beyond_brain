const IDEA_KIND = "ideia";
const TASK_KIND = "task";

export function normalizeRef(rawRef) {
  if (rawRef === null || rawRef === undefined) return "";
  const trimmed = String(rawRef).trim();
  if (!trimmed) return "";
  const lowered = trimmed.toLowerCase();
  if (lowered === IDEA_KIND || lowered === TASK_KIND) {
    return lowered;
  }
  // Anything outside the core kinds stays as free-form text.
  return trimmed;
}

export function isIdea(value) {
  return normalizeRef(value) === IDEA_KIND;
}

export function isTask(value) {
  return normalizeRef(value) === TASK_KIND;
}

export function getRefKind(note) {
  const normalized = normalizeRef(note?.ref ?? "");
  if (isIdea(normalized) || isTask(normalized)) {
    return normalized;
  }
  return null;
}

export function getNoteKind(note) {
  return getRefKind(note);
}

export function getKindStyle(kind) {
  if (kind === IDEA_KIND) {
    return {
      color: "var(--idea)",
      badge: "[IDEIA]",
      cssClass: "bb-idea bb-badge-idea",
    };
  }
  if (kind === TASK_KIND) {
    return {
      color: "var(--task)",
      badge: "[TASK ]",
      cssClass: "bb-task bb-badge-task",
    };
  }
  return {
    color: "",
    badge: "[----]",
    cssClass: "",
  };
}

export function getRefLabel(note) {
  const normalized = normalizeRef(note?.ref ?? "");
  return normalized || "-";
}
