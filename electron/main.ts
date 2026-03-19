import { app, BrowserWindow, dialog, shell, utilityProcess } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'http';

// ---------------------------------------------------------------------------
// Minimal .env parser — avoids requiring the `dotenv` npm package at runtime
// (not available inside the asar archive).
// ---------------------------------------------------------------------------

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const result: Record<string, string> = {};
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Constants & state
// ---------------------------------------------------------------------------

const isDev = !app.isPackaged;
const PORT = 3456;
const SERVER_URL = `http://127.0.0.1:${PORT}`;

let mainWindow: BrowserWindow | null = null;
let serverProcess: Electron.UtilityProcess | null = null;

// ---------------------------------------------------------------------------
// Single-instance lock — prevents the infinite-spawn cascade and ensures
// only one copy of the app is ever running.
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ---------------------------------------------------------------------------
// Environment variables
// ---------------------------------------------------------------------------

function loadEnv(): Record<string, string> {
  if (isDev) return {};

  const userDataDir = app.getPath('userData');
  const envPath = path.join(userDataDir, '.env');
  const examplePath = path.join(process.resourcesPath, '.env.example');

  if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.copyFileSync(examplePath, envPath);
  }

  return parseEnvFile(envPath);
}

// ---------------------------------------------------------------------------
// Next.js standalone server — launched via utilityProcess.fork() so it uses
// Electron's embedded Node.js instead of spawning a new Electron instance.
// ---------------------------------------------------------------------------

function startServer(
  extraEnv: Record<string, string>,
): Electron.UtilityProcess {
  const standaloneDir = path.join(process.resourcesPath, 'standalone');
  const serverScript = path.join(standaloneDir, 'server.js');

  const outputDir = path.join(
    app.getPath('documents'),
    'BRC Assistant',
    'output',
  );
  fs.mkdirSync(outputDir, { recursive: true });

  const child = utilityProcess.fork(serverScript, [], {
    env: {
      ...process.env,
      ...extraEnv,
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      OUTPUT_DIR: outputDir,
      CONFIG_DIR: app.getPath('userData'),
    },
    cwd: standaloneDir,
    stdio: 'pipe',
    serviceName: 'nextjs-server',
  });

  child.stdout?.on('data', (data: Buffer) => {
    console.log(`[server] ${data.toString().trim()}`);
  });

  child.stderr?.on('data', (data: Buffer) => {
    console.error(`[server] ${data.toString().trim()}`);
  });

  child.on('exit', (code) => {
    console.log(`[server] process exited with code ${code}`);
    serverProcess = null;
  });

  return child;
}

// ---------------------------------------------------------------------------
// Wait for the server to respond on its HTTP port
// ---------------------------------------------------------------------------

function waitForServer(
  url: string,
  timeoutMs = 30_000,
  intervalMs = 500,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    const poll = () => {
      if (Date.now() > deadline) {
        return reject(new Error('Server did not start in time'));
      }

      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve();
        } else {
          setTimeout(poll, intervalMs);
        }
      });

      req.on('error', () => {
        setTimeout(poll, intervalMs);
      });

      req.end();
    };

    poll();
  });
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow(url: string) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'BRC Assistant',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(url);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  const extraEnv = loadEnv();

  if (isDev) {
    const devUrl = 'http://localhost:3000';
    try {
      await waitForServer(devUrl);
    } catch {
      dialog.showErrorBox(
        'Dev server not running',
        'Start the Next.js dev server with "npm run dev" first.',
      );
      app.quit();
      return;
    }
    createWindow(devUrl);
  } else {
    serverProcess = startServer(extraEnv);

    // Race: either the server becomes ready, or it crashes early.
    const earlyExit = new Promise<never>((_, reject) => {
      serverProcess!.on('exit', (code) => {
        reject(
          new Error(`Server exited unexpectedly (code ${code})`),
        );
      });
    });

    try {
      await Promise.race([waitForServer(SERVER_URL), earlyExit]);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'The server failed to start.';
      dialog.showErrorBox('Server error', msg);
      app.quit();
      return;
    }

    // If .env has no API key, prompt the user.
    const envPath = path.join(app.getPath('userData'), '.env');
    if (
      !extraEnv.GPT4O_API_KEY &&
      !extraEnv.OLLAMA_BASE_URL &&
      fs.existsSync(envPath)
    ) {
      const result = await dialog.showMessageBox({
        type: 'info',
        title: 'Configure API Keys',
        message:
          'No API keys found. Please edit the .env file with your Azure OpenAI or Ollama configuration.',
        detail: `Config file location:\n${envPath}`,
        buttons: ['Open .env file', 'Continue anyway'],
        defaultId: 0,
      });

      if (result.response === 0) {
        shell.openPath(envPath);
      }
    }

    createWindow(SERVER_URL);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(isDev ? 'http://localhost:3000' : SERVER_URL);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
