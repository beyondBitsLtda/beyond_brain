const initialState = {
  active: false,
  awaitingAnswer: false,
  awaitingNote: false,
  awaitingLanguage: false,
  awaitingCategory: false,
  mode: "daily",
  difficulty: "normal",
  language: "",
  category: "",
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

export function startProgrammingSetup({ mode, difficulty }) {
  session = {
    ...initialState,
    active: true,
    awaitingLanguage: true,
    mode,
    difficulty,
  };
  return session;
}

export function setBrainTrainLanguage(language) {
  session = {
    ...session,
    language,
    awaitingLanguage: false,
    awaitingCategory: true,
  };
  return session;
}

export function setBrainTrainCategory(category) {
  session = {
    ...session,
    category,
    awaitingCategory: false,
  };
  return session;
}

export function setBrainTrainContext({ language, category }) {
  session = {
    ...session,
    language: language ?? session.language,
    category: category ?? session.category,
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
