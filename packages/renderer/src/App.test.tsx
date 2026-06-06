import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("./tools/kanban/kanban", () => ({
  KanbanPage: () => <div data-testid="kanban-page" />
}));

const themeStorageKey = "kanban.theme";
const themeMediaQuery = "(prefers-color-scheme: dark)";

type MediaListener = (event: MediaQueryListEvent) => void;

let systemPrefersDark = false;
let mediaListeners: MediaListener[] = [];
let localStorageEntries = new Map<string, string>();

function setSystemPrefersDark(matches: boolean): void {
  systemPrefersDark = matches;
  const event = { matches, media: themeMediaQuery } as MediaQueryListEvent;
  act(() => {
    for (const listener of mediaListeners) {
      listener(event);
    }
  });
}

beforeEach(() => {
  systemPrefersDark = false;
  mediaListeners = [];
  localStorageEntries = new Map();

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: vi.fn(() => localStorageEntries.clear()),
      getItem: vi.fn((key: string) => localStorageEntries.get(key) ?? null),
      removeItem: vi.fn((key: string) => localStorageEntries.delete(key)),
      setItem: vi.fn((key: string, value: string) => localStorageEntries.set(key, value))
    }
  });

  window.localStorage.clear();
  delete document.documentElement.dataset.theme;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: systemPrefersDark,
      media: query,
      onchange: null,
      addEventListener: vi.fn((eventName: string, listener: MediaListener) => {
        if (eventName === "change") mediaListeners.push(listener);
      }),
      removeEventListener: vi.fn((eventName: string, listener: MediaListener) => {
        if (eventName === "change") {
          mediaListeners = mediaListeners.filter((candidate) => candidate !== listener);
        }
      }),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App theme preference", () => {
  it("defaults to system mode and resolves the current system theme", () => {
    setSystemPrefersDark(true);

    render(<App />);

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(themeStorageKey)).toBeNull();
    expect(screen.getByRole("button", { name: "Theme: System. Switch to Light mode" })).not.toBeNull();
  });

  it("treats invalid stored preferences as system mode", () => {
    window.localStorage.setItem(themeStorageKey, "solarized");

    render(<App />);

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByRole("button", { name: "Theme: System. Switch to Light mode" })).not.toBeNull();
  });

  it("reacts to system theme changes while system mode is selected", () => {
    render(<App />);

    expect(document.documentElement.dataset.theme).toBe("light");

    setSystemPrefersDark(true);

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("does not change the resolved theme after a manual preference is selected", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Theme: System. Switch to Light mode" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(themeStorageKey)).toBe("light");

    setSystemPrefersDark(true);

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("cycles and persists system, light, and dark preferences", () => {
    render(<App />);

    const switchButton = screen.getByRole("button", { name: "Theme: System. Switch to Light mode" });

    fireEvent.click(switchButton);
    expect(window.localStorage.getItem(themeStorageKey)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByRole("button", { name: "Theme: Light. Switch to Dark mode" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Theme: Light. Switch to Dark mode" }));
    expect(window.localStorage.getItem(themeStorageKey)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("button", { name: "Theme: Dark. Switch to System mode" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Theme: Dark. Switch to System mode" }));
    expect(window.localStorage.getItem(themeStorageKey)).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByRole("button", { name: "Theme: System. Switch to Light mode" })).not.toBeNull();
  });
});
