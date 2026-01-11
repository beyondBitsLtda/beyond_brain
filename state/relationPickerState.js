let relationPickerState = {
  active: false,
  fromNoteId: null,
  fromSubject: "",
};

export function startRelationPicker({ fromNoteId, fromSubject }) {
  relationPickerState = {
    active: true,
    fromNoteId,
    fromSubject: fromSubject ?? "",
  };
}

export function clearRelationPicker() {
  relationPickerState = {
    active: false,
    fromNoteId: null,
    fromSubject: "",
  };
}

export function getRelationPickerState() {
  return { ...relationPickerState };
}

export function isRelationPickerActive() {
  return relationPickerState.active;
}
