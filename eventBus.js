export function createEventBus() {
  const listeners = new Map();

  function on(event, handler) {
    const handlers = listeners.get(event) ?? [];
    handlers.push(handler);
    listeners.set(event, handlers);
    return () => off(event, handler);
  }

  function off(event, handler) {
    const handlers = listeners.get(event);
    if (!handlers) return;
    const next = handlers.filter((fn) => fn !== handler);
    listeners.set(event, next);
  }

  function emit(event, payload) {
    const handlers = listeners.get(event);
    if (!handlers) return;
    handlers.forEach((handler) => handler(payload));
  }

  return { on, off, emit };
}
