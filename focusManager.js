const FOCUS_ID_KEY = "bb_focusNoteId";
const FOCUS_SUBJECT_KEY = "bb_focusNoteSubject";

function readStorageValue(key) {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(key);
}

function writeStorageValue(key, value) {
  if (typeof localStorage === "undefined") return;
  if (value) {
    localStorage.setItem(key, value);
    return;
  }
  localStorage.removeItem(key);
}

export function createFocusManager(bus) {
  let focusNoteId = readStorageValue(FOCUS_ID_KEY);
  let focusSubject = readStorageValue(FOCUS_SUBJECT_KEY);

  function getFocusNoteId() {
    return focusNoteId;
  }

  function getFocusSubject() {
    return focusSubject;
  }

  function getFocusState() {
    return { id: focusNoteId, subject: focusSubject };
  }

  function notifyChange() {
    if (bus) {
      bus.emit("focus:changed", getFocusState());
    }
  }

  function setFocus(noteId, subject) {
    focusNoteId = noteId || null;
    focusSubject = subject || null;
    writeStorageValue(FOCUS_ID_KEY, focusNoteId);
    writeStorageValue(FOCUS_SUBJECT_KEY, focusSubject);
    notifyChange();
  }

  function clearFocus() {
    focusNoteId = null;
    focusSubject = null;
    writeStorageValue(FOCUS_ID_KEY, null);
    writeStorageValue(FOCUS_SUBJECT_KEY, null);
    notifyChange();
  }

  return {
    getFocusNoteId,
    getFocusSubject,
    getFocusState,
    setFocus,
    clearFocus,
  };
}
