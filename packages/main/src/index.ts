import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
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
    { role: "windowMenu" }
  ] satisfies MenuItemConstructorOptions[];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(): Promise<void> {
  const preloadPath = join(__dirname, "../../preload/dist/index.js");
  const hasAppIcon = existsSync(appIconPath);

  if (process.platform === "darwin" && hasAppIcon) {
    app.dock?.setIcon(appIconPath);
  }

  mainWindow = new BrowserWindow({
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

  if (!app.isPackaged) {
    await mainWindow.loadURL(process.env.KANBAN_RENDERER_URL ?? "http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return;
  }

  await mainWindow.loadFile(join(__dirname, "../../renderer/dist/index.html"));
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
