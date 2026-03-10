# BRC Assistant

AI-powered immigration document analysis tool for Border Relief Clinic intake staff. Supports OCR extraction, translation, discrepancy detection, and report generation for images and PDFs.

## Features

- Upload images (JPG, PNG, TIFF, etc.) and PDFs (up to 10 pages per PDF)
- Server-side PDF rendering — each page becomes an analyzable image
- AI-powered OCR extraction via Azure GPT-4o (vision)
- Translation to English with document-type detection
- Cross-document discrepancy checking
- PDF report generation
- Dark / light mode

## Quick Start (Local Development)

### Option A — Azure GPT-4o (recommended)

1. Copy the example env file and fill in your Azure credentials:

   ```bash
   cp env.example .env.local
   ```

   Set `AI_PROVIDER=openai` and provide `GPT4O_ENDPOINT`, `GPT4O_DEPLOYMENT`, `GPT4O_API_KEY`.

2. Install dependencies (requires Node.js ≥ 20.19.0):

   ```bash
   pnpm install
   ```

3. Start the dev server:

   ```bash
   pnpm dev
   ```

4. Open `http://localhost:3000`

### Option B — Ollama (local, no Azure account needed)

1. Install and start Ollama with a vision model:

   ```bash
   ollama pull qwen2.5vl
   ollama pull deepseek-r1:8b
   ollama serve
   ```

2. Copy `env.example` to `.env.local` and set `AI_PROVIDER=ollama`.

3. `pnpm install && pnpm dev`

## Vercel Deployment

1. Push the repo to GitHub and import it in the [Vercel dashboard](https://vercel.com/new).

2. Set the following **Environment Variables** in the Vercel project settings:

   | Variable | Description |
   |---|---|
   | `AI_PROVIDER` | `openai` |
   | `GPT4O_ENDPOINT` | Your Azure OpenAI endpoint URL |
   | `GPT4O_DEPLOYMENT` | Deployment name (e.g. `gpt-4o`) |
   | `GPT4O_API_KEY` | Azure OpenAI API key |

3. Set the **Node.js Version** to **20.x** in Vercel project settings → General.

4. Deploy. All API routes run as serverless functions with a 60 s timeout (requires Vercel Pro or higher; Hobby plan caps at 10 s).

> **Upload size limit**: Vercel serverless functions accept up to ~4.5 MB per request body. PDFs larger than this must be split before uploading.

## Supported Files

| Type | Upload | Analyze / Translate |
|---|---|---|
| Images (JPG, PNG, GIF, WEBP, BMP, TIFF) | ✅ | ✅ |
| PDFs | ✅ (up to 10 pages rendered) | ✅ (each page as image) |

## Environment Variables

See [`env.example`](env.example) for all available variables.

| Variable | Required | Default | Description |
|---|---|---|---|
| `AI_PROVIDER` | Yes | — | `openai` or `ollama` |
| `GPT4O_ENDPOINT` | When `openai` | — | Azure OpenAI endpoint |
| `GPT4O_DEPLOYMENT` | When `openai` | — | GPT-4o deployment name |
| `GPT4O_API_KEY` | When `openai` | — | Azure OpenAI API key |
| `OLLAMA_BASE_URL` | When `ollama` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | When `ollama` | `qwen2.5vl` | Ollama vision model |
| `OLLAMA_REASONING_MODEL` | When `ollama` | `deepseek-r1:8b` | Ollama reasoning model |

## Requirements

- Node.js ≥ 20.19.0 (required by pdfjs-dist v5)
- pnpm

## Tech Stack

- **Framework**: Next.js 15, React 19, TypeScript
- **UI**: Tailwind CSS v4, Radix UI / shadcn/ui
- **AI**: Azure OpenAI (GPT-4o) or Ollama
- **PDF rendering**: pdfjs-dist v5 + @napi-rs/canvas (server-side only)

## Data Privacy

All document data stays ephemeral:

- Files are held as browser `File` objects in React state and never cached.
- API routes set `Cache-Control: private, no-store` on every response.
- On Vercel, `save-results` is a no-op — nothing is written to disk.
- Image bytes are forwarded to Azure OpenAI for OCR only; subsequent translation and discrepancy steps send extracted text only (no re-upload of images).
- Security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options`, CSP) are applied globally.

## Test Pipeline (CLI)

Run the full AI pipeline against local sample files without a browser:

```bash
pnpm test-pipeline
```

Requires a `.env` file with `AI_PROVIDER` and the corresponding credentials.

Pending README update changes for NextJS Vercel deployment
