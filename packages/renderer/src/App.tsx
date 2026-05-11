import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { KanbanPage } from "./tools/kanban/kanban";

type ThemeMode = "light" | "dark";

const themeStorageKey = "kanban.theme";
const themeMediaQuery = "(prefers-color-scheme: dark)";

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "light" || value === "dark";
}

function systemTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  return window.matchMedia(themeMediaQuery).matches ? "dark" : "light";
}

function storedTheme(): ThemeMode | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(themeStorageKey);
    return isThemeMode(value) ? value : null;
  } catch {
    return null;
  }
}

export function App(): JSX.Element {
  const [theme, setTheme] = useState<ThemeMode>(() => storedTheme() ?? systemTheme());

  useEffect(() => {
    const stored = storedTheme();
    if (stored) return;

    const media = window.matchMedia(themeMediaQuery);
    const handleChange = () => setTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function chooseTheme(nextTheme: ThemeMode): void {
    setTheme(nextTheme);
    try {
      window.localStorage.setItem(themeStorageKey, nextTheme);
    } catch {
      // Theme persistence is optional; the in-memory switch should still work.
    }
  }

  function toggleTheme(): void {
    chooseTheme(theme === "dark" ? "light" : "dark");
  }

  const nextTheme = theme === "dark" ? "light" : "dark";

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
        aria-label={`Switch to ${nextTheme} theme`}
        title={`Switch to ${nextTheme} theme`}
        onClick={toggleTheme}
      >
        {theme === "dark" ? <Sun size={16} /> : <Moon size={15} />}
      </button>
    </main>
  );
}
