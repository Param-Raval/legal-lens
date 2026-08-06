# BRC Assistant

AI-assisted immigration document analysis for Border Relief Clinic intake staff.

Staff upload a client's documents (photos, scans, PDFs, Word files), and the app runs
OCR + field extraction, translates non-English documents to English, cross-checks the
documents against each other for discrepancies, and produces a downloadable analysis
report.

It ships in two forms from the same codebase:

| Form                                            | Entry point                                                            | Where document data goes                             |
| ----------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| **Desktop app** (Windows `.exe` / macOS `.dmg`) | Electron shell + bundled Next.js standalone server on `127.0.0.1:3456` | Optionally saved to `Documents/BRC Assistant/output` |

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick start (local development)](#quick-start-local-development)
- [Configuration](#configuration)
- [Supported files and limits](#supported-files-and-limits)
- [How it works](#how-it-works)
- [Repository layout](#repository-layout)
- [Building the desktop apps](#building-the-desktop-apps)
  - [Option A — GitHub Actions (both platforms)](#option-a--github-actions-both-platforms)
  - [Option B — Windows `.exe` locally](#option-b--windows-exe-locally)
  - [Option C — macOS `.app` / `.dmg` locally](#option-c--macos-app--dmg-locally)
  - [What the build actually does](#what-the-build-actually-does)
  - [Build troubleshooting](#build-troubleshooting)
- [Data privacy and security](#data-privacy-and-security)
- [Testing](#testing)
- [CLI test pipeline](#cli-test-pipeline)
- [Known limitations](#known-limitations)
- [Further reading](#further-reading)

---

## Features

- **Upload** images, PDFs (up to 25 pages each), and `.docx` files — individually, as a
  drag-and-dropped folder, or via **Choose Folder**.
- **Server-side PDF rendering** — each page is rasterised to a JPEG by `pdfjs-dist` +
  `@napi-rs/canvas` in Node, so the browser never loads a PDF engine. Digital PDFs also
  contribute their embedded text and AcroForm widget values.
- **OCR + structured field extraction** via Azure OpenAI GPT-4o (vision) or a local Ollama
  vision model.
- **Translation to English** with automatic document-type and language detection.
- **Cross-document discrepancy detection** — names, dates, places, and family fields are
  compared across documents, with severity and confidence.
- **Family Mode** — multi-person cases: members inferred from folder names, per-document
  assignment, declared/inferred relationships, and cross-person field checks.
- **Analysis context** — a free-text box (plus per-document notes) that steers what the
  analysis looks for; the app echoes back its structured interpretation.
- **Report generation** with PDF / JSON download, plus translation export as TXT, DOCX,
  or JSON.
- **Result cache** — OCR and translation results are content-addressed in IndexedDB, so
  re-running a case never re-pays for the same vision call.
- Dark / light mode, guided tour, in-app settings dialog.

For a screen-by-screen walkthrough of Family Mode, folder interpretation, report modes,
and every button, see [FEATURES_GUIDE.md](FEATURES_GUIDE.md).

---

## Requirements

|                 | Version                                             | Why                                                                        |
| --------------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| **Node.js**     | ≥ 20.19.0 (CI uses 22; `.nvmrc` pins 20)            | `pdfjs-dist` v5 requires it                                                |
| **pnpm**        | 11.5.0 — pinned via `packageManager`                | pnpm 10.x has a resolver bug with `@napi-rs/canvas` optional platform deps |
| **AI provider** | Azure OpenAI GPT-4o deployment, **or** local Ollama | vision OCR + reasoning                                                     |

Enable pnpm through corepack so the pinned version is used:

```bash
corepack enable
corepack prepare pnpm@11.5.0 --activate
```

> `pnpm-workspace.yaml` sets `nodeLinker: hoisted`. This is **required**, not a
> preference: pnpm's default symlinked layout produces a `.next/standalone` tree full of
> links into the local pnpm store, which breaks the moment the app is packaged and copied
> to another machine.

---

## Quick start (local development)

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure a provider

```bash
cp .env.example .env
```

**Azure OpenAI (recommended):**

```env
AI_PROVIDER=openai
GPT4O_ENDPOINT=https://YOUR_RESOURCE.cognitiveservices.azure.com/openai/v1/
GPT4O_DEPLOYMENT=gpt-4o
GPT4O_API_KEY=your-key
```

**Ollama (no cloud account needed):**

```bash
ollama pull qwen2.5vl
ollama pull deepseek-r1:8b
ollama serve
```

```env
AI_PROVIDER=ollama
```

### 3. Run

```bash
pnpm dev            # browser at http://localhost:3000
```

```bash
pnpm electron:dev   # same dev server, wrapped in the Electron window
```

`electron:dev` starts `next dev`, waits for port 3000, compiles `electron/*.ts` to
`dist-electron/`, then launches Electron pointing at the dev server.

### Other scripts

| Script                              | Purpose                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm build`                        | Production Next.js build (`output: 'standalone'`)                                                                        |
| `pnpm start`                        | Serve the production build                                                                                               |
| `pnpm lint` / `pnpm lint:fix`       | ESLint                                                                                                                   |
| `pnpm format` / `pnpm format:check` | Prettier                                                                                                                 |
| `pnpm test` / `pnpm test:watch`     | Vitest suite — see [Testing](#testing)                                                                                   |
| `pnpm verify:pdf-runtime`           | Fail fast if the PDF rendering prerequisites are missing                                                                 |
| `pnpm test-pipeline`                | Run the whole AI pipeline over local sample files, no browser                                                            |
| `pnpm electron:dev`                 | Electron shell against the dev server                                                                                    |
| `pnpm electron:build`               | Full installer build for the current OS                                                                                  |
| `pnpm electron:build:dir`           | Same, but unpacked directory only (faster)                                                                               |
| `pnpm electron:pack`                | Package **without** re-running `next build` — see the warning in [Building the desktop apps](#building-the-desktop-apps) |

---

## Configuration

### Where the `.env` file lives

| Environment          | Location                                           |
| -------------------- | -------------------------------------------------- |
| Local dev            | `.env` (or `.env.local`) in the project root       |
| Packaged Windows app | `%APPDATA%\BRC Assistant\.env`                     |
| Packaged macOS app   | `~/Library/Application Support/BRC Assistant/.env` |

On first launch the desktop app copies `.env.example` into that directory and, if no
usable API key is present, offers to open the file for editing. The **Settings** dialog
(⚙️, top-right) reads and writes the same file at runtime — it is disabled on Vercel and
guarded so only the app itself can call it (loopback-host check + a custom header, which
blocks both CSRF and DNS-rebinding attempts from a normal browser tab).

### Environment variables

| Variable                  | Required      | Default                      | Description                                                                                        |
| ------------------------- | ------------- | ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `AI_PROVIDER`             | no            | `openai`                     | `openai` or `ollama`; anything else falls back to `openai`                                         |
| `GPT4O_ENDPOINT`          | when `openai` | —                            | Azure OpenAI endpoint URL                                                                          |
| `GPT4O_DEPLOYMENT`        | when `openai` | `gpt-4o`                     | Deployment name                                                                                    |
| `GPT4O_API_KEY`           | when `openai` | —                            | Azure OpenAI API key                                                                               |
| `GPT4O_MAX_OUTPUT_TOKENS` | no            | `16384`                      | Lower to `4096` if your deployment caps output tokens there                                        |
| `OLLAMA_BASE_URL`         | when `ollama` | `http://localhost:11434`     | Ollama server URL                                                                                  |
| `OLLAMA_MODEL`            | when `ollama` | `qwen2.5vl`                  | Vision model                                                                                       |
| `OLLAMA_REASONING_MODEL`  | when `ollama` | `deepseek-r1:8b`             | Reasoning model                                                                                    |
| `REPORT_MODE`             | no            | `deep` desktop / `light` web | `light` or `deep` — see [Report modes](#report-modes)                                              |
| `NEXT_PUBLIC_ENABLE_SAVE` | build-time    | unset                        | `true` enables writing results to disk; set automatically by the Electron build scripts            |
| `OUTPUT_DIR`              | runtime       | `./output`                   | Where `save-results` writes; Electron sets it to `Documents/BRC Assistant/output`                  |
| `CONFIG_DIR`              | runtime       | `process.cwd()`              | Directory holding the `.env` the Settings dialog edits; Electron sets it to the app's userData dir |
| `BRC_DESKTOP`             | runtime       | unset                        | Set to `1` by the Electron main process to mark this server as the installed desktop app           |

`AI_PROVIDER`, the credentials, and `REPORT_MODE` are read fresh from `process.env` on every
call ([src/lib/config.ts](src/lib/config.ts),
[src/lib/report-mode.ts](src/lib/report-mode.ts)), so a Settings change applies to the next
request without a restart.

### Report modes

`REPORT_MODE` controls how each document's summary is built for the report:

- **`deep`** — one extra AI call per document, so the model re-reads and analyses each one
  individually (`/api/analyze-document-report`). Richer per-document detail, slower, more
  tokens.
- **`light`** — the summary is derived locally from the OCR fields already extracted
  ([document-summary.ts](src/lib/document-summary.ts)). No extra AI calls, deterministic.

Both modes still run the cross-document discrepancy and report-generation stages.

When unset, the default depends on the host: the installed desktop app uses **`deep`**
(`BRC_DESKTOP=1`, set by [electron/main.ts](electron/main.ts)), and a web deployment uses
**`light`** so an unattended public instance can't fan out N AI calls per report.

The mode is resolved **server-side**, per request, via `GET /api/report-mode`, which the
client calls immediately before generating a report — so changing it in Settings applies to
the next report with no restart.

> **Migration note.** This setting used to be `NEXT_PUBLIC_REPORT_MODE` and was read in a
> client hook. Next.js substitutes `NEXT_PUBLIC_*` values into the client bundle at **build
> time**, so the packaged app was frozen on whatever the value was when the installer was
> built — which in CI was nothing, i.e. always `light`. Choosing Deep in Settings did
> nothing, restart or not. The old key is still accepted as a read-only alias, and
> `/api/settings` migrates it to `REPORT_MODE` the first time settings are saved.

---

## Supported files and limits

| Type                                    | Upload                       | Analyze       | Translate |
| --------------------------------------- | ---------------------------- | ------------- | --------- |
| Images — PNG, JPG, GIF, WebP, BMP, TIFF | ✅                           | ✅            | ✅        |
| PDF                                     | ✅ (first 25 pages rendered) | ✅ (per page) | ✅        |
| Word `.docx`                            | ✅                           | ✅            | ✅        |

| Limit                               | Value                   | Where                                                                                                                                |
| ----------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Pages rendered per PDF              | 25                      | `MAX_PAGES` in [pdf-pages/route.ts](src/app/api/pdf-pages/route.ts) and [pdf-extract.ts](src/lib/pdf-extract.ts) — keep both in sync |
| Max file upload accepted by the API | 15 MB                   | `MAX_UPLOAD_BYTES` in [api-guard.ts](src/lib/api-guard.ts)                                                                           |
| Max JSON payload                    | 10 MB                   | `MAX_JSON_BYTES` in the same file                                                                                                    |
| Per-AI-call timeout                 | 120 s                   | `PER_CALL_TIMEOUT_MS` in [ai-client.ts](src/lib/ai-client.ts)                                                                        |
| Serverless function duration        | 60 s                    | `maxDuration` per route + [vercel.json](vercel.json)                                                                                 |
| **Vercel request body**             | ~4.5 MB (platform edge) | Oversized images are re-encoded client-side by [image-downscale.ts](src/lib/image-downscale.ts) before upload                        |

---

## How it works

```
 Browser (React 19 / Next 15 App Router)
   │
   │  PDF ──► POST /api/pdf-pages ──► pdfjs-dist + @napi-rs/canvas (Node)
   │              └─► page JPEGs + embedded text + AcroForm widget values
   │
   │  image / page ──► POST /api/analyze     ──► GPT-4o vision  → OCR + structured fields
   │               ──► POST /api/translate   ──► GPT-4o          → English translation
   │
   │  extracted text only (no images re-sent) from here on:
   │      GET  /api/report-mode             → effective report mode, resolved server-side
   │      POST /api/parse-intent            → structured goals from the free-text context
   │      POST /api/infer-family-members    → members from document content
   │      POST /api/infer-relationships     → declared/inferred family graph
   │      POST /api/analyze-document-report → per-document deep read (deep mode only)
   │      POST /api/analyze-discrepancies   → cross-document + cross-person findings
   │      POST /api/generate-report         → final AnalysisReport
   │
   └─► jsPDF / docx / JSZip render the report and translation exports in the browser
```

Orchestration lives client-side in [src/hooks/useFiles.ts](src/hooks/useFiles.ts); all
provider calls, prompts, retries, and schema validation live in
[src/lib/ai-client.ts](src/lib/ai-client.ts). API routes are thin wrappers that enforce
body-size caps and sanitise errors.

The report pipeline asks `GET /api/report-mode` for the effective mode before Phase 1 rather
than reading an env var in the browser — see [Report modes](#report-modes) for why that
matters.

### Desktop runtime

The packaged app is not a static export — it ships a real Next.js server:

1. Electron's main process reads `%APPDATA%\BRC Assistant\.env` (or the macOS
   equivalent) with a tiny built-in parser.
2. It forks `resources/standalone/start.js` via `utilityProcess.fork()`, so the server
   runs on Electron's embedded Node rather than spawning a second Electron.
3. `start.js` puts `server_modules/` on `NODE_PATH` and calls `Module._initPaths()`, then
   requires `server.js`.
4. The main process polls `http://127.0.0.1:3456` for up to 90 s, verifies the responder
   is actually our server (via `X-Frame-Options`/`X-Powered-By`) rather than some other
   app squatting the port, then opens the window.
5. Server stdout/stderr are mirrored to `<userData>/server.log` — **the first place to
   look when the packaged app misbehaves.** The previous launch's log is kept as
   `server.prev.log`, so "it crashed, so I restarted it" no longer destroys the evidence.

A single-instance lock prevents duplicate launches, the default menu is removed on
Windows (so staff can't force-reload mid-analysis), external links open in the system
browser, and a post-boot server crash raises a Restart/Quit dialog.

### Logging and error reporting

Server-side logging lives in [src/lib/logger.ts](src/lib/logger.ts): timestamped,
levelled (`LOG_LEVEL` env var; `debug` in dev, `info` in production), and scoped per
route via the `withApiLogging` wrapper in [api-guard.ts](src/lib/api-guard.ts) — every
API request gets a start line and a finish line with status and duration. Two sinks:
stdout/stderr (→ `server.log` in Electron, function logs on Vercel) and an in-memory
ring buffer served by `GET /api/logs` for the **Settings → Diagnostics** panel, which
works even in `pnpm dev` where no log file exists.

Failed requests return a structured body:

```json
{
  "error": "…what happened and what to do…",
  "kind": "provider_auth",
  "reference": "ea1d72d3",
  "retryable": false
}
```

`reference` is stamped on the matching server-log line (`ref=ea1d72d3`), so an error a
user reads out can be matched to the exact failure. Errors are classified in
[api-guard.ts](src/lib/api-guard.ts) — provider auth failures (401/403) name the problem
and point at Settings instead of saying "try again"; provider HTTP errors carry the
provider's own platform message (never request content — see
[provider-error.ts](src/lib/provider-error.ts)); `ReferenceError`s and missing modules
are reported as build/installation problems rather than being blamed on the document.

Secrets are scrubbed from every log line (`redact()` removes any occurrence of
`GPT4O_API_KEY`'s value), and document text/fields are never logged — only sizes,
counts, durations, and provider metadata.

---

## Repository layout

```
├── src/
│   ├── app/                 App Router pages + API routes
│   │   └── api/             analyze, translate, pdf-pages, generate-report,
│   │                        analyze-discrepancies, analyze-document-report,
│   │                        parse-intent, infer-*, report-mode, save-results,
│   │                        settings
│   ├── components/          ApplicationAnalyzer, FileUpload/List/Viewer,
│   │                        FamilyMemberPanel, FamilyTree, ReportViewer, SettingsDialog
│   ├── hooks/useFiles.ts    Pipeline orchestration (the core state machine)
│   ├── lib/                 ai-client, config, api-guard, result-cache, pdf-extract,
│   │                        image-downscale, document-summary/-types, pdf-export,
│   │                        report-mode (server) / report-mode-client (browser),
│   │                        translation-export, tour, utils
│   └── types/               Shared TypeScript types
├── electron/                main.ts, preload.ts, tsconfig.json  → dist-electron/
├── build/                   prepare-standalone.mjs, verify-pdf-runtime.mjs,
│                            entitlements.mac.plist (electron-builder buildResources)
├── scripts/                 test-pipeline.ts (TS) + the original Python prototypes
├── electron-builder.yml     Packaging config (NSIS + dmg)
├── next.config.ts           standalone output, file tracing, CSP/security headers
├── pnpm-workspace.yaml      nodeLinker: hoisted, allowBuilds, supportedArchitectures
└── .github/workflows/build-desktop.yml
```

---

## Building the desktop apps

Artifacts land in `release/`. The version in the filenames comes from `version` in
[package.json](package.json) — bump it there before cutting a build.

| Platform | Artifacts                                                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows  | `release/BRC Assistant Setup <version>.exe` (NSIS, x64), `.exe.blockmap`, `latest.yml`, `release/win-unpacked/`                                                  |
| macOS    | `release/BRC Assistant-<version>.dmg` (x64), `release/BRC Assistant-<version>-arm64.dmg`, `release/mac/BRC Assistant.app`, `release/mac-arm64/BRC Assistant.app` |

**electron-builder only builds for the OS it runs on.** A Windows machine cannot produce
the macOS `.dmg` (it needs macOS tooling), and vice versa. Use CI for both.

### Option A — GitHub Actions (both platforms)

[.github/workflows/build-desktop.yml](.github/workflows/build-desktop.yml) builds Windows
and macOS in a matrix and uploads the installers as workflow artifacts.

- **Manual:** Actions → _Build Desktop Apps_ → **Run workflow**.
- **On a tag:**

  ```bash
  # bump "version" in package.json first
  git commit -am "release: v0.2.0"
  git tag v0.2.0
  git push origin main --tags
  ```

Download `desktop-win` and `desktop-mac` from the finished run's Artifacts section.

> One caveat on a fresh clone: `.gitignore` ignores `/build`, and
> `build/entitlements.mac.plist` is **not** tracked (the two `.mjs` build scripts are).
> That is harmless today because macOS signing is off, but if you enable signing you must
> `git add -f build/entitlements.mac.plist` or CI won't have it.

### Option B — Windows `.exe` locally

Run in PowerShell from the project root:

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm electron:build
```

That single command runs the whole chain (see
[What the build actually does](#what-the-build-actually-does)) and writes
`release\BRC Assistant Setup <version>.exe`.

Install and run:

```powershell
& ".\release\BRC Assistant Setup 0.2.0.exe"
```

The installer is per-user (`perMachine: false`), lets the user pick the install
directory, and creates Desktop + Start Menu shortcuts. It installs to
`%LOCALAPPDATA%\Programs\BRC Assistant` by default.

After installing, put your credentials in `%APPDATA%\BRC Assistant\.env` (or use the
in-app Settings dialog) and relaunch.

Two things to know:

- The installer is **unsigned**, so Windows SmartScreen shows a "unrecognised app"
  warning — _More info → Run anyway_. Signing needs an Authenticode certificate.
- `deleteAppDataOnUninstall` is deliberately `false`. `%APPDATA%\BRC Assistant` holds the
  `.env` with real API keys **and** the Chromium profile (IndexedDB result cache / local
  case data). Uninstall-reinstall must not destroy them.

For a faster iteration loop that skips installer generation:

```powershell
pnpm electron:build:dir      # → release\win-unpacked\BRC Assistant.exe
```

### Option C — macOS `.app` / `.dmg` locally

Requires macOS with Xcode Command Line Tools (`xcode-select --install`).

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm electron:build
```

This produces both architectures, because `electron-builder.yml` lists `x64` and `arm64`
under the `dmg` target. A single `pnpm install` is enough to get both sets of native
binaries: `supportedArchitectures` in `pnpm-workspace.yaml` fetches the `@napi-rs/canvas`
prebuilds for `darwin-x64`, `darwin-arm64`, and `win32-x64`, and
`build/prepare-standalone.mjs` prunes the ones that don't match the build OS.

To build just one architecture:

```bash
npx electron-builder --config electron-builder.yml --mac dmg --arm64
```

Unpacked app bundles (no dmg) for quick testing:

```bash
pnpm electron:build:dir      # → release/mac-arm64/BRC Assistant.app
```

The dmg is **unsigned and un-notarized** (`identity: null` in `electron-builder.yml`), so
Gatekeeper will block it after download. To run it anyway:

```bash
xattr -dr com.apple.quarantine "/Applications/BRC Assistant.app"
```

…or right-click the app → **Open** → **Open**. Proper distribution needs an Apple
Developer ID: remove `identity: null`, set `mac.notarize`, and supply
`APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` (and `CSC_LINK` /
`CSC_KEY_PASSWORD` for the certificate) as environment variables.
`build/entitlements.mac.plist` — already present and picked up automatically from
`buildResources` — grants the JIT / unsigned-memory / network-client / user-file
entitlements the bundled Node server needs.

### What the build actually does

`pnpm electron:build` is five steps, and each exists for a reason:

1. **`node build/verify-pdf-runtime.mjs`** — asserts `@napi-rs/canvas` exports
   `createCanvas`/`DOMMatrix`/`ImageData`/`Path2D`, and that `pdf.mjs` and
   `pdf.worker.mjs` exist under `pdfjs-dist/legacy/build/`. Without this, packaging
   succeeds and PDF upload fails at runtime in the shipped app.
2. **`cross-env NEXT_PUBLIC_ENABLE_SAVE=true next build`** — produces
   `.next/standalone`. The env var is build-time: it enables the "save results to disk"
   path that only makes sense in the desktop app.
3. **`node build/prepare-standalone.mjs`** — the part `next build` can't do:
   - copies `.next/static` and `public/` into the standalone tree;
   - copies `@napi-rs/canvas` and `pdfjs-dist` (excluded from the webpack bundle by
     `serverExternalPackages`) as **real files**, dereferencing pnpm junctions;
   - keeps only the `canvas-<buildOS>-*` prebuilt binaries and prunes the others;
   - deletes any bundled `output/` directory (real client data the file tracer pulls in)
     and any `.env` / `.env.local` (so secrets never ship in the installer);
   - renames `node_modules` → `server_modules` and writes the `start.js` shim, because
     electron-builder does not reliably ship a nested `node_modules` inside
     `extraResources`;
   - retries transient `EPERM`/`EBUSY` failures, since Windows Defender briefly locks
     freshly written `.node` binaries.
4. **`npx tsc -p electron/tsconfig.json`** — compiles `electron/main.ts` + `preload.ts`
   to `dist-electron/` (CommonJS), which `package.json`'s `main` points at.
5. **`electron-builder --config electron-builder.yml`** — packs `dist-electron/**` into
   the ASAR, `.next/standalone` → `resources/standalone`, and `.env.example` →
   `resources/.env.example`. `*.node` files are unpacked from the ASAR since native
   addons can't load from inside an archive.

> ⚠️ **`pnpm electron:pack` skips step 2.** It is only safe _immediately after_ a fresh
> `next build`. Running it against an already-prepared standalone tree recreates
> `node_modules` with just the two external packages and then renames it over the real
> `server_modules`, leaving a bundle that can't find `next`. If in doubt, run the full
> `pnpm electron:build`.

### Build troubleshooting

**`Electron failed to install correctly` on `pnpm electron:dev`**
Electron's `postinstall` can exit 0 without extracting anything (an `extract-zip` promise
that never settles under some Node versions). Any pnpm operation that prunes
`node_modules/electron/dist` then breaks local launches, and `pnpm rebuild electron`
repeats the same silent no-op. The downloaded zip is fine — extract it by hand:

```powershell
$ver = (node -p "require('electron/package.json').version")
Expand-Archive "$env:LOCALAPPDATA\electron\Cache\*\electron-v$ver-win32-x64.zip" `
  -DestinationPath ".\node_modules\electron\dist" -Force
[IO.File]::WriteAllText(".\node_modules\electron\path.txt", "electron.exe")
```

electron-builder packaging is unaffected (it extracts with its own 7-Zip); only local dev
launches break.

**`require('electron')` returns a string / `app` is undefined**
`ELECTRON_RUN_AS_NODE=1` is set in the shell, which runs the Electron binary as plain
Node. Clear it: `$env:ELECTRON_RUN_AS_NODE=$null`.

**Packaged app shows "Server error" on launch**
Read `%APPDATA%\BRC Assistant\server.log` (macOS:
`~/Library/Application Support/BRC Assistant/server.log`). `Cannot find module 'next'`
means the `node_modules` → `server_modules` rename or the `start.js` shim didn't happen —
re-run the full `pnpm electron:build`.

**"Another application is already using the app's port"**
Something else holds `127.0.0.1:3456`. The app refuses to display a foreign responder
rather than render a stranger's localhost page. Close the other process and relaunch.

**`ERR_MODULE_NOT_FOUND: pdfjs-dist` or `DOMMatrix is not defined` in the packaged app**
Both are fixed in [pdf-pages/route.ts](src/app/api/pdf-pages/route.ts) and the fixes are
load-order sensitive — don't refactor them casually:

- `import()` is ESM and ignores `NODE_PATH`, so the route probes both `node_modules/` and
  `server_modules/` and loads pdfjs via an absolute `file://` URL with
  `/* webpackIgnore: true */`.
- pdfjs constructs a `DOMMatrix` at _module evaluation_ time, so `@napi-rs/canvas` must be
  imported and its `DOMMatrix`/`DOMPoint`/`DOMRect` assigned to `globalThis` **before**
  pdfjs is imported.
- The missing `workerSrc` warning ("Setting up fake worker") is expected and harmless. Do
  **not** repoint `workerSrc` at the `server_modules` worker — that breaks the Electron
  runtime.

**`next build` type-errors on files under `release/`**
`tsconfig.json` must keep excluding `release`, `dist-electron`, and `.next/standalone`,
or the build type-checks the packaged copy of Next's own source.

**Never add an `output`-named pattern to `outputFileTracingExcludes`**
Those patterns match unanchored, so `output` also strips Next's internal
`next/dist/build/output/`, producing `Cannot find module '../build/output/log'` at
runtime. The project's `output/` directory is removed from the standalone tree by
`prepare-standalone.mjs` instead. There's a comment saying so in
[next.config.ts](next.config.ts) — heed it.

---

## Data privacy and security

- Uploaded files stay as browser `File` objects in React state; nothing is uploaded to
  third parties other than the configured AI provider.
- Image bytes go to the provider for OCR/translation only. Every later stage
  (discrepancies, report, relationship inference) sends **extracted text only** — images
  are never re-uploaded.
- OCR/translation results are cached in the browser's IndexedDB, keyed by a SHA-256 of the
  file bytes plus a `PROMPT_VERSION`, so a prompt change invalidates stale entries. The
  cache never leaves the device.
- API routes set `Cache-Control: private, no-store` on responses carrying document data.
- In the desktop app, results are written only under `Documents/BRC Assistant/output`.
- `prepare-standalone.mjs` strips `.env`, `.env.local`, and any `output/` directory from
  the bundle, so no secrets or client data ship inside an installer.
- Security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, and a CSP restricted to `'self'`) are applied to every route from
  [next.config.ts](next.config.ts).
- The Electron window can only ever display the local app; `will-navigate` and
  `setWindowOpenHandler` push any external URL to the system browser, so a link inside
  AI- or document-derived content can't take over the app frame.
- User-supplied free text is JSON-encoded before being embedded in prompts, so analysis
  context can't break out into instructions.

---

## Testing

```bash
pnpm test          # run the vitest suite once
pnpm test:watch    # watch mode
```

Tests live in `tests/` (config: [vitest.config.mts](vitest.config.mts), node
environment, `@/` alias mirrors tsconfig). They import the real production modules —
including actual route handlers called with real `NextRequest`s — not mocks of them.
What's pinned, and the regression each suite exists to catch:

| Suite                                       | Guards against                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pdf-canvas-globals.test.ts`                | The packaged-app PDF failure: pdfjs's own Node polyfills are disabled inside Electron's utilityProcess, so `ensureCanvasGlobals()` must register `Path2D`/`ImageData`/`DOMMatrix`/… itself. Wipes the globals and asserts every one comes back. This exact regression shipped once (commit `5e0c915` dropped two of the assignments) — dev kept working, only the installer broke. |
| `pdf-pages-route.test.ts`                   | End-to-end render of a real sample PDF through the actual route handler: page JPEGs, page cap, truncation flag, and structured errors for corrupt bytes.                                                                                                                                                                                                                           |
| `report-mode.test.ts`                       | Report mode must be resolved server-side at call time (desktop → `deep`, web → `light`, legacy key honoured) — never frozen at build time.                                                                                                                                                                                                                                         |
| `settings-route.test.ts`                    | `.env` handling: key masking, placeholder detection, the legacy-key migration, operator-key preservation, loopback/CSRF guards, validation, Vercel lockout. Runs against a temp `CONFIG_DIR`.                                                                                                                                                                                      |
| `api-guard.test.ts`                         | Error classification: a 401 must say "check Settings" and be non-retryable, 429 keeps the `isRateLimit` contract, `ReferenceError` reads as a broken build, and no internal message leaks through the fallback.                                                                                                                                                                    |
| `logger.test.ts` / `provider-error.test.ts` | Secrets never reach a log line; provider error bodies are mined for code/message only, never forwarded wholesale.                                                                                                                                                                                                                                                                  |

The PDF end-to-end tests use `sample_docs/i-589 filled.pdf`, which is gitignored — they
skip (not fail) on a clone without it. CI runs the suite before every desktop build.

## CLI test pipeline

Run the full AI pipeline over local files without a browser:

```bash
pnpm test-pipeline
```

Reads credentials from `.env` (via `tsx --env-file`) and operates on `sample_docs/`. Useful
for prompt work and for confirming a provider's configuration end-to-end.

The `scripts/` directory also contains the original Python prototypes for OCR,
translation, report generation, and PDF export — the reference the TypeScript pipeline was
ported from. They are not part of the app runtime; see
[scripts/README.md](scripts/README.md).

---

## Known limitations

- **Neither installer is code-signed.** Windows shows a SmartScreen warning; macOS
  Gatekeeper blocks the dmg after download. Both need certificates.
- **Windows installer targets x64 only.** No arm64 Windows target is configured.

---

## Further reading

- [FEATURES_GUIDE.md](FEATURES_GUIDE.md) — Family Mode, analysis context, folder
  interpretation, report modes, and a full button reference.
- [TO_IMPROVE.md](TO_IMPROVE.md) — open improvement backlog.
- [FLOW_AUDIT.md](FLOW_AUDIT.md) — pipeline flow audit notes.
- [scripts/README.md](scripts/README.md) — the Python reference implementation.

## Tech stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Radix UI / shadcn-ui ·
Zod · Azure OpenAI GPT-4o or Ollama · pdfjs-dist v5 + @napi-rs/canvas (server-side) ·
jsPDF + jspdf-autotable · docx · JSZip · Electron 41 + electron-builder 26
