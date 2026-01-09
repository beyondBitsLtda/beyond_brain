const session = {
  active: false,
  mode: "fixed",
  targetCount: null,
  currentIndex: 0,
  pool: [],
  usedNoteIds: new Set(),
  currentNote: null,
  currentQuestion: "",
  awaitingAnswer: false,
  history: [],
  lastNoteId: null,
};

export function getPairBrainSession() {
  return session;
}

export function startPairBrainSession({ mode, targetCount, pool }) {
  session.active = true;
  session.mode = mode;
  session.targetCount = targetCount ?? null;
  session.currentIndex = 0;
  session.pool = Array.isArray(pool) ? pool : [];
  session.usedNoteIds = new Set();
  session.currentNote = null;
  session.currentQuestion = "";
  session.awaitingAnswer = false;
  session.history = [];
  session.lastNoteId = null;
}

export function recordPairBrainTurn(entry) {
  session.history.push(entry);
}

export function advancePairBrainIndex() {
  session.currentIndex += 1;
}

export function clearPairBrainSession() {
  session.active = false;
  session.mode = "fixed";
  session.targetCount = null;
  session.currentIndex = 0;
  session.pool = [];
  session.usedNoteIds = new Set();
  session.currentNote = null;
  session.currentQuestion = "";
  session.awaitingAnswer = false;
  session.history = [];
  session.lastNoteId = null;
}
