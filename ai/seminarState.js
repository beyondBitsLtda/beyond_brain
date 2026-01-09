const seminarState = {
  lastGeneratedAt: null,
  scope: null,
  noteCount: 0,
  suggestions: [],
  appliedIds: [],
};

export function getSeminarState() {
  return seminarState;
}

export function setSeminarState(nextState) {
  seminarState.lastGeneratedAt = nextState.lastGeneratedAt ?? null;
  seminarState.scope = nextState.scope ?? null;
  seminarState.noteCount = nextState.noteCount ?? 0;
  seminarState.suggestions = nextState.suggestions ?? [];
  seminarState.appliedIds = nextState.appliedIds ?? [];
}

export function clearSeminarState() {
  seminarState.lastGeneratedAt = null;
  seminarState.scope = null;
  seminarState.noteCount = 0;
  seminarState.suggestions = [];
  seminarState.appliedIds = [];
}
