# BRC Assistant

A simple, elegant document analysis tool powered by AI.

## Features

- 📁 Upload multiple files (images, PDFs, text)
- 👁️ View files in a clean interface
- 🤖 AI-powered document analysis
- 🎨 Modern, minimal UI

## Quick Start

1. **Install dependencies**:

   ```bash
   npm install
   ```

2. **Start Ollama**:

   ```bash
   ollama pull qwen2.5vl
   ollama pull deepseek-r1:8b
   OLLAMA_HOST=0.0.0.0:1234 ollama serve
   ```

3. **Run the app**:

   ```bash
   npm run dev
   ```

4. **Open** `http://localhost:3000`

## Supported Files

- **View**: Images, PDFs, text files
- **Analyze**: Images only (JPG, PNG, etc.)

## Requirements

- Node.js 18+
- Ollama with vision model (qwen2.5vl)

## Configuration

Copy `env.example` to `.env` and adjust the Ollama URL if needed:

```bash
cp env.example .env
```

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript
- **UI**: Tailwind CSS, Radix UI
- **AI**: Ollama with Qwen2.5-VL
- **Validation**: Zod

## Architecture

The codebase is designed to be simple and maintainable:

- **Single hook** for file management (`useFiles`)
- **Consolidated types** in one file
- **Minimal components** with focused responsibilities
- **Clean API routes** with simplified error handling
