import { useEffect, useState } from "react";
import { ChevronDown, Moon, Settings, Sun } from "lucide-react";
import { KanbanPage } from "./tools/kanban/kanban";
import { SettingsDialog } from "./components/settings-dialog";

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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);

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

  useEffect(() => {
    return window.api?.app.onOpenSettings(() => setIsSettingsOpen(true));
  }, []);

  useEffect(() => {
    if (!isSettingsMenuOpen) return;
    const closeMenu = () => setIsSettingsMenuOpen(false);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [isSettingsMenuOpen]);

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
        <div className="app-titlebar-actions app-no-drag" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="titlebar-menu-button"
            aria-label="Open settings menu"
            aria-expanded={isSettingsMenuOpen}
            onClick={() => setIsSettingsMenuOpen((current) => !current)}
          >
            <Settings size={14} />
            <ChevronDown size={13} />
          </button>
          {isSettingsMenuOpen ? (
            <div className="titlebar-menu" role="menu">
              <button
                type="button"
                className="titlebar-menu-item"
                role="menuitem"
                onClick={() => {
                  setIsSettingsMenuOpen(false);
                  setIsSettingsOpen(true);
                }}
              >
                <Settings size={14} />
                <span>Settings</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <section className="app-content app-no-drag">
        <KanbanPage />
      </section>
      <SettingsDialog open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
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
