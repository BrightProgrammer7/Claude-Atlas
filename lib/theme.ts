"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Theme } from "./atlas-types";

export const THEME_STORAGE_KEY = "atlas-theme";

// Runs in <head> before first paint so the page never flashes the wrong theme: the saved
// choice wins, otherwise the system preference decides.
export const THEME_INIT_SCRIPT = `(function(){try{var saved=localStorage.getItem("${THEME_STORAGE_KEY}");var theme=saved==="light"||saved==="dark"?saved:(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");document.documentElement.dataset.theme=theme}catch(error){document.documentElement.dataset.theme="dark"}})();`;

const readTheme = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

function subscribeToTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(subscribeToTheme, readTheme, () => "dark" as Theme);

  const toggleTheme = useCallback(() => {
    const next: Theme = readTheme() === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private browsing can refuse storage; the choice then lasts for this visit only.
    }
  }, []);

  return [theme, toggleTheme];
}
