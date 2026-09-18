const KEYBOARD_EVENTS = ["keydown", "keypress", "keyup"];

export function containKeyboardEvents(host: HTMLElement): void {
  function stopKeyboardPropagation(event: Event): void {
    event.stopPropagation();
  }

  for (const eventType of KEYBOARD_EVENTS) {
    host.addEventListener(eventType, stopKeyboardPropagation, false);
  }
}
