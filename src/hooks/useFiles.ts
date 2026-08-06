import { useState, useCallback, useRef, useEffect } from 'react';
import {
  FileInfo,
  OCRResult,
  TranslationResult,
  ClassifiedFieldFinding,
  DiscrepancyCheck,
  AnalysisReport,
  DocumentGroup,
  DocumentPage,
  DocumentSummary,
  FamilyMember,
  FamilyGraph,
  FamilyRelationship,
  MemberColorKey,
  ParsedIntent,
} from '@/types';
import { extractPdfPages } from '@/lib/pdf-extract';
import { downscaleImageForUpload } from '@/lib/image-downscale';
import {
  MEMBER_COLOR_KEYS,
  canAnalyzeFile,
  canTranslateFile,
  isDocxFile,
} from '@/lib/utils';
import { buildDocumentSummaryFromOCR } from '@/lib/document-summary';
import { fetchReportMode } from '@/lib/report-mode-client';
import {
  getCachedOcr,
  setCachedOcr,
  getCachedTranslation,
  setCachedTranslation,
} from '@/lib/result-cache';
import JSZip from 'jszip';

/** Sentinel error thrown when the user cancels processing. */
class AbortedError extends Error {
  constructor() {
    super('Processing stopped by user');
    this.name = 'AbortedError';
  }
}

// ── Whole-document analysis for born-digital multi-page PDFs ────────────────

type WholeDocPlan = Map<string, { combinedText?: string; coveredBy?: string }>;

/**
 * Plan whole-document analysis for born-digital multi-page PDFs.
 *
 * A USCIS-style form describes several people (applicant, spouse, children,
 * parents, siblings) in clearly labeled sections. Analyzing each page in
 * isolation makes the model treat e.g. the spouse page as its own subject, so
 * the applicant's and spouse's fields collapse into the same buckets and get
 * flagged as false conflicts. Sending ALL pages in ONE call gives the model the
 * context to attribute each field to the correct person (and is cheaper than N
 * per-page calls).
 *
 * Returns a map keyed by FileInfo.id:
 *   { combinedText } — group LEAD page: send this text (all pages) in one call.
 *   { coveredBy }    — covered by the lead; skip the API entirely.
 * Only groups where every page is born-digital (has a text layer) AND there is
 * more than one page are planned; scanned/mixed/single-page keep per-page OCR.
 */
function buildWholeDocPdfPlan(fileList: FileInfo[]): WholeDocPlan {
  const bySource = new Map<string, FileInfo[]>();
  for (const f of fileList) {
    if (!f.pdfSourceId) continue;
    const arr = bySource.get(f.pdfSourceId);
    if (arr) arr.push(f);
    else bySource.set(f.pdfSourceId, [f]);
  }
  const plan: WholeDocPlan = new Map();
  for (const pages of bySource.values()) {
    if (pages.length < 2) continue; // single page → per-page is fine
    if (pages.some(f => !f.pdfTextLayer)) continue; // scanned/mixed → vision OCR per page
    const sorted = [...pages].sort(
      (a, b) => (a.pdfPageNumber ?? 0) - (b.pdfPageNumber ?? 0)
    );
    const combinedText = sorted
      .map(f => `--- Page ${f.pdfPageNumber ?? 1} ---\n${f.pdfTextLayer}`)
      .join('\n\n');
    plan.set(sorted[0].id, { combinedText });
    for (const f of sorted.slice(1)) plan.set(f.id, { coveredBy: sorted[0].id });
  }
  return plan;
}

/**
 * Minimal placeholder analysis for pages covered by a whole-document lead.
 * Contributes no fields/text to the group; language 'en' so it is never queued
 * for translation (the lead page carries the full text + any translation).
 */
function coveredPageAnalysis(): OCRResult {
  return {
    text: '',
    document_type: '',
    document_language: 'en',
    structured_data: { fields: [] },
  };
}

// ── Folder-path helpers (for family member seeding from folder structure) ──

/**
 * Given a drag-drop entry.fullPath or webkitRelativePath such as
 * "/ClientCase/John_Smith/passport.jpg" or "ClientCase/John_Smith/passport.jpg",
 * returns the direct subfolder name one level below the root ("John_Smith").
 * Returns undefined when the file sits directly in the root (no subfamily).
 */
function extractFamilyFolderName(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const parts = path.replace(/^\//, '').split('/');
  // parts[0] = root folder, parts[1] = member subfolder, parts[last] = filename
  // Need at least 3 parts to have a real subfamily.
  return parts.length >= 3 ? parts[1] : undefined;
}

function toFamilyMemberDisplayName(raw: string): string {
  return raw
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function slugifyFolderName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export type PipelineStage =
  | 'idle'
  | 'analyzing'
  | 'translating'
  | 'generating-report'
  | 'complete';

export interface PipelineProgress {
  stage: PipelineStage;
  /** 0–100 */
  percent: number;
  /** Human-readable status */
  message: string;
}

const CLIENT_MAX_RETRIES = 6;
const CLIENT_BASE_DELAY_S = 10;
/** Cooldown between sequential API calls to avoid rate-limit bursts (ms). */
const INTER_REQUEST_DELAY_MS = 2000;
/** OCR requests fired concurrently per batch; cooldown applied between batches (was 1). */
const PIPELINE_OCR_BATCH_SIZE = 2;

/**
 * Build a user-facing message from an API error response.
 *
 * The server (src/lib/api-guard.ts safeErrorResponse) returns
 * { error, kind, reference, retryable } — the reference is the id stamped on the
 * matching server-log line, so appending it here is what lets a user report an
 * error the operator can actually find.
 */
function apiErrorMessage(data: unknown, fallback: string): string {
  const d = (data ?? {}) as { error?: unknown; reference?: unknown };
  const msg = typeof d.error === 'string' && d.error ? d.error : fallback;
  return typeof d.reference === 'string' && d.reference
    ? `${msg} (Ref: ${d.reference})`
    : msg;
}

const WORD_NAMESPACE =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function createTextAnalysis(
  text: string,
  documentType = 'Word document'
): OCRResult {
  return {
    text,
    document_type: documentType,
    document_language: 'unknown',
    structured_data: { fields: [] },
    illegibility: {
      detected: false,
      confidence: 'high',
    },
  };
}

async function extractDocxText(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const documentXml = await zip.file('word/document.xml')?.async('text');

  if (!documentXml) {
    throw new Error(`"${file.name}" is not a valid .docx file.`);
  }

  const xmlDoc = new DOMParser().parseFromString(
    documentXml,
    'application/xml'
  );
  if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`"${file.name}" could not be read as a .docx file.`);
  }

  const paragraphs = Array.from(
    xmlDoc.getElementsByTagNameNS(WORD_NAMESPACE, 'p')
  )
    .map(paragraph =>
      Array.from(paragraph.getElementsByTagNameNS(WORD_NAMESPACE, 't'))
        .map(node => node.textContent ?? '')
        .join('')
        .trim()
    )
    .filter(Boolean);

  const text = paragraphs.join('\n');
  if (!text.trim()) {
    throw new Error(`No readable text was found in "${file.name}".`);
  }

  return text;
}

async function appendTranslationInput(
  formData: FormData,
  file: FileInfo
): Promise<void> {
  formData.append('targetLanguage', 'en');
  if (file.languageHint) {
    formData.append('languageHint', file.languageHint);
  }

  if (file.analysis) {
    formData.append('ocrText', file.analysis.text || '');
    formData.append(
      'ocrFields',
      JSON.stringify(file.analysis.structured_data?.fields || [])
    );
    formData.append(
      'ocrLanguage',
      file.analysis.document_language || 'unknown'
    );
    return;
  }

  if (isDocxFile(file)) {
    const text = await extractDocxText(file.file);
    formData.append('ocrText', text);
    formData.append('ocrFields', '[]');
    formData.append('ocrLanguage', file.languageHint || 'unknown');
    return;
  }

  formData.append('file', file.file);
}

export const useFiles = () => {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isAnalyzing, setIsAnalyzing] = useState<number | null>(null);
  const [isTranslating, setIsTranslating] = useState<number | null>(null);
  const [discrepancyCheck, setDiscrepancyCheck] = useState<DiscrepancyCheck>({
    hasDiscrepancies: false,
    summary: '',
    isChecking: false,
  });
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [clientName, setClientName] = useState('Client');
  const [error, setError] = useState('');
  const [isPdfExtracting, setIsPdfExtracting] = useState(false);
  const [pipeline, setPipeline] = useState<PipelineProgress>({
    stage: 'idle',
    percent: 0,
    message: '',
  });

  // ── Family mode state ─────────────────────────────────────────────────
  const [familyModeEnabled, setFamilyModeEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return JSON.parse(localStorage.getItem('familyModeEnabled') ?? 'false');
    } catch {
      return false;
    }
  });
  const [familyGraph, setFamilyGraph] = useState<FamilyGraph>({
    members: [],
    relationships: [],
  });
  const [isInferringRelationships, setIsInferringRelationships] =
    useState(false);
  const [inferStatus, setInferStatus] = useState<{
    type: 'error' | 'success';
    message: string;
  } | null>(null);

  // ── User analysis context state ──────────────────────────────────────────────
  /** Free-text context the user enters to guide the analysis */
  const [analysisContext, setAnalysisContext] = useState('');
  /** Structured intent parsed from analysisContext by the Intent Parser agent */
  const [parsedIntent, setParsedIntent] = useState<ParsedIntent | null>(null);
  const [isParsingIntent, setIsParsingIntent] = useState(false);

  // Persist family mode toggle preference to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        'familyModeEnabled',
        JSON.stringify(familyModeEnabled)
      );
    } catch {
      /* quota */
    }
  }, [familyModeEnabled]);

  // Ref so countdown helper can update pipeline without stale closures
  const pipelineRef = useRef(pipeline);
  pipelineRef.current = pipeline;

  // AbortController for cancelling in-flight requests
  const abortRef = useRef<AbortController | null>(null);

  /** Create a fresh AbortController (cancels any existing one first). */
  const freshAbort = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    return ctrl;
  }, []);

  /** Stop any in-flight processing and reset busy states. */
  const stopProcessing = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsAnalyzing(null);
    setIsTranslating(null);
    setIsGeneratingReport(false);
    setDiscrepancyCheck(prev => ({ ...prev, isChecking: false }));
    setPipeline({ stage: 'idle', percent: 0, message: '' });
  }, []);

  /**
   * Wraps a fetch call with client-side 429 retry + countdown that updates
   * the pipeline progress bar so the user sees how long they're waiting.
   */
  const fetchWithRetry = useCallback(
    async (
      input: RequestInfo,
      init?: RequestInit,
      signal?: AbortSignal
    ): Promise<Response> => {
      for (let attempt = 0; attempt <= CLIENT_MAX_RETRIES; attempt++) {
        signal?.throwIfAborted();
        const response = await fetch(input, { ...init, signal });

        if (response.status === 429 && attempt < CLIENT_MAX_RETRIES) {
          const data = await response.json().catch(() => ({}));
          const waitSeconds =
            data.retryAfterSeconds || CLIENT_BASE_DELAY_S * (attempt + 1);
          const prevMsg = pipelineRef.current.message;
          const prevPercent = pipelineRef.current.percent;
          const prevStage = pipelineRef.current.stage;

          // Countdown
          for (let s = waitSeconds; s > 0; s--) {
            signal?.throwIfAborted();
            setPipeline({
              stage: prevStage !== 'idle' ? prevStage : 'analyzing',
              percent: prevPercent,
              message: `Rate limited — retrying in ${s}s…`,
            });
            await new Promise(r => setTimeout(r, 1000));
          }

          // Restore original message for the retry
          setPipeline({
            stage: prevStage !== 'idle' ? prevStage : 'analyzing',
            percent: prevPercent,
            message: prevMsg,
          });
          continue;
        }

        return response;
      }

      // Should never reach here, but safety net
      throw new Error(
        'Rate limited after multiple retries. Please wait and try again.'
      );
    },
    []
  );

  const uploadFiles = useCallback(
    async (entries: Array<{ file: File; folderPath?: string }>) => {
      setError('');
      setReport(null);
      setDiscrepancyCheck({
        hasDiscrepancies: false,
        summary: '',
        isChecking: false,
      });
      // Clear family graph when new files are uploaded — members/relationships
      // are specific to a document set and should not carry over
      setFamilyGraph({ members: [], relationships: [] });
      setInferStatus(null);

      // Deduplicate silently against already-uploaded files and this batch.
      const existingFileKeys = new Set(
        files.map(f =>
          f.pdfSourceId
            ? f.pdfSourceId
            : `file::${f.name}::${f.size}::${f.file.lastModified}`
        )
      );
      const filteredEntries = entries.filter(({ file }) => {
        const key =
          file.type === 'application/pdf' ||
          file.name.toLowerCase().endsWith('.pdf')
            ? `pdf::${file.name}::${file.size}::${file.lastModified}`
            : `file::${file.name}::${file.size}::${file.lastModified}`;

        if (existingFileKeys.has(key)) {
          return false;
        }
        existingFileKeys.add(key);
        return true;
      });

      if (filteredEntries.length === 0) return;

      // ── Seed family members from folder structure ────────────────────────
      // Build a raw-folder-name → FamilyMember map upfront so FileInfo objects
      // can be pre-assigned to the right member when they are created below.
      const folderToMemberId = new Map<string, string>(); // rawFolderName → member.id
      if (familyModeEnabled) {
        const seenFolders = new Map<string, string>(); // rawName → displayName
        for (const { folderPath } of filteredEntries) {
          const raw = extractFamilyFolderName(folderPath);
          if (raw && !seenFolders.has(raw)) {
            seenFolders.set(raw, toFamilyMemberDisplayName(raw));
          }
        }
        if (seenFolders.size > 0) {
          const newMembers: FamilyMember[] = Array.from(
            seenFolders.entries()
          ).map(([, displayName], idx) => ({
            id: `folder-member-${slugifyFolderName(displayName)}`,
            name: displayName,
            color: MEMBER_COLOR_KEYS[
              idx % MEMBER_COLOR_KEYS.length
            ] as MemberColorKey,
          }));
          newMembers.forEach((m, i) => {
            const rawName = Array.from(seenFolders.keys())[i];
            folderToMemberId.set(rawName, m.id);
          });
          setFamilyGraph({ members: newMembers, relationships: [] });
        }
      }

      /** Resolve the familyMemberId for a given folderPath (or undefined). */
      const getMemberId = (
        folderPath: string | undefined
      ): string | undefined => {
        const raw = extractFamilyFolderName(folderPath);
        return raw ? folderToMemberId.get(raw) : undefined;
      };

      // Separate PDFs from other uploads so we can append the non-PDF files
      // immediately and stream in PDF pages as they finish extracting.
      const pdfs: Array<{ file: File; folderPath?: string }> = [];
      const nonPdfs: FileInfo[] = [];
      for (const entry of filteredEntries) {
        const { file, folderPath } = entry;
        const memberId = getMemberId(folderPath);
        if (
          file.type === 'application/pdf' ||
          file.name.toLowerCase().endsWith('.pdf')
        ) {
          pdfs.push(entry);
        } else if (isDocxFile(file)) {
          try {
            const text = await extractDocxText(file);
            nonPdfs.push({
              id: `${file.name}-${file.lastModified}`,
              name: file.name,
              size: file.size,
              type: file.type,
              file,
              analysis: createTextAnalysis(text),
              folderPath,
              familyMemberId: memberId,
            });
          } catch (err) {
            nonPdfs.push({
              id: `${file.name}-${file.lastModified}`,
              name: file.name,
              size: file.size,
              type: file.type,
              file,
              folderPath,
              familyMemberId: memberId,
            });
            setError(
              err instanceof Error
                ? err.message
                : `Failed to read "${file.name}".`
            );
          }
        } else {
          // Downscale oversized raster images BEFORE they enter state, so every
          // downstream upload (analyze + translate) and the result-cache key use
          // the smaller file. Raw phone photos / hi-res scans otherwise exceed
          // Vercel's 4.5 MB serverless body limit and fail with an opaque 413.
          const uploadFile = await downscaleImageForUpload(file);
          nonPdfs.push({
            id: `${file.name}-${file.lastModified}`,
            name: file.name,
            size: uploadFile.size,
            type: uploadFile.type,
            file: uploadFile,
            folderPath,
            familyMemberId: memberId,
          });
        }
      }

      // Append non-PDF files immediately so the UI stays responsive.
      if (nonPdfs.length > 0) {
        setFiles(prev => [...prev, ...nonPdfs]);
      }

      if (pdfs.length === 0) return;

      // Extract PDF pages asynchronously
      setIsPdfExtracting(true);
      (async () => {
        const warnings: string[] = [];
        for (const pdfEntry of pdfs) {
          const { file: pdf, folderPath: pdfFolderPath } = pdfEntry;
          const pdfMemberId = getMemberId(pdfFolderPath);
          try {
            const result = await extractPdfPages(pdf);
            // Tag all pages with the member ID derived from the folder path
            const pages = pdfMemberId
              ? result.pages.map(p => ({
                  ...p,
                  familyMemberId: pdfMemberId,
                  folderPath: pdfFolderPath,
                }))
              : result.pages;
            setFiles(prev => [...prev, ...pages]);
            if (result.truncated) {
              warnings.push(
                `"${pdf.name}" has ${result.totalPagesInPdf} pages — only the first 10 were extracted.`
              );
            }
          } catch (err) {
            const msg =
              err instanceof Error
                ? err.message
                : `Failed to read "${pdf.name}".`;
            warnings.push(msg);
          }
        }
        setIsPdfExtracting(false);
        if (warnings.length) setError(warnings.join(' '));
      })();
    },
    [files, familyModeEnabled]
  );

  const removeFile = useCallback((indexOrGroupId: number | string) => {
    if (typeof indexOrGroupId === 'number') {
      // Remove a single file by index
      setFiles(prev => prev.filter((_, idx) => idx !== indexOrGroupId));
    } else {
      // Remove all files in a PDF group by pdfSourceId
      setFiles(prev => prev.filter(f => f.pdfSourceId !== indexOrGroupId));
    }
  }, []);

  const setFileLanguage = useCallback((index: number, languageHint: string) => {
    setFiles(prev => {
      const target = prev[index];
      if (!target) return prev;
      const hint = languageHint || undefined;
      // If the file belongs to a PDF group, propagate the hint to all pages
      if (target.pdfSourceId) {
        return prev.map(f =>
          f.pdfSourceId === target.pdfSourceId
            ? { ...f, languageHint: hint }
            : f
        );
      }
      return prev.map((f, i) =>
        i === index ? { ...f, languageHint: hint } : f
      );
    });
  }, []);

  // ── Group files into logical documents for API payloads ───────────────

  /**
   * Returns the worst-case illegibility confidence across all OCR pages in a
   * DocumentGroup. Used to decide whether to include/exclude a group from the
   * AI report so hallucinated content never enters the analysis.
   */
  function getGroupIllegibilityConfidence(
    group: DocumentGroup
  ): 'high' | 'medium' | 'low' {
    const RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
    let worst = 0;
    for (const page of group.pages) {
      const conf =
        (page.extracted_data?.illegibility?.confidence as string | undefined) ??
        'high';
      const r = RANK[conf] ?? 0;
      if (r > worst) worst = r;
    }
    return worst >= 2 ? 'low' : worst === 1 ? 'medium' : 'high';
  }

  /**
   * Build document groups from the flat FileInfo array.
   * Pages from the same PDF are merged into a single group; standalone
   * images each become their own single-page group.
   * Only files with analysis data are included.
   * When family mode is active, each group carries its family member assignment.
   */
  const buildGroupedDocuments = useCallback(
    (
      fileList: FileInfo[],
      membersOverride?: FamilyMember[]
    ): DocumentGroup[] => {
      const groupMap = new Map<string, DocumentPage[]>();
      const groupNames = new Map<string, string>();
      const groupMemberIds = new Map<string, string | undefined>();
      const groupOrder: string[] = [];

      // Build a quick id→member lookup. membersOverride lets generateFreshReport
      // pass members the pipeline just inferred, which aren't in state yet.
      const memberById = new Map<string, FamilyMember>(
        (membersOverride ?? familyGraph.members).map(m => [m.id, m])
      );

      for (const f of fileList) {
        if (!f.analysis) continue;
        const key = f.pdfSourceId ?? f.id;
        if (!groupMap.has(key)) {
          groupMap.set(key, []);
          groupNames.set(key, f.pdfSourceName ?? f.name);
          groupMemberIds.set(key, f.familyMemberId);
          groupOrder.push(key);
        }
        groupMap.get(key)!.push({
          pageNumber: f.pdfPageNumber ?? 1,
          name: f.name,
          extracted_data: f.analysis,
          translation_data: f.translation ?? null,
        });
      }

      return groupOrder.map(key => {
        const memberId = groupMemberIds.get(key);
        const member = memberId ? memberById.get(memberId) : undefined;
        return {
          name: groupNames.get(key)!,
          groupId: key,
          pages: groupMap.get(key)!.sort((a, b) => a.pageNumber - b.pageNumber),
          familyMemberId: memberId,
          familyMemberName: member?.name,
        };
      });
    },
    [familyGraph.members]
  );

  // ── Persist results to disk (fire-and-forget) ─────────────────────────

  const saveResultsToDisk = useCallback(
    (fileName: string, ocr?: OCRResult, translation?: TranslationResult) => {
      // Only persist results in local development — never send document text
      // to the server in production where there is nothing to write to disk.
      if (
        process.env.NEXT_PUBLIC_ENABLE_SAVE !== 'true' &&
        process.env.NODE_ENV !== 'development'
      )
        return;

      fetch('/api/save-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName,
          fileName,
          ocr: ocr || undefined,
          translation: translation || undefined,
        }),
      }).catch(err => console.warn('[save-results] failed:', err));
    },
    [clientName]
  );

  // ── Family mode management ─────────────────────────────────────────────

  const toggleFamilyMode = useCallback(() => {
    setFamilyModeEnabled(prev => !prev);
  }, []);

  const addFamilyMember = useCallback(
    (name: string, role?: string) => {
      const id = `member-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const colorIdx = familyGraph.members.length % MEMBER_COLOR_KEYS.length;
      const color = MEMBER_COLOR_KEYS[colorIdx] as MemberColorKey;
      setFamilyGraph(prev => ({
        ...prev,
        members: [
          ...prev.members,
          { id, name: name.trim(), role: role?.trim() || undefined, color },
        ],
      }));
    },
    [familyGraph.members.length]
  );

  const removeFamilyMember = useCallback((id: string) => {
    setFamilyGraph(prev => ({
      members: prev.members.filter(m => m.id !== id),
      relationships: prev.relationships.filter(
        r => r.fromId !== id && r.toId !== id
      ),
    }));
    setFiles(prev =>
      prev.map(f =>
        f.familyMemberId === id ? { ...f, familyMemberId: undefined } : f
      )
    );
  }, []);

  const updateFamilyMember = useCallback(
    (id: string, updates: Partial<Pick<FamilyMember, 'name' | 'role'>>) => {
      setFamilyGraph(prev => ({
        ...prev,
        members: prev.members.map(m =>
          m.id === id
            ? { ...m, ...updates, name: updates.name?.trim() ?? m.name }
            : m
        ),
      }));
    },
    []
  );

  /**
   * Assign all files belonging to a group (identified by groupId = pdfSourceId or file.id)
   * to the specified family member. Pass memberId = '' to unassign.
   */
  const assignDocumentToMember = useCallback(
    (groupId: string, memberId: string) => {
      const effectiveMemberId = memberId || undefined;
      setFiles(prev =>
        prev.map(f => {
          const fileGroupId = f.pdfSourceId ?? f.id;
          if (fileGroupId === groupId) {
            return { ...f, familyMemberId: effectiveMemberId };
          }
          return f;
        })
      );
    },
    []
  );

  const addRelationship = useCallback(
    (fromId: string, toId: string, relationshipType: string) => {
      const rel: FamilyRelationship = {
        fromId,
        toId,
        relationshipType: relationshipType.trim(),
        confidence: 'declared',
      };
      setFamilyGraph(prev => ({
        ...prev,
        relationships: [
          ...prev.relationships.filter(
            r =>
              !(
                r.fromId === fromId &&
                r.toId === toId &&
                r.confidence === 'declared'
              )
          ),
          rel,
        ],
      }));
    },
    []
  );

  const removeRelationship = useCallback(
    (
      fromId: string,
      toId: string,
      confidence: FamilyRelationship['confidence']
    ) => {
      setFamilyGraph(prev => ({
        ...prev,
        relationships: prev.relationships.filter(
          r =>
            !(
              r.fromId === fromId &&
              r.toId === toId &&
              r.confidence === confidence
            )
        ),
      }));
    },
    []
  );

  /**
   * Update an existing relationship's type and/or promote its confidence.
   * Identified by (fromId + toId + currentConfidence).
   */
  const updateRelationship = useCallback(
    (
      fromId: string,
      toId: string,
      currentConfidence: FamilyRelationship['confidence'],
      updates: Partial<
        Pick<FamilyRelationship, 'relationshipType' | 'confidence'>
      >
    ) => {
      setFamilyGraph(prev => ({
        ...prev,
        relationships: prev.relationships.map(r =>
          r.fromId === fromId &&
          r.toId === toId &&
          r.confidence === currentConfidence
            ? { ...r, ...updates }
            : r
        ),
      }));
    },
    []
  );

  /**
   * Call the AI to infer family relationships from document content.
   * Passes ALL analyzed documents to the AI (assigned and unassigned alike).
   * Merges inferred/unsure relationships into the graph; declared ones are kept.
   * Returns an inline status object instead of using the global error state so
   * FamilyMemberPanel can show it next to the Infer button.
   */
  const inferRelationships = useCallback(async () => {
    if (familyGraph.members.length < 2) {
      setInferStatus({
        type: 'error',
        message: 'Add at least 2 family members first.',
      });
      return;
    }
    const groups = buildGroupedDocuments(files);
    if (groups.length === 0) {
      setInferStatus({
        type: 'error',
        message:
          'Run OCR on at least one document first so the AI has content to analyse.',
      });
      return;
    }

    setIsInferringRelationships(true);
    setInferStatus(null);
    setError('');

    try {
      const response = await fetch('/api/infer-relationships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documents: groups,
          familyMembers: familyGraph.members,
          perDocNotes: files
            .filter(f => f.userNotes)
            .map(f => ({ fileName: f.name, notes: f.userNotes! })),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, 'Relationship inference failed'));
      }

      const result = await response.json();
      const inferred: FamilyRelationship[] = result.relationships ?? [];

      setFamilyGraph(prev => ({
        ...prev,
        relationships: [
          ...prev.relationships.filter(r => r.confidence === 'declared'),
          ...inferred,
        ],
      }));
      setInferStatus(
        inferred.length > 0
          ? {
              type: 'success',
              message: `Found ${inferred.length} relationship${inferred.length !== 1 ? 's' : ''}. Review and promote any you agree with.`,
            }
          : {
              type: 'success',
              message:
                'No relationships could be inferred from the available document content. Try assigning documents to members first.',
            }
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Relationship inference failed';
      setInferStatus({ type: 'error', message: msg });
    } finally {
      setIsInferringRelationships(false);
    }
  }, [files, buildGroupedDocuments, familyGraph.members]);

  // ── OCR / Analyze ─────────────────────────────────────────────────────

  const analyzeFile = useCallback(
    async (index: number) => {
      const file = files[index];
      if (!file || !canAnalyzeFile(file)) {
        setError('Only image and DOCX files can be analyzed');
        return;
      }

      const ctrl = freshAbort();
      setIsAnalyzing(index);
      setError('');
      setPipeline({
        stage: 'analyzing',
        percent: 0,
        message: `Analyzing ${file.name}...`,
      });

      try {
        // If this page belongs to a born-digital multi-page PDF, analyze the
        // WHOLE document in one call (correct per-person attribution) and mark
        // the other pages covered, rather than analyzing this page alone.
        const wholeDocPlan = buildWholeDocPdfPlan(files);
        const planEntry = wholeDocPlan.get(file.id);
        if (planEntry && (planEntry.combinedText || planEntry.coveredBy)) {
          const leadId = planEntry.combinedText ? file.id : planEntry.coveredBy!;
          const leadFile = files.find(f => f.id === leadId);
          const leadText =
            wholeDocPlan.get(leadId)?.combinedText ?? planEntry.combinedText;
          const formData = new FormData();
          formData.append('pdfText', leadText!);
          if (leadFile?.languageHint)
            formData.append('languageHint', leadFile.languageHint);
          const response = await fetchWithRetry(
            '/api/analyze',
            { method: 'POST', body: formData },
            ctrl.signal
          );
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(apiErrorMessage(data, 'Analysis failed'));
          }
          const groupAnalysis = (await response.json()) as OCRResult;
          if (leadFile)
            void setCachedOcr(leadFile.file, leadFile.languageHint, groupAnalysis);
          setFiles(prev =>
            prev.map(f => {
              if (f.id === leadId) return { ...f, analysis: groupAnalysis };
              if (wholeDocPlan.get(f.id)?.coveredBy === leadId)
                return {
                  ...f,
                  analysis: coveredPageAnalysis(),
                  pdfWholeCovered: true,
                };
              return f;
            })
          );
          if (leadFile) saveResultsToDisk(leadFile.name, groupAnalysis);
          setPipeline({ stage: 'complete', percent: 100, message: 'Done!' });
          return;
        }

        let analysis: OCRResult;
        if (isDocxFile(file)) {
          analysis = createTextAnalysis(await extractDocxText(file.file));
        } else {
          const cached = await getCachedOcr(file.file, file.languageHint);
          if (cached) {
            analysis = cached;
          } else {
            const formData = new FormData();
            if (file.pdfTextLayer) {
              formData.append('pdfText', file.pdfTextLayer);
            } else {
              formData.append('file', file.file);
            }
            if (file.languageHint) {
              formData.append('languageHint', file.languageHint);
            }

            const response = await fetchWithRetry(
              '/api/analyze',
              { method: 'POST', body: formData },
              ctrl.signal
            );

            if (!response.ok) {
              const data = await response.json().catch(() => ({}));
              throw new Error(apiErrorMessage(data, 'Analysis failed'));
            }

            analysis = await response.json();
            void setCachedOcr(file.file, file.languageHint, analysis);
          }
        }

        setFiles(prev =>
          prev.map((f, i) => (i === index ? { ...f, analysis } : f))
        );
        // Save OCR result to disk
        saveResultsToDisk(file.name, analysis);
        setPipeline({ stage: 'complete', percent: 100, message: 'Done!' });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof AbortedError) return;
        setError(err instanceof Error ? err.message : 'Analysis failed');
        setPipeline({ stage: 'idle', percent: 0, message: '' });
      } finally {
        setIsAnalyzing(null);
      }
    },
    [files, fetchWithRetry, freshAbort, saveResultsToDisk]
  );

  const analyzeAllFiles = useCallback(async () => {
    const imageFiles = files
      .map((f, i) => ({ file: f, index: i }))
      .filter(({ file }) => canAnalyzeFile(file) && !file.analysis);

    if (!imageFiles.length) {
      setError('No unanalyzed documents found');
      return;
    }

    const ctrl = freshAbort();
    setError('');
    let completed = 0;
    const total = imageFiles.length;

    // Born-digital multi-page PDFs → one whole-document call (see runFullPipeline).
    const wholeDocPlan = buildWholeDocPdfPlan(files);

    setPipeline({
      stage: 'analyzing',
      percent: 0,
      message: `Analyzing 0/${total} files...`,
    });

    for (const { index } of imageFiles) {
      ctrl.signal.throwIfAborted();
      setIsAnalyzing(index);
      setPipeline({
        stage: 'analyzing',
        percent: Math.round((completed / total) * 100),
        message: `Analyzing ${files[index].name} (${completed + 1}/${total})...`,
      });

      try {
        const planEntry = wholeDocPlan.get(files[index].id);
        if (planEntry?.coveredBy) {
          // Covered by this PDF's whole-document lead page — no API call.
          setFiles(prev =>
            prev.map((f, i) =>
              i === index
                ? { ...f, analysis: coveredPageAnalysis(), pdfWholeCovered: true }
                : f
            )
          );
          completed++;
          continue;
        }
        let analysis: OCRResult;
        if (isDocxFile(files[index])) {
          analysis = createTextAnalysis(
            await extractDocxText(files[index].file)
          );
        } else {
          const cached = await getCachedOcr(
            files[index].file,
            files[index].languageHint
          );
          if (cached) {
            analysis = cached;
          } else {
            const formData = new FormData();
            if (planEntry?.combinedText) {
              // Lead page: send ALL pages' text in one call.
              formData.append('pdfText', planEntry.combinedText);
            } else if (files[index].pdfTextLayer) {
              formData.append('pdfText', files[index].pdfTextLayer!);
            } else {
              formData.append('file', files[index].file);
            }
            if (files[index].languageHint) {
              formData.append('languageHint', files[index].languageHint);
            }

            const response = await fetchWithRetry(
              '/api/analyze',
              { method: 'POST', body: formData },
              ctrl.signal
            );

            if (!response.ok) {
              const data = await response.json().catch(() => ({}));
              throw new Error(
                apiErrorMessage(data, `Analysis failed for ${files[index].name}`)
              );
            }

            analysis = await response.json();
            void setCachedOcr(
              files[index].file,
              files[index].languageHint,
              analysis
            );
          }
        }

        setFiles(prev =>
          prev.map((f, i) => (i === index ? { ...f, analysis } : f))
        );
        saveResultsToDisk(files[index].name, analysis);
        completed++;
        // Cooldown between requests to avoid rate-limit bursts
        if (completed < total) {
          await new Promise(r => setTimeout(r, INTER_REQUEST_DELAY_MS));
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof AbortedError) return;
        setError(err instanceof Error ? err.message : 'Analysis failed');
        setPipeline({ stage: 'idle', percent: 0, message: '' });
        setIsAnalyzing(null);
        return;
      }
    }
    setIsAnalyzing(null);
    setPipeline({
      stage: 'complete',
      percent: 100,
      message: `Analyzed ${total} file(s)!`,
    });
  }, [files, fetchWithRetry, freshAbort, saveResultsToDisk]);

  // ── Full Pipeline: OCR → Translate → Report ──────────────────────────

  /**
   * Call the Intent Parser micro-agent if the user has entered analysis context.
   * Returns the structured ParsedIntent or null if context is empty / call fails.
   */
  const parseIntentIfNeeded = useCallback(
    async (signal: AbortSignal): Promise<ParsedIntent | null> => {
      if (!analysisContext.trim()) return null;
      setIsParsingIntent(true);
      setPipeline(prev => ({
        ...prev,
        message: 'Parsing your analysis intent…',
      }));
      try {
        const perDocNotes = files
          .filter(f => f.userNotes)
          .map(f => ({ fileName: f.name, notes: f.userNotes! }));
        const resp = await fetchWithRetry(
          '/api/parse-intent',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ analysisContext, perDocNotes }),
          },
          signal
        );
        if (!resp.ok) return null;
        const intent = (await resp.json()) as ParsedIntent;
        setParsedIntent(intent);
        return intent;
      } catch {
        return null;
      } finally {
        setIsParsingIntent(false);
      }
    },
    [analysisContext, files, fetchWithRetry]
  );

  /**
   * Runs OCR → translation → family inference over all files. Returns the
   * freshest file list and family graph on success (React state updates are
   * async, so callers chaining into report generation must use these instead
   * of the `files`/`familyGraph` state), or null on abort/error.
   */
  const runFullPipeline = useCallback(async (): Promise<{
    files: FileInfo[];
    graph: FamilyGraph;
  } | null> => {
    const ctrl = freshAbort();
    setPipeline({
      stage: 'analyzing',
      percent: 0,
      message: 'Starting analysis pipeline...',
    });
    setError('');

    // Phase 1: OCR / text-extract all analyzable files that haven't been analyzed
    const imageFiles = files
      .map((f, i) => ({ file: f, index: i }))
      .filter(({ file }) => canAnalyzeFile(file) && !file.analysis);

    // Track the latest file state for translation decisions
    let latestFiles = [...files];

    // Born-digital multi-page PDFs are analyzed in ONE whole-document call so
    // fields from different sections (applicant vs. spouse vs. children) are
    // attributed to the right person instead of conflated per page.
    const wholeDocPlan = buildWholeDocPdfPlan(files);

    let ocrCompleted = 0;
    for (let batchStart = 0; batchStart < imageFiles.length; batchStart += PIPELINE_OCR_BATCH_SIZE) {
      ctrl.signal.throwIfAborted();
      const batch = imageFiles.slice(batchStart, batchStart + PIPELINE_OCR_BATCH_SIZE);

      setIsAnalyzing(batch[0].index);
      setPipeline({
        stage: 'analyzing',
        percent: imageFiles.length === 0 ? 50 : Math.round(5 + (ocrCompleted / imageFiles.length) * 45),
        message: batch.length === 1
          ? `Analyzing ${files[batch[0].index].name}...`
          : `Analyzing ${batch.map(b => files[b.index].name).join(', ')}...`,
      });

      let batchResults: Array<{ index: number; analysis: OCRResult; pdfWholeCovered: boolean; fromCache: boolean }>;
      try {
        batchResults = await Promise.all(
          batch.map(async ({ index }) => {
            ctrl.signal.throwIfAborted();
            const planEntry = wholeDocPlan.get(files[index].id);
            if (planEntry?.coveredBy) {
              return { index, analysis: coveredPageAnalysis() as OCRResult, pdfWholeCovered: true, fromCache: true };
            }
            const cached = await getCachedOcr(files[index].file, files[index].languageHint);
            if (cached) {
              return { index, analysis: cached, pdfWholeCovered: false, fromCache: true };
            }
            const formData = new FormData();
            if (planEntry?.combinedText) {
              // Lead page: send ALL pages' text in one call.
              formData.append('pdfText', planEntry.combinedText);
            } else if (files[index].pdfTextLayer) {
              formData.append('pdfText', files[index].pdfTextLayer!);
            } else {
              formData.append('file', files[index].file);
            }
            if (files[index].languageHint) {
              formData.append('languageHint', files[index].languageHint);
            }
            const response = await fetchWithRetry(
              '/api/analyze',
              { method: 'POST', body: formData },
              ctrl.signal
            );
            if (!response.ok) {
              const data = await response.json().catch(() => ({}));
              throw new Error(apiErrorMessage(data, `Analysis failed for ${files[index].name}`));
            }
            const analysis = await response.json() as OCRResult;
            void setCachedOcr(files[index].file, files[index].languageHint, analysis);
            return { index, analysis, pdfWholeCovered: false, fromCache: false };
          })
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError')
          return null;
        if (err instanceof AbortedError) return null;
        setError(err instanceof Error ? err.message : 'Analysis failed');
        setPipeline({ stage: 'idle', percent: 0, message: '' });
        setIsAnalyzing(null);
        return null;
      }

      for (const r of batchResults) {
        const updates: Partial<FileInfo> = { analysis: r.analysis };
        if (r.pdfWholeCovered) updates.pdfWholeCovered = true;
        latestFiles = latestFiles.map((f, i) => i === r.index ? { ...f, ...updates } : f);
        saveResultsToDisk(files[r.index].name, r.analysis);
      }
      setFiles(latestFiles as FileInfo[]);
      ocrCompleted += batch.length;

      // Rate-limit cooldown between batches (skipped when the whole batch was cache hits)
      const anyUncached = batchResults.some(r => !r.fromCache);
      if (anyUncached && batchStart + PIPELINE_OCR_BATCH_SIZE < imageFiles.length) {
        await new Promise(r => setTimeout(r, INTER_REQUEST_DELAY_MS));
      }
    }
    setIsAnalyzing(null);

    // Phase 2: Translate all analyzed files with non-English content.
    // All translation requests fire in parallel — translation calls are text-only
    // and cheap enough that sequential rate-limit delays are not needed.
    const toTranslate = latestFiles
      .map((f, i) => ({ file: f, index: i }))
      .filter(
        ({ file }) =>
          file.type.startsWith('image/') &&
          file.analysis &&
          (file.analysis.document_language !== 'en' ||
            (file.languageHint && file.languageHint !== 'en')) &&
          !file.translation
      );

    if (toTranslate.length > 0) {
      setPipeline({
        stage: 'translating',
        percent: 50,
        message: `Translating ${toTranslate.length} document(s)...`,
      });

      let transResults: Array<{ index: number; translation: TranslationResult }>;
      try {
        transResults = await Promise.all(
          toTranslate.map(async ({ index }) => {
            ctrl.signal.throwIfAborted();
            setIsTranslating(index);
            const cachedTr = await getCachedTranslation(
              latestFiles[index].file,
              'en',
              latestFiles[index].languageHint
            );
            if (cachedTr) return { index, translation: cachedTr };
            const formData = new FormData();
            formData.append('targetLanguage', 'en');
            if (latestFiles[index].languageHint) {
              formData.append('languageHint', latestFiles[index].languageHint!);
            }
            if (latestFiles[index].analysis) {
              // Text path – no file bytes needed.
              formData.append('ocrText', (latestFiles[index].analysis as OCRResult).text || '');
              formData.append(
                'ocrFields',
                JSON.stringify((latestFiles[index].analysis as OCRResult).structured_data?.fields || [])
              );
              formData.append(
                'ocrLanguage',
                (latestFiles[index].analysis as OCRResult).document_language || ''
              );
            } else {
              formData.append('file', latestFiles[index].file);
            }
            const response = await fetchWithRetry(
              '/api/translate',
              { method: 'POST', body: formData },
              ctrl.signal
            );
            if (!response.ok) {
              const data = await response.json().catch(() => ({}));
              throw new Error(apiErrorMessage(data, `Translation failed for ${latestFiles[index].name}`));
            }
            const translation = await response.json() as TranslationResult;
            void setCachedTranslation(latestFiles[index].file, 'en', latestFiles[index].languageHint, translation);
            return { index, translation };
          })
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError')
          return null;
        if (err instanceof AbortedError) return null;
        setError(err instanceof Error ? err.message : 'Translation failed');
        setPipeline({ stage: 'idle', percent: 0, message: '' });
        setIsTranslating(null);
        return null;
      }

      for (const { index, translation } of transResults) {
        latestFiles = latestFiles.map((f, i) => i === index ? { ...f, translation } : f);
        saveResultsToDisk(latestFiles[index].name, undefined, translation);
      }
      setFiles(latestFiles as FileInfo[]);
    }
    setIsTranslating(null);

    // Phase 2: Auto-infer family members (family mode, no members manually added)
    // Track freshest member list — React state updates are async so familyGraph may be stale below
    let latestMembers: FamilyMember[] = familyGraph.members;
    let latestGraph: FamilyGraph = familyGraph;
    if (familyModeEnabled && familyGraph.members.length === 0) {
      setPipeline({
        stage: 'analyzing',
        percent: 72,
        message: 'Inferring family members from documents...',
      });
      try {
        const memberGroups = buildGroupedDocuments(latestFiles);
        if (memberGroups.length > 0) {
          const memberResponse = await fetchWithRetry(
            '/api/infer-family-members',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ documents: memberGroups }),
            },
            ctrl.signal
          );
          if (memberResponse.ok) {
            const memberResult = await memberResponse.json();
            const inferredMembers: FamilyMember[] = memberResult.members ?? [];
            if (inferredMembers.length > 0) {
              const newGraph: FamilyGraph = {
                members: inferredMembers,
                relationships: [],
              };
              latestMembers = inferredMembers;
              latestGraph = newGraph;
              setFamilyGraph(newGraph);
              setInferStatus({
                type: 'success',
                message: `Auto-detected ${inferredMembers.length} family member(s): ${inferredMembers.map(m => m.name).join(', ')}. Review and adjust roles before proceeding.`,
              });

              // Apply high-confidence document→member assignments so unassigned
              // docs get owners automatically. Ambiguous/low-confidence docs stay
              // unassigned (still fully analyzed). Never override a manual one.
              const assignments: Array<{
                documentName: string;
                memberId: string;
                confidence: string;
              }> = memberResult.documentAssignments ?? [];
              const memberIdSet = new Set(inferredMembers.map(m => m.id));
              const ownerByDoc = new Map(
                assignments
                  .filter(
                    a => a.confidence === 'high' && memberIdSet.has(a.memberId)
                  )
                  .map(a => [a.documentName, a.memberId])
              );
              if (ownerByDoc.size > 0) {
                let assignedCount = 0;
                latestFiles = latestFiles.map(f => {
                  if (f.familyMemberId) return f; // keep existing/manual assignment
                  const owner = ownerByDoc.get(f.pdfSourceName ?? f.name);
                  if (owner) {
                    assignedCount++;
                    return { ...f, familyMemberId: owner };
                  }
                  return f;
                });
                if (assignedCount > 0) setFiles(latestFiles as FileInfo[]);
              }
            }
          }
        }
      } catch (memberErr) {
        if (
          memberErr instanceof DOMException &&
          memberErr.name === 'AbortError'
        )
          return null;
        if (memberErr instanceof AbortedError) return null;
        // Non-fatal — continue even if member inference fails
        console.warn('[Family] Pipeline member inference failed:', memberErr);
      }
    }

    // Phase 2.5: Auto-infer family relationships (family mode + 2+ members)
    // Use latestMembers so newly auto-inferred members from Phase 2 are included
    if (familyModeEnabled && latestMembers.length >= 2) {
      setPipeline({
        stage: 'analyzing',
        percent: 78,
        message: 'Inferring family relationships from documents...',
      });
      try {
        const inferGroups = buildGroupedDocuments(latestFiles);
        if (inferGroups.length > 0) {
          const inferResponse = await fetchWithRetry(
            '/api/infer-relationships',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                documents: inferGroups,
                familyMembers: latestMembers,
                perDocNotes: latestFiles
                  .filter(f => f.userNotes)
                  .map(f => ({ fileName: f.name, notes: f.userNotes! })),
              }),
            },
            ctrl.signal
          );
          if (inferResponse.ok) {
            const inferResult = await inferResponse.json();
            const autoInferred: FamilyRelationship[] =
              inferResult.relationships ?? [];
            if (autoInferred.length > 0) {
              const newGraph: FamilyGraph = {
                members: latestMembers,
                relationships: [
                  ...familyGraph.relationships.filter(
                    r => r.confidence === 'declared'
                  ),
                  ...autoInferred,
                ],
              };
              latestGraph = newGraph;
              setFamilyGraph(newGraph);
              setInferStatus({
                type: 'success',
                message: `Pipeline auto-inferred ${autoInferred.length} relationship(s). Review and promote any you agree with before generating the report.`,
              });
            }
          }
        }
      } catch (inferErr) {
        if (inferErr instanceof DOMException && inferErr.name === 'AbortError')
          return null;
        if (inferErr instanceof AbortedError) return null;
        // Non-fatal — continue even if inference fails
        console.warn(
          '[Family] Pipeline relationship inference failed:',
          inferErr
        );
      }
    }

    setPipeline({
      stage: 'complete',
      percent: 100,
      message: 'Analysis complete! Review members and relationships, then generate the report.',
    });
    return { files: latestFiles as FileInfo[], graph: latestGraph };
  }, [
    files,
    buildGroupedDocuments,
    fetchWithRetry,
    freshAbort,
    saveResultsToDisk,
    familyModeEnabled,
    familyGraph,
  ]);

  // ── Translation ───────────────────────────────────────────────────────

  const translateFile = useCallback(
    async (index: number) => {
      const file = files[index];
      if (!file || (!file.analysis && !isDocxFile(file))) {
        setError('Only image and DOCX files can be translated');
        return;
      }

      const ctrl = freshAbort();
      setIsTranslating(index);
      setError('');
      setPipeline({
        stage: 'translating',
        percent: 0,
        message: `Translating ${file.name}...`,
      });

      try {
        let translation: TranslationResult;
        const cachedTr = await getCachedTranslation(
          file.file,
          'en',
          file.languageHint
        );
        if (cachedTr) {
          translation = cachedTr;
        } else {
          const formData = new FormData();
          await appendTranslationInput(formData, file);

          const response = await fetchWithRetry(
            '/api/translate',
            { method: 'POST', body: formData },
            ctrl.signal
          );

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(apiErrorMessage(data, 'Translation failed'));
          }

          translation = await response.json();
          void setCachedTranslation(
            file.file,
            'en',
            file.languageHint,
            translation
          );
        }

        setFiles(prev =>
          prev.map((f, i) => (i === index ? { ...f, translation } : f))
        );
        // Save translation result to disk
        saveResultsToDisk(file.name, undefined, translation);
        setPipeline({ stage: 'complete', percent: 100, message: 'Done!' });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof AbortedError) return;
        setError(err instanceof Error ? err.message : 'Translation failed');
        setPipeline({ stage: 'idle', percent: 0, message: '' });
      } finally {
        setIsTranslating(null);
      }
    },
    [files, fetchWithRetry, freshAbort, saveResultsToDisk]
  );

  const translateAllFiles = useCallback(async () => {
    const toTranslate = files
      .map((f, i) => ({ file: f, index: i }))
      .filter(({ file }) => canTranslateFile(file));

    if (!toTranslate.length) {
      setError(
        'No files need translation (all are in English or already translated)'
      );
      return;
    }

    const ctrl = freshAbort();
    setError('');
    let completed = 0;
    const total = toTranslate.length;

    setPipeline({
      stage: 'translating',
      percent: 0,
      message: `Translating 0/${total} files...`,
    });

    for (const { index } of toTranslate) {
      ctrl.signal.throwIfAborted();
      setIsTranslating(index);
      setPipeline({
        stage: 'translating',
        percent: Math.round((completed / total) * 100),
        message: `Translating ${files[index].name} (${completed + 1}/${total})...`,
      });

      try {
        let translation: TranslationResult;
        const cachedTr = await getCachedTranslation(
          files[index].file,
          'en',
          files[index].languageHint
        );
        if (cachedTr) {
          translation = cachedTr;
        } else {
          const formData = new FormData();
          await appendTranslationInput(formData, files[index]);

          const response = await fetchWithRetry(
            '/api/translate',
            { method: 'POST', body: formData },
            ctrl.signal
          );

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(
              apiErrorMessage(data, `Translation failed for ${files[index].name}`)
            );
          }

          translation = await response.json();
          void setCachedTranslation(
            files[index].file,
            'en',
            files[index].languageHint,
            translation
          );
        }

        setFiles(prev =>
          prev.map((f, i) => (i === index ? { ...f, translation } : f))
        );
        saveResultsToDisk(files[index].name, undefined, translation);
        completed++;
        // Cooldown between requests (skipped on a cache hit — no API call made)
        if (!cachedTr && completed < total) {
          await new Promise(r => setTimeout(r, INTER_REQUEST_DELAY_MS));
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof AbortedError) return;
        setError(err instanceof Error ? err.message : 'Translation failed');
        setPipeline({ stage: 'idle', percent: 0, message: '' });
        setIsTranslating(null);
        return;
      }
    }
    setIsTranslating(null);
    setPipeline({
      stage: 'complete',
      percent: 100,
      message: `Translated ${total} file(s)!`,
    });
  }, [files, fetchWithRetry, freshAbort, saveResultsToDisk]);

  // ── Discrepancy Check ─────────────────────────────────────────────────

  const checkDiscrepancies = useCallback(async () => {
    const groups = buildGroupedDocuments(files);

    if (groups.length < 2) {
      setError('Need at least 2 analyzed documents to check for discrepancies');
      return;
    }

    const ctrl = freshAbort();
    setDiscrepancyCheck(prev => ({ ...prev, isChecking: true }));
    setError('');
    setPipeline({
      stage: 'analyzing',
      percent: 50,
      message: 'Checking for discrepancies...',
    });

    try {
      const intent = await parseIntentIfNeeded(ctrl.signal);
      const perDocNotes = files
        .filter(f => f.userNotes)
        .map(f => ({ fileName: f.name, notes: f.userNotes! }));

      const response = await fetchWithRetry(
        '/api/analyze-discrepancies',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documents: groups,
            familyGraph: familyModeEnabled ? familyGraph : undefined,
            parsedIntent: intent ?? undefined,
            perDocNotes: perDocNotes.length ? perDocNotes : undefined,
            // Same rating-based legibility guard the report path sends, so the
            // standalone check also de-escalates conflicts sourced from poor
            // scans / handwriting instead of calling them hard "inconsistent".
            docLegibility: groups.map(g => {
              const s = buildDocumentSummaryFromOCR(g);
              return {
                name: s.documentName,
                legibility: s.legibility,
                isHandwritten: s.isHandwritten,
              };
            }),
          }),
        },
        ctrl.signal
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, 'Discrepancy check failed'));
      }

      const result = await response.json();

      setDiscrepancyCheck({
        hasDiscrepancies: result.hasDiscrepancies,
        summary: result.summary,
        isChecking: false,
        fieldFindings: result.fieldFindings,
      });
      setPipeline({
        stage: 'complete',
        percent: 100,
        message: 'Discrepancy check complete!',
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof AbortedError) return;
      setError(err instanceof Error ? err.message : 'Discrepancy check failed');
      setDiscrepancyCheck(prev => ({ ...prev, isChecking: false }));
      setPipeline({ stage: 'idle', percent: 0, message: '' });
    }
  }, [
    files,
    buildGroupedDocuments,
    fetchWithRetry,
    freshAbort,
    familyModeEnabled,
    familyGraph,
    parseIntentIfNeeded,
  ]);

  // ── Report Generation ─────────────────────────────────────────────────

  const generateFullReport = useCallback(
    async (filesOverride?: FileInfo[], graphOverride?: FamilyGraph) => {
    // Overrides exist so generateFreshReport can pass the pipeline's freshest
    // results directly — the `files`/`familyGraph` state in this closure is
    // stale right after the pipeline finishes. Array.isArray guards against
    // a click event arriving as the first arg when wired straight to onClick.
    const fileList = Array.isArray(filesOverride) ? filesOverride : files;
    const groups = buildGroupedDocuments(fileList, graphOverride?.members);

    if (groups.length === 0) {
      setError('No analyzed files available for report generation');
      return;
    }

    // Split into included (confidence ≠ low) and excluded (confidence = low)
    const excludedGroups = groups.filter(
      g => getGroupIllegibilityConfidence(g) === 'low'
    );
    const includedGroups = groups.filter(
      g => getGroupIllegibilityConfidence(g) !== 'low'
    );
    const excludedDocuments = excludedGroups.map(g => ({
      name: g.name,
      reason:
        'Document illegibility confidence is too low — content could not be reliably read and may contain errors',
    }));

    if (includedGroups.length === 0) {
      setError(
        'All documents are illegible and have been excluded from the report. Please provide clearer scans.'
      );
      return;
    }

    const ctrl = freshAbort();
    setIsGeneratingReport(true);
    setError('');
    setPipeline({
      stage: 'generating-report',
      percent: 50,
      message: 'Generating comprehensive report...',
    });

    try {
      const intent = await parseIntentIfNeeded(ctrl.signal);

      // ── Phase 1: Map — build compact DocumentSummary per included group ──────
      // Asked of the server, not read from process.env: NEXT_PUBLIC_* values are
      // baked into the client bundle at build time, which froze the packaged app
      // on "light" forever. See src/lib/report-mode.ts.
      const reportMode = await fetchReportMode(ctrl.signal);
      const summaries: DocumentSummary[] = [];

      if (reportMode === 'deep') {
        // Deep mode: one AI call per document (parallel), shows per-doc progress
        let completed = 0;
        setPipeline({
          stage: 'generating-report',
          percent: 30,
          message: `Reading documents 0/${includedGroups.length}...`,
        });
        const deepSummaries = await Promise.all(
          includedGroups.map(async g => {
            const resp = await fetchWithRetry(
              '/api/analyze-document-report',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ group: g }),
              },
              ctrl.signal
            );
            if (!resp.ok) {
              const data = await resp.json().catch(() => ({}));
              throw new Error(
                apiErrorMessage(data, `Document analysis failed for ${g.name}`)
              );
            }
            const s = (await resp.json()) as DocumentSummary;
            completed++;
            setPipeline({
              stage: 'generating-report',
              percent:
                Math.round((completed / includedGroups.length) * 45) + 30,
              message: `Read document ${completed}/${includedGroups.length}: ${g.name}`,
            });
            return s;
          })
        );
        summaries.push(...deepSummaries);
      } else {
        // Light mode: extract key fields locally from OCR structured data (no AI call)
        for (const g of includedGroups) {
          summaries.push(buildDocumentSummaryFromOCR(g));
        }
      }

      // ── Phase 1.5: Re-classify field discrepancies against the CURRENT graph ──
      // Member/relationship edits change classification, so we must NOT reuse the
      // cached findings here — they could contradict the up-to-date family
      // cross-reference. Re-run the classifier so the concordance and the family
      // section are derived from the same graph.
      const graphForReport = familyModeEnabled
        ? (graphOverride ?? familyGraph)
        : undefined;
      // Starts undefined and is ONLY set from a successful re-classification
      // below. Findings from a previous run must never leak in — they may
      // reflect an older family graph or document set, and generateReport
      // falls back to its own deterministic concordance when this is absent.
      let freshFieldFindings: ClassifiedFieldFinding[] | undefined;
      if (includedGroups.length >= 2) {
        setPipeline({
          stage: 'generating-report',
          percent: 65,
          message: 'Classifying field discrepancies...',
        });
        try {
          const discResp = await fetchWithRetry(
            '/api/analyze-discrepancies',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                documents: includedGroups,
                familyGraph: graphForReport,
                parsedIntent: intent ?? undefined,
                perDocNotes: fileList
                  .filter(f => f.userNotes)
                  .map(f => ({ fileName: f.name, notes: f.userNotes! })),
                docLegibility: summaries.map(s => ({
                  name: s.documentName,
                  legibility: s.legibility,
                  isHandwritten: s.isHandwritten,
                })),
              }),
            },
            ctrl.signal
          );
          if (discResp.ok) {
            const discResult = await discResp.json();
            freshFieldFindings = discResult.fieldFindings;
            setDiscrepancyCheck({
              hasDiscrepancies: discResult.hasDiscrepancies,
              summary: discResult.summary,
              isChecking: false,
              fieldFindings: discResult.fieldFindings,
            });
          }
        } catch (discErr) {
          if (discErr instanceof DOMException && discErr.name === 'AbortError')
            return;
          if (discErr instanceof AbortedError) return;
          console.warn(
            '[generateFullReport] Discrepancy classification failed, continuing:',
            discErr
          );
        }
      }

      // ── Phase 2: Reduce — synthesise full report from compact summaries ───────
      setPipeline({
        stage: 'generating-report',
        percent: 75,
        message: 'Generating comprehensive report...',
      });

      const response = await fetchWithRetry(
        '/api/generate-report',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summaries,
            excludedDocuments: excludedDocuments.length
              ? excludedDocuments
              : undefined,
            familyGraph: graphForReport,
            parsedIntent: intent ?? undefined,
            fieldFindings: freshFieldFindings,
          }),
        },
        ctrl.signal
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, 'Report generation failed'));
      }

      const reportData: AnalysisReport = await response.json();
      setReport(reportData);
      setPipeline({
        stage: 'complete',
        percent: 100,
        message: 'Report generated!',
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof AbortedError) return;
      setError(err instanceof Error ? err.message : 'Report generation failed');
      setPipeline({ stage: 'idle', percent: 0, message: '' });
    } finally {
      setIsGeneratingReport(false);
    }
  }, [
    files,
    buildGroupedDocuments,
    fetchWithRetry,
    freshAbort,
    familyModeEnabled,
    familyGraph,
    parseIntentIfNeeded,
  ]);

  /**
   * "Fresh report": run the full pipeline first (OCR/translate any documents
   * uploaded since the last run — already-processed files are cache hits and
   * cost nothing), then regenerate the report from the pipeline's own fresh
   * results. This guarantees newly uploaded documents are included, which
   * plain "Generate Report" cannot do (it silently skips unanalyzed files).
   */
  const generateFreshReport = useCallback(async () => {
    const result = await runFullPipeline();
    if (!result) return; // pipeline aborted or failed — error already surfaced
    await generateFullReport(result.files, result.graph);
  }, [runFullPipeline, generateFullReport]);

  // ── Translation-Only Mode: Translate files without prior analysis ──────

  const translateAllWithoutAnalysis = useCallback(async () => {
    const toTranslate = files
      .map((f, i) => ({ file: f, index: i }))
      .filter(({ file }) => file.type.startsWith('image/') || isDocxFile(file))
      .filter(({ file }) => !file.translation);

    if (!toTranslate.length) {
      setError('No untranslated files found');
      return;
    }

    const ctrl = freshAbort();
    setError('');
    let completed = 0;
    const total = toTranslate.length;

    setPipeline({
      stage: 'translating',
      percent: 0,
      message: `Translating 0/${total} files (without analysis)...`,
    });

    for (const { index } of toTranslate) {
      ctrl.signal.throwIfAborted();
      setIsTranslating(index);
      setPipeline({
        stage: 'translating',
        percent: Math.round((completed / total) * 100),
        message: `Translating ${files[index].name} (${completed + 1}/${total})...`,
      });

      try {
        let translation: TranslationResult;
        const cachedTr = await getCachedTranslation(
          files[index].file,
          'en',
          files[index].languageHint
        );
        if (cachedTr) {
          translation = cachedTr;
        } else {
          const formData = new FormData();
          await appendTranslationInput(formData, files[index]);

          const response = await fetchWithRetry(
            '/api/translate',
            { method: 'POST', body: formData },
            ctrl.signal
          );

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(
              apiErrorMessage(data, `Translation failed for ${files[index].name}`)
            );
          }

          translation = await response.json();
          void setCachedTranslation(
            files[index].file,
            'en',
            files[index].languageHint,
            translation
          );
        }

        setFiles(prev =>
          prev.map((f, i) => (i === index ? { ...f, translation } : f))
        );
        saveResultsToDisk(files[index].name, undefined, translation);
        completed++;
        // Cooldown between requests (skipped on a cache hit — no API call made)
        if (!cachedTr && completed < total) {
          await new Promise(r => setTimeout(r, INTER_REQUEST_DELAY_MS));
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof AbortedError) return;
        setError(err instanceof Error ? err.message : 'Translation failed');
        setPipeline({ stage: 'idle', percent: 0, message: '' });
        setIsTranslating(null);
        return;
      }
    }
    setIsTranslating(null);
    setPipeline({
      stage: 'complete',
      percent: 100,
      message: `Translated ${total} file(s) without analysis!`,
    });
  }, [files, fetchWithRetry, freshAbort, saveResultsToDisk]);

  // ── Navigation ────────────────────────────────────────────────────────

  const selectFile = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const nextFile = useCallback(() => {
    setSelectedIndex(prev => Math.min(prev + 1, files.length - 1));
  }, [files.length]);

  const prevFile = useCallback(() => {
    setSelectedIndex(prev => Math.max(prev - 1, 0));
  }, []);

  const closeViewer = useCallback(() => {
    setSelectedIndex(-1);
  }, []);

  const clearError = useCallback(() => {
    setError('');
  }, []);

  const clearReport = useCallback(() => {
    setReport(null);
  }, []);

  /** Update per-document notes for a given file id */
  const updateFileNotes = useCallback((fileId: string, notes: string) => {
    setFiles(prev =>
      prev.map(f => (f.id === fileId ? { ...f, userNotes: notes } : f))
    );
  }, []);

  /**
   * Reset the whole session for a new client: abort anything in flight, then
   * clear every piece of per-client state — files, results, report, family
   * members/relationships, analysis context, errors, progress.
   *
   * Deliberately NOT reset:
   *  - the Family Mode toggle — a user preference (persisted in localStorage),
   *    not client data; staff who work family cases keep it on;
   *  - the IndexedDB result cache — content-addressed per document, so a new
   *    client's documents can never hit an old client's entries, and clearing
   *    it would just re-bill any legitimately re-analyzed document (it can be
   *    cleared explicitly in Settings);
   *  - provider settings (.env) — server-side configuration, not client state.
   */
  const resetForNewClient = useCallback(() => {
    // Abort in-flight work first so a late response can't repopulate the
    // state cleared below.
    abortRef.current?.abort();
    abortRef.current = null;

    setFiles([]);
    setSelectedIndex(-1);
    setIsAnalyzing(null);
    setIsTranslating(null);
    setIsPdfExtracting(false);
    setDiscrepancyCheck({
      hasDiscrepancies: false,
      summary: '',
      isChecking: false,
    });
    setReport(null);
    setIsGeneratingReport(false);
    setClientName('Client');
    setError('');
    setPipeline({ stage: 'idle', percent: 0, message: '' });
    setFamilyGraph({ members: [], relationships: [] });
    setIsInferringRelationships(false);
    setInferStatus(null);
    setAnalysisContext('');
    setParsedIntent(null);
    setIsParsingIntent(false);
  }, []);

  return {
    files,
    selectedIndex,
    isAnalyzing,
    isTranslating,
    isPdfExtracting,
    discrepancyCheck,
    report,
    isGeneratingReport,
    clientName,
    error,
    pipeline,
    // Family mode
    familyModeEnabled,
    familyGraph,
    isInferringRelationships,
    uploadFiles,
    removeFile,
    analyzeFile,
    analyzeAllFiles,
    runFullPipeline,
    translateFile,
    translateAllFiles,
    translateAllWithoutAnalysis,
    checkDiscrepancies,
    generateFullReport,
    generateFreshReport,
    stopProcessing,
    setClientName,
    setFileLanguage,
    selectFile,
    nextFile,
    prevFile,
    closeViewer,
    clearError,
    clearReport,
    // Family mode management
    toggleFamilyMode,
    addFamilyMember,
    removeFamilyMember,
    updateFamilyMember,
    assignDocumentToMember,
    addRelationship,
    removeRelationship,
    updateRelationship,
    inferRelationships,
    inferStatus,
    setInferStatus,
    // Analysis context
    analysisContext,
    setAnalysisContext,
    parsedIntent,
    isParsingIntent,
    updateFileNotes,
    resetForNewClient,
  };
};
