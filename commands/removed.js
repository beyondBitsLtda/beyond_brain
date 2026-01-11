export function removedCommand(bus) {
  return () => {
    bus.emit("output:append", "Comando removido.");
  };
}
