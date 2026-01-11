const ideaState = {
  lastGeneratedAt: null,
  scope: null,
  noteCount: 0,
  suggestions: [],
  appliedIds: [],
};

export function getIdeaState() {
  return ideaState;
}

export function setIdeaState(nextState) {
  ideaState.lastGeneratedAt = nextState.lastGeneratedAt ?? null;
  ideaState.scope = nextState.scope ?? null;
  ideaState.noteCount = nextState.noteCount ?? 0;
  ideaState.suggestions = nextState.suggestions ?? [];
  ideaState.appliedIds = nextState.appliedIds ?? [];
}

export function clearIdeaState() {
  ideaState.lastGeneratedAt = null;
  ideaState.scope = null;
  ideaState.noteCount = 0;
  ideaState.suggestions = [];
  ideaState.appliedIds = [];
}
