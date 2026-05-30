const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let handle;
let win;

if (process.platform === "linux" && process.env.LEADBAY_INSTALLER_ELECTRON_SANDBOX !== "1") {
  app.commandLine.appendSwitch("no-sandbox");
}

async function createWindow() {
  const mod = await import(pathToFileURL(path.join(__dirname, "../dist/installer-gui.js")).href);
  const isUninstall = process.argv.includes("--uninstall");
  handle = isUninstall
    ? await mod.startUninstallerGui({ openBrowser: false })
    : await mod.startInstallerGui({ openBrowser: false });

  win = new BrowserWindow({
    width: 920,
    height: 760,
    minWidth: 720,
    minHeight: 620,
    title: isUninstall ? "Leadbay MCP Uninstaller" : "Leadbay MCP Installer",
    backgroundColor: "#f6f7f4",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  await win.loadURL(handle.url);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", async () => {
  if (handle) await handle.close().catch(() => undefined);
  app.quit();
});
