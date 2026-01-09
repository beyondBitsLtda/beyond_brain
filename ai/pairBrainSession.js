const session = {
  active: false,
  notes: [],
  questions: [],
  index: 0,
  phase: "ask",
  lastQuestion: "",
  lastUserAnswer: "",
  history: [],
};

export function getPairBrainSession() {
  return session;
}

export function startPairBrainSession({ notes, questions }) {
  session.active = true;
  session.notes = notes;
  session.questions = questions;
  session.index = 0;
  session.phase = "ask";
  session.lastQuestion = "";
  session.lastUserAnswer = "";
  session.history = [];
}

export function recordPairBrainTurn(entry) {
  session.history.push(entry);
}

export function advancePairBrainIndex() {
  session.index += 1;
}

export function clearPairBrainSession() {
  session.active = false;
  session.notes = [];
  session.questions = [];
  session.index = 0;
  session.phase = "done";
  session.lastQuestion = "";
  session.lastUserAnswer = "";
  session.history = [];
}
