const weightState = {
  lastGeneratedAt: null,
  scope: null,
  noteCount: 0,
  suggestions: [],
  appliedIds: [],
};

export function getWeightState() {
  return weightState;
}

export function setWeightState(nextState) {
  weightState.lastGeneratedAt = nextState.lastGeneratedAt ?? null;
  weightState.scope = nextState.scope ?? null;
  weightState.noteCount = nextState.noteCount ?? 0;
  weightState.suggestions = nextState.suggestions ?? [];
  weightState.appliedIds = nextState.appliedIds ?? [];
}

export function clearWeightState() {
  weightState.lastGeneratedAt = null;
  weightState.scope = null;
  weightState.noteCount = 0;
  weightState.suggestions = [];
  weightState.appliedIds = [];
}
