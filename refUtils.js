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
  return trimmed;
}

export function getNoteKind(note) {
  const normalized = normalizeRef(note?.ref ?? "");
  if (normalized === IDEA_KIND || normalized === TASK_KIND) {
    return normalized;
  }
  return null;
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

export function isIdeaOrTask(value) {
  return value === IDEA_KIND || value === TASK_KIND;
}
