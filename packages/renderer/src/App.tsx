import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { KanbanPage } from "./tools/kanban/kanban";

type ThemeMode = "light" | "dark";
type ThemePreference = "system" | ThemeMode;

const themeStorageKey = "kanban.theme";
const themeMediaQuery = "(prefers-color-scheme: dark)";

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function systemTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  return window.matchMedia(themeMediaQuery).matches ? "dark" : "light";
}

function storedThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const value = window.localStorage.getItem(themeStorageKey);
    return isThemePreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

function themePreferenceLabel(themePreference: ThemePreference): string {
  switch (themePreference) {
    case "system":
      return "System";
    case "light":
      return "Light";
    case "dark":
      return "Dark";
  }
}

export function App(): JSX.Element {
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => storedThemePreference());
  const [systemThemeMode, setSystemThemeMode] = useState<ThemeMode>(() => systemTheme());
  const theme = themePreference === "system" ? systemThemeMode : themePreference;

  useEffect(() => {
    const media = window.matchMedia(themeMediaQuery);
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemThemeMode(event.matches ? "dark" : "light");
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function chooseThemePreference(nextThemePreference: ThemePreference): void {
    setThemePreference(nextThemePreference);
    try {
      window.localStorage.setItem(themeStorageKey, nextThemePreference);
    } catch {
      // Theme persistence is optional; the in-memory switch should still work.
    }
  }

  function toggleTheme(): void {
    chooseThemePreference(nextThemePreference);
  }

  const nextThemePreference: ThemePreference =
    themePreference === "system" ? "light" : themePreference === "light" ? "dark" : "system";
  const currentThemeLabel = themePreferenceLabel(themePreference);
  const nextThemeLabel = themePreferenceLabel(nextThemePreference);

  return (
    <main className="app-shell">
      <div className="app-drag-region app-titlebar">
        <div className="app-titlebar-spacer" />
        <div className="app-titlebar-title">Kanban</div>
      </div>
      <section className="app-content app-no-drag">
        <KanbanPage />
      </section>
      <button
        type="button"
        className="app-no-drag theme-switch"
        aria-label={`Theme: ${currentThemeLabel}. Switch to ${nextThemeLabel} mode`}
        title={`Theme: ${currentThemeLabel}. Switch to ${nextThemeLabel} mode`}
        onClick={toggleTheme}
      >
        {themePreference === "system" ? (
          <Monitor size={16} />
        ) : themePreference === "dark" ? (
          <Sun size={16} />
        ) : (
          <Moon size={15} />
        )}
      </button>
    </main>
  );
}
