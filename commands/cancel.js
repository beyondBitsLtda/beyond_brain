import { clearDeleteBySubjectState } from "../state/deleteBySubjectState.js";
import { clearRelationPicker } from "../state/relationPickerState.js";

export function cancelCommand(bus) {
  return () => {
    clearDeleteBySubjectState();
    clearRelationPicker();
    bus.emit("connect:cancel");
    bus.emit("output:append", "Operação cancelada.");
  };
}
