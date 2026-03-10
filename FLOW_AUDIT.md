
---

### COMPLETE DATA FLOW AUDIT

#### Stage 1: PDF Upload

```
Browser                    Server (pdf-pages route)
  │                              │
  ├─ User selects PDF ──────────>│ formData with PDF bytes
  │                              ├─ pdfjs renders pages to JPEG
  │                              ├─ base64-encodes each JPEG
  │<──────────────────────────── ├─ Returns JSON { pages: [{jpeg, ...}] }
  │                              │   + PRIVACY_HEADERS
  ├─ atob() → Blob → File       │
  ├─ Stored in React state       │
  │  (memory only)               │   Server forgets everything (stateless)
```

**Privacy status**: PDF bytes transit to server, rendered to JPEG, returned as base64. Server is stateless — no persistence. `PRIVACY_HEADERS` prevent caching. No logging.

#### Stage 2: Image Upload (direct)

```
Browser
  ├─ User selects images
  ├─ FileInfo[] created in React state (memory only)
  ├─ No server call at upload time
```

**Privacy status**: Images never leave the browser until analysis is triggered.

#### Stage 3: OCR Analysis

```
Browser                    Server (analyze route)         Azure OpenAI
  │                              │                              │
  ├─ FormData with image ──────>│                              │
  │                              ├─ base64 encode ─────────────>│
  │                              │<── OCR JSON result ──────────│
  │<── OCR JSON ─────────────── │                              │
  │    + PRIVACY_HEADERS         │                              │
  ├─ Stored in React state       │ Stateless, nothing persisted │
```

**Privacy status**: Image → Vercel → Azure → OCR result → browser. No logging, no persistence, privacy headers set.

#### Stage 4: Translation

```
Browser                    Server (translate route)       Azure OpenAI
  │                              │                              │
  ├─ FormData: ocrText + ──────>│                              │
  │  ocrFields + ocrLanguage     │                              │
  │  (text path, no image)       ├─ prompt with text ──────────>│
  │                              │<── translation JSON ─────────│
  │<── translation JSON ──────  │                              │
  │    + PRIVACY_HEADERS         │                              │
```

**Privacy status**: Prefers text path (no image resent). Stateless, no logging, privacy headers set.

#### Stage 5: Discrepancy Check / Report Generation

```
Browser                    Server (generate-report)       Azure OpenAI
  │                              │                              │
  ├─ JSON: DocumentGroup[] ────>│                              │
  │  (all OCR + translations)    ├─ prompt with all docs ──────>│
  │                              │<── report JSON ──────────────│
  │<── report JSON ──────────── │                              │
  │    + PRIVACY_HEADERS         │                              │
```

**Privacy status**: All analyzed document data sent to Azure as part of AI prompt. This is the core purpose of the app. Stateless, no logging, privacy headers set.

#### Stage 6: Report Download

```
Browser (client-side only)
  ├─ JSON download: new Blob([JSON.stringify(report)])  → browser download
  ├─ PDF download: jsPDF → doc.save()                    → browser download
  │
  │  No server involvement
```

**Privacy status**: Pure client-side. Intentional feature. No network call.

---