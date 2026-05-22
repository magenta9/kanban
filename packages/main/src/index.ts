import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { ipcChannels } from "@kanban/shared";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { openKanbanDatabase } from "./db/services";
import { KanbanRepository } from "./db/repositories/kanban-repository";
import { resolveKanbanPaths } from "./storage/path-service";
import { registerIpc } from "./ipc/register";

let mainWindow: BrowserWindow | null = null;
const appName = "Kanban";
const appIconPath = join(__dirname, "../../../build/icon.png");

app.name = appName;
app.setName(appName);
app.setAboutPanelOptions({ applicationName: appName });

function isExternalBrowserUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  }
  catch {
    return false;
  }
}

function openExternalInBrowser(rawUrl: string): void {
  if (!isExternalBrowserUrl(rawUrl)) {
    return;
  }

  if (process.platform === "darwin") {
    execFile("open", ["-a", "Google Chrome", rawUrl], (error) => {
      if (error) {
        void shell.openExternal(rawUrl);
      }
    });
    return;
  }

  void shell.openExternal(rawUrl);
}

function configureApplicationMenu(): void {
  if (process.platform !== "darwin") {
    return;
  }

  const template = [
    {
      label: appName,
      submenu: [
        { role: "about", label: `About ${appName}` },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide", label: `Hide ${appName}` },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit", label: `Quit ${appName}` }
      ]
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Keyboard Shortcuts",
          accelerator: "CommandOrControl+/",
          click: () => {
            const targetWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
            targetWindow?.webContents.send(ipcChannels.system.showKeyboardShortcuts);
          }
        }
      ]
    }
  ] satisfies MenuItemConstructorOptions[];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(): Promise<void> {
  const preloadPath = join(__dirname, "../../preload/dist/index.js");
  const hasAppIcon = existsSync(appIconPath);

  if (process.platform === "darwin" && hasAppIcon) {
    app.dock?.setIcon(appIconPath);
  }

  const browserWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    title: appName,
    ...(hasAppIcon ? { icon: appIconPath } : {}),
    backgroundColor: "#08090a",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow = browserWindow;

  browserWindow.on("closed", () => {
    mainWindow = null;
  });

  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalInBrowser(url);
    return { action: "deny" };
  });

  browserWindow.webContents.on("will-navigate", (event, url) => {
    if (url === browserWindow.webContents.getURL()) {
      return;
    }

    event.preventDefault();
    openExternalInBrowser(url);
  });

  if (!app.isPackaged) {
    await browserWindow.loadURL(process.env.KANBAN_RENDERER_URL ?? "http://localhost:5173");
    browserWindow.webContents.openDevTools({ mode: "detach" });
    return;
  }

  await browserWindow.loadFile(join(__dirname, "../../renderer/dist/index.html"));
}

app.whenReady().then(async () => {
  configureApplicationMenu();

  const paths = resolveKanbanPaths();
  mkdirSync(paths.root, { recursive: true });
  const database = openKanbanDatabase(paths.databasePath);
  registerIpc({
    kanban: new KanbanRepository(database)
  });

  await createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

if (!existsSync(join(__dirname, "../../preload/dist/index.js")) && app.isPackaged) {
  throw new Error("Preload bundle is missing.");
}
