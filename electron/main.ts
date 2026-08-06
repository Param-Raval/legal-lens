import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  shell,
  utilityProcess,
} from 'electron';
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
let logStream: fs.WriteStream | null = null;
// Set while the app is quitting so the post-boot server-crash dialog does not
// fire when before-quit intentionally kills the server.
let isQuitting = false;

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
  const serverScript = path.join(standaloneDir, 'start.js');

  const outputDir = path.join(
    app.getPath('documents'),
    'BRC Assistant',
    'output',
  );
  fs.mkdirSync(outputDir, { recursive: true });

  const logPath = path.join(app.getPath('userData'), 'server.log');
  // Keep exactly one previous launch's log as server.prev.log. Truncating on
  // every start (the old behaviour) destroyed the evidence in the most common
  // support case: "it crashed, so I restarted it" — by the time anyone looked,
  // the crash log was gone. One rotation is enough; unbounded growth is not a
  // risk because each file covers a single launch.
  const prevLogPath = path.join(app.getPath('userData'), 'server.prev.log');
  try {
    if (fs.existsSync(logPath)) {
      fs.copyFileSync(logPath, prevLogPath);
    }
  } catch {
    // Rotation is best-effort — never block launch over it.
  }
  // 'w' (truncate) for the CURRENT file — avoids stale content and prevents
  // write failures on Windows when a previous stream was not cleanly closed.
  logStream = fs.createWriteStream(logPath, { flags: 'w' });
  logStream.write(`--- server start ${new Date().toISOString()} ---\n`);
  logStream.write(
    `--- app ${app.getVersion()} | electron ${process.versions.electron} | node ${process.versions.node} | ${process.platform}-${process.arch} ---\n`,
  );

  const child = utilityProcess.fork(serverScript, [], {
    env: {
      ...process.env,
      ...extraEnv,
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      OUTPUT_DIR: outputDir,
      CONFIG_DIR: app.getPath('userData'),
      // Marks this server as the installed desktop app rather than a shared web
      // deployment. Read by src/lib/report-mode.ts to default report mode to
      // "deep" here (richer per-document read) while the web build stays
      // "light". An explicit REPORT_MODE in the user's .env still wins.
      BRC_DESKTOP: '1',
    },
    cwd: standaloneDir,
    stdio: 'pipe',
    serviceName: 'nextjs-server',
  });

  child.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    console.log(`[server] ${line}`);
    logStream?.write(`[out] ${line}\n`);
  });

  child.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    console.error(`[server] ${line}`);
    logStream?.write(`[err] ${line}\n`);
  });

  child.on('exit', (code) => {
    const line = `process exited with code ${code}`;
    console.log(`[server] ${line}`);
    logStream?.write(`[exit] ${line}\n`);
    logStream?.end();
    logStream = null;
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
    let sawForeignResponder = false;

    const poll = () => {
      if (Date.now() > deadline) {
        return reject(
          new Error(
            sawForeignResponder
              ? `Another application is already using the app's port (${url}). Close it and relaunch BRC Assistant.`
              : 'Server did not start in time',
          ),
        );
      }

      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          // Confirm the responder is OUR Next.js server and not some other
          // local app that happens to hold the same fixed port — otherwise
          // the window would render a stranger's localhost page. The app's
          // next.config sets X-Frame-Options: DENY on every route.
          const ours =
            res.headers['x-frame-options'] === 'DENY' ||
            String(res.headers['x-powered-by'] ?? '').includes('Next.js');
          if (ours) return resolve();
          sawForeignResponder = true;
        }
        setTimeout(poll, intervalMs);
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

  // The window must only ever display the local app. A link inside AI- or
  // document-derived content must open in the system browser, never replace
  // the app page or spawn a child window running remote content.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('http://') || target.startsWith('https://')) {
      shell.openExternal(target);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      if (target.startsWith('http://') || target.startsWith('https://')) {
        shell.openExternal(target);
      }
    }
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
  // Drop the stock Electron menu (View → DevTools, Ctrl+R force-reload, …) —
  // staff reloading mid-analysis loses in-flight work. Kept on macOS, where
  // the menu supplies the clipboard shortcuts.
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
  }

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
      // 90s (not the 30s default): the very first launch after an install can
      // be slowed heavily by Windows Defender scanning the freshly written
      // server_modules tree — failing fast there just looks broken.
      await Promise.race([waitForServer(SERVER_URL, 90_000), earlyExit]);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'The server failed to start.';
      const logPath = path.join(app.getPath('userData'), 'server.log');
      dialog.showErrorBox(
        'Server error',
        `${msg}\n\nSee log for details:\n${logPath}`,
      );
      app.quit();
      return;
    }

    // After a successful boot, a later server crash (OOM on a huge PDF, a
    // native-module fault) would otherwise leave the window open with every
    // request failing and no explanation.
    serverProcess?.on('exit', (code) => {
      if (isQuitting) return;
      const choice = dialog.showMessageBoxSync({
        type: 'error',
        title: 'Server stopped',
        message: `The analysis server stopped unexpectedly (code ${code ?? 'unknown'}).`,
        detail: 'Restart BRC Assistant to continue working.',
        buttons: ['Restart', 'Quit'],
        defaultId: 0,
      });
      if (choice === 0) app.relaunch();
      app.quit();
    });

    // If .env has no usable API key, prompt the user. Values seeded from
    // .env.example (e.g. "your-azure-openai-api-key-here") are placeholders,
    // not configuration — older installs still carry them uncommented.
    const envPath = path.join(app.getPath('userData'), '.env');
    const keyIsPlaceholder =
      !extraEnv.GPT4O_API_KEY || /your-.+-here/i.test(extraEnv.GPT4O_API_KEY);
    if (
      keyIsPlaceholder &&
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
  isQuitting = true;
  // End the log stream before killing the server so buffered writes are
  // flushed to disk. On Windows this is especially important — unflushed
  // streams can leave the file in a state where the next launch's
  // createWriteStream fails silently.
  if (logStream) {
    logStream.end();
    logStream = null;
  }
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
