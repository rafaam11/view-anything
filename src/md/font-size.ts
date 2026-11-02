/** Stays inside the setting's range: `parsePreferences` resets anything outside it to the default. */
export function stepMdSize(size: number, delta: number): number {
  return Math.min(24, Math.max(12, size + delta));
}

/** Wheel deltas add up to one step per `threshold` px, so a touchpad's many small ones do not race. */
export function createWheelStepper(threshold = 50): (deltaY: number) => -1 | 0 | 1 {
  let sum = 0;
  return (deltaY) => {
    if (Math.sign(deltaY) !== Math.sign(sum)) sum = 0;
    sum += deltaY;
    if (Math.abs(sum) < threshold) return 0;
    const step = sum < 0 ? 1 : -1; // wheel up enlarges
    sum = 0;
    return step;
  };
}

/** The step for a font size shortcut, 0 for "back to default", null for any other key. */
export function sizeShortcut(e: KeyboardEvent): 1 | -1 | 0 | null {
  if (!e.ctrlKey || e.altKey || e.metaKey) return null;
  // Ctrl++ is Shift+= on most layouts, so Shift only separates the other two keys.
  if (e.key === "=" || e.key === "+" || e.code === "Equal" || e.code === "NumpadAdd") return 1;
  if (e.shiftKey) return null;
  if (e.key === "-" || e.code === "Minus" || e.code === "NumpadSubtract") return -1;
  if (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0") return 0;
  return null;
}
