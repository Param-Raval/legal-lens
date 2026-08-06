# BRC Assistant — Feature Guide

This guide explains what the app does and how to use it. No technical background
needed — where something works differently under the hood in a way that matters, there's
a short note about it.

**Contents**

- [The short version](#the-short-version)
- [Uploading documents](#uploading-documents)
- [Telling the app what to look for](#telling-the-app-what-to-look-for)
- [Uploading a folder](#uploading-a-folder)
- [Family Mode: cases with more than one person](#family-mode-cases-with-more-than-one-person)
- [How thorough the analysis is: Deep vs Light](#how-thorough-the-analysis-is-deep-vs-light)
- [Reports](#reports)
- [Translations](#translations)
- [Settings](#settings)
- [Button reference](#button-reference)
- [Tips and common questions](#tips-and-common-questions)

---

## The short version

You give the app a client's documents. It reads them, translates anything that isn't in
English, compares the documents against each other, and writes up a report you can
download.

A typical session looks like this:

1. Type the **client name** at the top (it goes on the report).
2. Upload the documents — photos, scans, PDFs, or Word files.
3. _Optional but recommended:_ write a sentence or two in the **Analysis context** box
   describing what you want checked.
4. Click **Analyze All**. The app reads every document, translates what needs
   translating, and builds the report in one go.
5. Click **View & Download** to read the report and save it as a PDF.

Everything else in this guide is either a shortcut for that flow or a way to handle a more
complicated case.

While anything is running, a progress bar shows the current step and a percentage. There's
a **Stop** button next to it if you need to cancel — nothing you've already finished is
lost.

---

## Uploading documents

Two buttons on the upload area:

- **Choose Files** — pick individual documents.
- **Choose Folder** — pick a whole folder, including the files in its subfolders.

You can also drag files or a folder straight onto the upload area.

Accepted: images (PNG, JPG, GIF, WebP, BMP, TIFF), PDFs, and Word `.docx` files.

**About PDFs.** A PDF is split into its individual pages, and each page is treated as its
own image to be read. Up to 25 pages per PDF are processed — enough for every common
immigration form (the I-589, for instance, is 12 pages). If a PDF is longer than that, the
app tells you it was truncated. For PDFs that already contain real text rather than a scan,
the app also picks up that text and any values typed into form fields, so it isn't relying
on reading the page as a picture.

**About large photos.** A high-resolution phone photo is shrunk automatically before it's
sent for reading. This only happens when a file is genuinely too large, and the dimensions
stay generous enough that text remains legible.

---

## Telling the app what to look for

Once you've uploaded something, an **Analysis context (optional)** box appears below the
file list, marked with a sticky-note icon. Write in plain English what you want checked.
For example:

> Verify that names and dates of birth are consistent across all documents. Flag any
> discrepancies in the father's name.

The app turns that into a specific checklist — which fields to compare, which people and
relationships matter, what to focus on — and uses it when hunting for discrepancies and
when writing the report. The report's opening section repeats back, in its own words, what
it understood you to be asking, so you can confirm it got the point.

Be specific. Naming the exact fields or people you care about produces much sharper
findings than "check everything."

**Notes on a single document.** Every row in the file list has a **Notes** button (also a
sticky note). Use it for guidance about that one document — _"this is the mother's
passport, the spelling differs from the birth certificate on purpose."_ The button turns
amber once a note exists, so you can see at a glance which documents have one. For a
multi-page PDF, the note applies to the whole PDF.

---

## Uploading a folder

If you organise a case as one subfolder per person, the app can read that structure and
save you the work of assigning documents by hand.

Lay the folder out like this:

```
MyCase/
├── John_Smith/
│   ├── passport.jpg
│   └── visa.pdf
└── Jane_Doe/
    ├── passport.jpg
    └── marriage_cert.pdf
```

When **Family Mode** is on and you upload `MyCase`:

- Each first-level subfolder becomes a person. `John_Smith` becomes **John Smith** —
  underscores and hyphens turn into spaces and each word is capitalised.
- Every file inside that subfolder is assigned to that person automatically.
- Any file sitting loose in the top folder stays **Unassigned**; assign it yourself later.

Two things to know:

- The layout needs all three levels — `MyCase / John_Smith / passport.jpg`. If your files
  sit one level up (`MyCase / passport.jpg`), there's no person folder to read and nothing
  is assigned.
- With Family Mode off, folder names are ignored entirely. The files still upload fine.

---

## Family Mode: cases with more than one person

By default the app assumes it's looking at documents for one person. Family Mode switches
it to handling several people at once, which changes what it can check.

Turn it on with the **Family Mode** toggle in the Family panel, which appears once you've
uploaded files. It's off by default, and the app remembers your choice.

**Why it matters.** The same detail repeating across one person's own documents is normal —
your passport and your birth certificate obviously share your date of birth. A mismatch
between _different people's_ documents is the interesting case: the father's name spelled
one way on the child's birth certificate and another way on the father's own ID. With
Family Mode off, the app can't tell those two situations apart and either misses real
problems or flags harmless repetition. With it on, it compares shared fields across people
and knows which comparisons are meaningful.

What Family Mode gives you:

**Members.** Added automatically from folder names, or by hand with a name and an optional
role.

**Document assignment.** Each file row gets a dropdown for picking which person it belongs
to. Unassigned files carry an "Unassigned" badge, and the panel warns you when any remain.

**Relationships.** Either declare them yourself — _spouse of, parent of, child of, sibling
of, guardian of, dependent of,_ or _other_ — or click **Infer Relationships from
Documents** and let the app work them out from what the documents say. Each relationship is
labelled with how confident the app is:

| Label        | Meaning                                                              |
| ------------ | -------------------------------------------------------------------- |
| **declared** | You set it yourself                                                  |
| **inferred** | The app worked it out from the documents and is reasonably confident |
| **unsure**   | The app guessed, and is telling you so                               |

Inferred and unsure relationships come with the app's reasoning, so you can check its work.
If a guess is right, promote it to _declared_ with the shield-check button next to it.

Inference needs something to read: run OCR on at least one document first, or the app will
tell you there's no content to work from.

**Cross-person checks.** Shared fields — parents' names, addresses, dates — are compared
between different people's documents, and those findings appear in their own section of the
report, along with a simple family diagram.

A typical Family Mode session: turn on Family Mode → upload a per-person folder → check the
member list looks right → **Analyze All** → read the cross-person findings in the report.

---

## How thorough the analysis is: Deep vs Light

This is set in **Settings (⚙️) → Report Generation → Report Mode**, and it controls one
thing: how each document's summary for the report is produced.

**Deep** sends every document back to the AI for a second, dedicated read, one document at
a time. You'll see the progress bar count them off — _"Read document 3/7…"_. It's slower
and uses more of your AI quota, but each document gets a richer, more considered write-up.

**Light** builds each document's summary from the information already pulled out during the
initial reading pass, with no extra AI calls. It's fast, free, and gives the same answer
every time.

Either way, the app still does the cross-document comparison and still writes the full
report. The only difference is the per-document detail that feeds into it.

**Which one you get by default:** the installed desktop app uses **Deep**, because it's a
tool for working one case at a time properly. A shared web deployment defaults to
**Light**, so an unattended public instance can't quietly run up a large bill.

Changing the setting takes effect on the **next report you generate** — you don't need to
restart the app.

> **Technical note.** This used to be stored as `NEXT_PUBLIC_REPORT_MODE`, and it never
> actually worked in the installed app: values with that prefix are frozen into the app
> when it's built, so the saved choice was ignored no matter how many times you restarted.
> The setting is now `REPORT_MODE`, read fresh by the server each time a report is
> generated. Old settings files are migrated automatically the first time you save
> Settings — you don't need to do anything.

---

## Reports

**Generate Report** builds the report from every document that's been analyzed.
Once one exists, the button becomes **Re-generate Report** — use it after you've edited
family members or relationships, since those changes affect the findings.

**Fresh Report (+N new)** appears when you've uploaded documents _after_ the last analysis
run. Those documents haven't been read yet, so a plain **Generate Report** would silently
leave them out. Fresh Report analyzes them first and then rebuilds the report with
everything included. A blue notice above the buttons tells you when this applies and how
many documents are affected.

**View & Download** opens the report. From there you can save it as a **PDF** (formatted,
for the file) or as **JSON** (the raw data, for anything that needs to process it). Clicking
a finding jumps you to the document it came from.

What's in a report: an overall assessment, a plain-language restatement of what you asked
for, a side-by-side comparison of key personal details across documents, the discrepancies
it found with a severity for each, a family cross-reference section when Family Mode is on,
and a list of suggested action items.

**Documents that couldn't be read.** If the app judges a document too illegible to trust,
it leaves it out of the report rather than guessing, and says so in the report. If _every_
document is illegible, it stops and asks for clearer scans instead of producing something
misleading.

---

## Translations

Non-English documents are translated to English as part of **Analyze All** — you don't need
to do anything extra.

If you only want translations:

- **Translate Only** appears when nothing has been analyzed yet, and translates without
  doing the full reading pass first.
- **Translate All** translates every document that's been analyzed and needs it.
- Individual rows have their own **Translate** button.

**Download Translations** exports them as **TXT**, **DOCX**, or **JSON**.

The app detects each document's language itself. If it gets one wrong, you can set the
language on that file's row and translate again.

---

## Settings

The gear icon in the top right:

- **AI Provider** — Azure OpenAI (GPT-4o), or a local Ollama server. Each has its own
  fields: endpoint, key, and deployment/model name. Your API key is never displayed back to
  you; once saved it shows as dots, and saving again without retyping it leaves it alone.
- **Report Mode** — Deep or Light, described above.
- **Cached results** — the app remembers the reading and translation of every document it
  has processed, stored in this browser only and never uploaded. That's why re-running a
  case is instant and doesn't cost anything the second time. **Clear cached results** wipes
  that memory and forces a genuinely fresh read next time. Use it if you suspect a stale
  result, or before handing the machine to someone else.

The **?** button next to the gear replays the guided tour of the interface. It runs
automatically the first time the app is opened.

The moon/sun button switches between dark and light appearance.

---

## Button reference

### Main action bar

| Button                                       | What it does                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Analyze All**                              | The whole job in one click: read every document, translate what needs it, work out relationships, build the report |
| **Generate Report** / **Re-generate Report** | Build the report from the documents already analyzed                                                               |
| **Fresh Report (+N new)**                    | Analyze documents added since the last run, then rebuild the report with all of them                               |
| **View & Download**                          | Open the report; download as PDF or JSON                                                                           |
| **OCR Only**                                 | Read the documents without translating                                                                             |
| **Translate Only**                           | Translate without reading first (shown before anything is analyzed)                                                |
| **Translate All**                            | Translate every analyzed document that needs it                                                                    |
| **Download Translations**                    | Export translations as TXT, DOCX, or JSON                                                                          |
| **Stop**                                     | Cancel whatever is currently running                                                                               |

### Each row in the file list

| Button                    | What it does                                                     |
| ------------------------- | ---------------------------------------------------------------- |
| **View** (eye)            | Full-screen view of the text and details read from that document |
| **OCR** (brain)           | Read just this document                                          |
| **Translate** (languages) | Translate just this document                                     |
| **Notes** (sticky note)   | Add guidance for this document; amber when a note exists         |
| Member dropdown           | Assign this document to a person (Family Mode only)              |
| **Remove** (✕)            | Take this document off the list                                  |

### Upload area and header

| Button               | What it does                             |
| -------------------- | ---------------------------------------- |
| **Choose Files**     | Pick individual documents                |
| **Choose Folder**    | Upload a folder, including subfolders    |
| **Settings** (⚙️)    | AI provider, report mode, cached results |
| **Guided tour** (?)  | Replay the walkthrough of the interface  |
| **Theme** (moon/sun) | Switch dark / light appearance           |

---

## Tips and common questions

**Write an analysis context.** It's the single biggest difference between a vague report and
a useful one.

**Newly uploaded documents don't appear in the report.** They haven't been read yet. Use
**Fresh Report**, which is exactly what that button is for.

**A finding looks wrong.** Open the document with the eye icon and compare against what the
app actually read. Poor scans are the usual cause — the report flags documents it had
trouble with.

**Re-running a case is instant and free.** Results are cached per document. If you actually
want a fresh read, clear the cache in Settings first.

**Turn on Family Mode for any case with more than one person.** Without it, cross-person
comparisons — usually the whole point — aren't available.

**Something failed midway.** Nothing already completed is lost. Fix the cause and re-run;
the cache means finished documents aren't paid for twice.
