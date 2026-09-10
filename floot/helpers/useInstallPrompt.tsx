import { useCallback, useSyncExternalStore } from "react";

// Captures Chrome's install prompt so Settings can offer "Install on this device".
// Frontend only. Nothing here is required for the app to work: a browser that never
// fires beforeinstallprompt simply never shows the button, and the manifest alone
// keeps the app installable from the address bar.

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); deferred = event as InstallPromptEvent; notify(); });
  window.addEventListener("appinstalled", () => { deferred = null; notify(); });
}

const isStandalone = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;

export function useInstallPrompt() {
  const canInstall = useSyncExternalStore(subscribe, () => deferred !== null, () => false);
  const installed = useSyncExternalStore(subscribe, isStandalone, () => false);
  const install = useCallback(async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    const event = deferred;
    if (!event) return "unavailable";
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") deferred = null;
    notify();
    return outcome;
  }, []);
  return { canInstall, installed, install };
}
