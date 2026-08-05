# Legal Lens — Feature Guide

A quick guide to the recently added features: **Family Mode**, **Analysis Context**, **Folder Structure Interpretation**, **the main buttons**, and **Deep vs. Light report mode**.

---

## 1. Analysis Context

A free-text box that tells the AI *what you want checked*.

- **Where:** below the file list once files are uploaded — labeled **"Analysis context (optional)"** (sticky-note icon).
- **What to write:** plain English describing your goal. Example:
  > *"Verify that names and dates of birth are consistent across all documents. Flag any discrepancies in the father's name."*
- **What it does:** the text is parsed into structured goals (fields to compare, relationships to check, focus areas) and fed into discrepancy analysis and report generation. The app shows back its interpretation so you can confirm it understood you.
- **Per-document notes:** each file row has a **Notes** button (sticky-note icon, turns amber when notes exist) to add guidance for that one document.

> Tip: be specific. Naming the exact fields or people you care about produces sharper findings than a generic "check everything."

---

## 2. Folder Structure Interpretation

The app can read an uploaded folder layout and use subfolder names as people.

- **How to upload a folder:** click **Choose Folder**, or drag a folder onto the upload area.
- **Expected layout** — one subfolder per person:

  ```
  MyCase/
  ├── John_Smith/
  │   ├── passport.jpg
  │   └── visa.pdf
  └── Jane_Doe/
      ├── passport.jpg
      └── marriage_cert.pdf
  ```

- **What happens (when Family Mode is on):**
  - Each **first-level subfolder** becomes a family member. `John_Smith` → **"John Smith"** (underscores/hyphens become spaces, title-cased).
  - Every file inside that subfolder is **automatically assigned** to that member.
  - Files placed at the root (not in a person subfolder) stay **Unassigned** — assign them manually later.
- **Note:** a folder needs the pattern `Root / Person / file` (at least three levels) for auto-detection to work. If Family Mode is off, folder names are ignored.

---

## 3. Family Mode

Turns the app from single-applicant analysis into **multi-person** analysis, so it can compare shared details *across* people and map relationships.

- **Where:** the **Family Mode** toggle in the Family panel (appears once files are present). It's off by default.
- **What it unlocks:**
  1. **Members** — added automatically from folder names (see above), or manually (name + optional role).
  2. **Document assignment** — a dropdown on each file lets you assign it to a member; unassigned files show an "Unassigned" badge.
  3. **Relationships** — declare them manually (e.g., *spouse of, parent of, child of, sibling of, guardian of, dependent of*), or click **Infer Relationships from Documents** to have the AI detect them from the OCR'd text.
     - Inferred relationships are tagged with confidence (**declared / inferred / unsure**). Promote an inferred one to "declared" with the shield-check icon.
     - You must OCR at least one document before inference will run.
  4. **Cross-person discrepancy checks** — shared fields (parent names, addresses, etc.) are compared **between different people's documents**, which avoids false flags when the same field naturally repeats across one person's papers.

> Typical flow: enable Family Mode → upload a per-person folder → confirm members → run analysis → review cross-person findings in the report.

---

## 4. Deep Mode vs. Light Mode

Controls how thoroughly each document is analyzed for the report. Set in **Settings (⚙️ gear icon, top-right) → Report Mode**.

| Mode | What it does | Speed / cost | Best for |
|------|--------------|--------------|----------|
| **Light** *(default)* | Builds each document's summary from the locally extracted OCR fields — **no extra AI calls per document**. | Fast, cheap, deterministic | Most cases; routine checks |
| **Deep** | Makes **one AI call per document** so the model re-reads and analyzes each one individually. Shows per-document progress ("Read document X/Y…"). | Slower, more AI usage | Complex cases needing richer per-document detail |

> **Note:** changing Report Mode takes effect **after restarting the app**. Both modes still run the cross-document discrepancy and report-generation steps — Deep mode only adds the per-document AI read.

---

## 5. Button Reference

### Main pipeline (top action bar)

| Button | What it does |
|--------|--------------|
| **Analyze All** | Runs the full pipeline in one click: OCR → translation → relationship inference → report. |
| **Generate Report** / **Re-generate Report** | Builds the analysis report from all analyzed documents. |
| **View & Download** | Opens the report viewer (download as PDF or JSON). |
| **OCR Only** | Runs OCR / document analysis without translating. |
| **Translate Only** / **Translate All** | Translates documents (non-English → English) without re-analyzing. |
| **Download Translations** | Exports translations as TXT, DOCX, or JSON. |

### Per-file (file list row)

| Button | What it does |
|--------|--------------|
| **View** (eye) | Full-screen viewer of OCR text and extracted data. |
| **OCR** (brain) | Analyze just this file (shown if not yet analyzed). |
| **Translate** (languages) | Translate just this file (shown if it needs it). |
| **Notes** (sticky note) | Add per-document analysis guidance; amber when notes exist. |
| **Remove** (✕) | Delete the file from the list. |

### Upload & header

| Button | What it does |
|--------|--------------|
| **Choose Files** | Pick individual files (images, PDFs, DOCX). |
| **Choose Folder** | Upload a whole folder with nested files (see Folder Structure). |
| **Settings** (⚙️) | AI provider and Report Mode. |
| **Theme** (moon/sun) | Toggle dark / light UI. |

> During any analysis, a progress bar shows the current stage and percentage, with a **Stop** button to cancel.
