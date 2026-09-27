/** Window events that connect the shell, the pages and the tour without prop drilling. */
export const EVENTS = {
  /** Ask the shell to re-read /api/mvp/status (after a run finishes or a lead changes). */
  refreshStatus: "mvp:refresh-status",
  /** Start the guided tour from step 1 (Help → Take the tour). */
  startTour: "mvp:start-tour",
  /** Open the keyboard shortcuts dialog. */
  openShortcuts: "mvp:open-shortcuts",
} as const;

export function emit(name: (typeof EVENTS)[keyof typeof EVENTS]): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(name));
}

/** True when a key press should be left to a text field (no single-key shortcuts while typing). */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || !element.tagName) return false;
  return ["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName) || element.isContentEditable;
}

/** localStorage that never throws (private mode, disabled storage). */
export const safeStorage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};
