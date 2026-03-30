import { useEffect, useMemo, useState } from "react";
import {
  parseThemePreference,
  resolveThemePreference,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "../lib/theme";

function getStoredThemePreference() {
  if (typeof window === "undefined") {
    return "system" as ThemePreference;
  }

  return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
}

function getSystemPrefersDark() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useWorkspaceTheme() {
  const [themePreference, setThemePreference] =
    useState<ThemePreference>(getStoredThemePreference);
  const [systemPrefersDark, setSystemPrefersDark] =
    useState<boolean>(getSystemPrefersDark);
  const resolvedTheme = useMemo(
    () => resolveThemePreference(themePreference, systemPrefersDark),
    [systemPrefersDark, themePreference],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    setSystemPrefersDark(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);

    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);

    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themePreference = themePreference;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme, themePreference]);

  return {
    themePreference,
    resolvedTheme,
    setThemePreference,
  };
}
