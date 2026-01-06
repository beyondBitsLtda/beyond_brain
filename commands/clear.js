export function clearCommand(bus) {
  return () => {
    bus.emit("output:clear");
  };
}
