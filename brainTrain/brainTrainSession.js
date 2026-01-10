const initialState = {
  active: false,
  awaitingAnswer: false,
  awaitingNote: false,
  mode: "daily",
  difficulty: "normal",
  prompt: "",
  userAnswer: "",
  aiFeedback: "",
  aiExpected: "",
  attemptId: null,
};

let session = { ...initialState };

export function getBrainTrainSession() {
  return session;
}

export function startBrainTrainSession({ mode, difficulty, prompt }) {
  session = {
    ...initialState,
    active: true,
    awaitingAnswer: true,
    mode,
    difficulty,
    prompt,
  };
  return session;
}

export function setBrainTrainAnswer(answer) {
  session = {
    ...session,
    userAnswer: answer,
    awaitingAnswer: false,
  };
  return session;
}

export function setBrainTrainAttemptId(attemptId) {
  session = {
    ...session,
    attemptId,
    awaitingNote: true,
  };
  return session;
}

export function setBrainTrainFeedback({ feedback, expected }) {
  session = {
    ...session,
    aiFeedback: feedback ?? "",
    aiExpected: expected ?? "",
  };
  return session;
}

export function clearBrainTrainSession() {
  session = { ...initialState };
}
