const EXPIRATION_MS = 2 * 60 * 1000;

let deleteBySubjectState = {
  pending: false,
  subject: "",
  noteIds: [],
  createdAt: 0,
};

export function setDeleteBySubjectState({ subject, noteIds }) {
  deleteBySubjectState = {
    pending: true,
    subject,
    noteIds: Array.isArray(noteIds) ? noteIds.slice() : [],
    createdAt: Date.now(),
  };
}

export function clearDeleteBySubjectState() {
  deleteBySubjectState = {
    pending: false,
    subject: "",
    noteIds: [],
    createdAt: 0,
  };
}

export function getDeleteBySubjectState() {
  return { ...deleteBySubjectState, noteIds: deleteBySubjectState.noteIds.slice() };
}

export function isDeleteBySubjectExpired(state = deleteBySubjectState) {
  if (!state.pending) return false;
  return Date.now() - state.createdAt > EXPIRATION_MS;
}
