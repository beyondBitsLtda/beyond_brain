const initialState = {
  active: false,
  awaitingLanguage: false,
  awaitingCategory: false,
  state: "idle",
  mode: "daily",
  difficulty: "normal",
  language: "",
  category: "",
  prompt: "",
  userAnswer: "",
  aiFeedback: "",
  aiExpected: "",
  attemptId: null,
  totalQuestions: 0,
  totalCorrect: 0,
  totalPoints: 0,
};

let session = { ...initialState };

export function getBrainTrainSession() {
  return session;
}

export function startBrainTrainSession({ mode, difficulty, prompt }) {
  session = {
    ...initialState,
    active: true,
    state: "await_answer",
    mode,
    difficulty,
    prompt,
    totalQuestions: 1,
  };
  return session;
}

export function startProgrammingSetup({ mode, difficulty }) {
  session = {
    ...initialState,
    active: true,
    awaitingLanguage: true,
    state: "await_language",
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
    state: "await_category",
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
  };
  return session;
}

export function setBrainTrainAttemptId(attemptId) {
  session = {
    ...session,
    attemptId,
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

export function setBrainTrainState(state) {
  session = {
    ...session,
    state,
  };
  return session;
}

export function recordBrainTrainResult({ isCorrect, points }) {
  session = {
    ...session,
    totalCorrect: session.totalCorrect + (isCorrect ? 1 : 0),
    totalPoints: session.totalPoints + (points ?? 0),
  };
  return session;
}

export function startNextBrainTrainRound({ prompt }) {
  session = {
    ...session,
    prompt,
    userAnswer: "",
    aiFeedback: "",
    aiExpected: "",
    attemptId: null,
    state: "await_answer",
    totalQuestions: session.totalQuestions + 1,
  };
  return session;
}

export function clearBrainTrainSession() {
  session = { ...initialState };
}
