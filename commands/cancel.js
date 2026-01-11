import { clearDeleteBySubjectState } from "../state/deleteBySubjectState.js";

export function cancelCommand(bus) {
  return () => {
    clearDeleteBySubjectState();
    bus.emit("connect:cancel");
    bus.emit("output:append", "Operação cancelada.");
  };
}
