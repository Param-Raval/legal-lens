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
import {
  MEMBER_COLOR_KEYS,
  canAnalyzeFile,
  canTranslateFile,
  isDocxFile,
} from '@/lib/utils';
import { buildDocumentSummaryFromOCR } from '@/lib/document-summary';
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
          nonPdfs.push({
            id: `${file.name}-${file.lastModified}`,
            name: file.name,
            size: file.size,
            type: file.type,
            file,
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
    (fileList: FileInfo[]): DocumentGroup[] => {
      const groupMap = new Map<string, DocumentPage[]>();
      const groupNames = new Map<string, string>();
      const groupMemberIds = new Map<string, string | undefined>();
      const groupOrder: string[] = [];

      // Build a quick id→member lookup
      const memberById = new Map<string, FamilyMember>(
        familyGraph.members.map(m => [m.id, m])
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
        throw new Error(data.error || 'Relationship inference failed');
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
              throw new Error(data.error || 'Analysis failed');
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
            if (files[index].pdfTextLayer) {
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
                data.error || `Analysis failed for ${files[index].name}`
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

  const runFullPipeline = useCallback(async () => {
    const ctrl = freshAbort();
    setPipeline({
      stage: 'analyzing',
      percent: 0,
      message: 'Starting analysis pipeline...',
    });
    setError('');

    // Parse user intent once at pipeline start (non-blocking on failure)
    const pipelineIntent = await parseIntentIfNeeded(ctrl.signal);

    // Phase 1: OCR / text-extract all analyzable files that haven't been analyzed
    const imageFiles = files
      .map((f, i) => ({ file: f, index: i }))
      .filter(({ file }) => canAnalyzeFile(file) && !file.analysis);

    const totalSteps = imageFiles.length + 1; // +1 for report step (translation counted as it goes)
    let completed = 0;

    // Track the latest file state for translation decisions
    let latestFiles = [...files];

    for (const { index } of imageFiles) {
      ctrl.signal.throwIfAborted();
      setIsAnalyzing(index);
      setPipeline({
        stage: 'analyzing',
        percent: Math.round((completed / (totalSteps + files.length)) * 100),
        message: `Analyzing ${files[index].name}...`,
      });

      try {
        let analysis: OCRResult;
        const cached = await getCachedOcr(
          files[index].file,
          files[index].languageHint
        );
        if (cached) {
          analysis = cached;
        } else {
          const formData = new FormData();
          if (files[index].pdfTextLayer) {
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
              data.error || `Analysis failed for ${files[index].name}`
            );
          }

          analysis = await response.json();
          void setCachedOcr(
            files[index].file,
            files[index].languageHint,
            analysis
          );
        }
        latestFiles = latestFiles.map((f, i) =>
          i === index ? { ...f, analysis } : f
        );
        setFiles(latestFiles as FileInfo[]);
        saveResultsToDisk(files[index].name, analysis);
        completed++;
        // Cooldown between OCR requests (skipped on a cache hit — no API call made)
        if (!cached && completed < imageFiles.length) {
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

    // Phase 2: Translate all analyzed files with non-English content
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

    setPipeline({
      stage: 'translating',
      percent: Math.round(
        (completed / (totalSteps + toTranslate.length)) * 100
      ),
      message: toTranslate.length
        ? `Translating ${toTranslate.length} document(s) requiring translation...`
        : 'All documents already in English, skipping translation...',
    });

    for (const { index } of toTranslate) {
      ctrl.signal.throwIfAborted();
      setIsTranslating(index);
      setPipeline({
        stage: 'translating',
        percent: Math.round(
          (completed / (totalSteps + toTranslate.length)) * 100
        ),
        message: `Translating ${latestFiles[index].name}...`,
      });

      try {
        let translation: TranslationResult;
        const cachedTr = await getCachedTranslation(
          latestFiles[index].file,
          'en',
          latestFiles[index].languageHint
        );
        if (cachedTr) {
          translation = cachedTr;
        } else {
          const formData = new FormData();
          formData.append('targetLanguage', 'en');
          if (latestFiles[index].languageHint) {
            formData.append('languageHint', latestFiles[index].languageHint!);
          }
          if (latestFiles[index].analysis) {
            // Text path – no file bytes needed.
            formData.append(
              'ocrText',
              (latestFiles[index].analysis as OCRResult).text || ''
            );
            formData.append(
              'ocrFields',
              JSON.stringify(
                (latestFiles[index].analysis as OCRResult).structured_data
                  ?.fields || []
              )
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
            throw new Error(
              data.error || `Translation failed for ${latestFiles[index].name}`
            );
          }

          translation = await response.json();
          void setCachedTranslation(
            latestFiles[index].file,
            'en',
            latestFiles[index].languageHint,
            translation
          );
        }
        latestFiles = latestFiles.map((f, i) =>
          i === index ? { ...f, translation } : f
        );
        setFiles(latestFiles as FileInfo[]);
        saveResultsToDisk(latestFiles[index].name, undefined, translation);
        completed++;
        // Cooldown between requests (skipped on a cache hit — no API call made)
        if (!cachedTr && completed < toTranslate.length) {
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

    // Phase 2: Auto-infer family members (family mode, no members manually added)
    // Track freshest member list — React state updates are async so familyGraph may be stale below
    let latestMembers: FamilyMember[] = familyGraph.members;
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
          return;
        if (memberErr instanceof AbortedError) return;
        // Non-fatal — continue even if member inference fails
        console.warn('[Family] Pipeline member inference failed:', memberErr);
      }
    }

    // Phase 2.5: Auto-infer family relationships (family mode + 2+ members)
    // Use latestMembers so newly auto-inferred members from Phase 2 are included
    let graphForReport: FamilyGraph | undefined = familyModeEnabled
      ? { ...familyGraph, members: latestMembers }
      : undefined;
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
              setFamilyGraph(newGraph);
              graphForReport = newGraph;
              setInferStatus({
                type: 'success',
                message: `Pipeline auto-inferred ${autoInferred.length} relationship(s). Review and promote any you agree with before re-generating the report.`,
              });
            }
          }
        }
      } catch (inferErr) {
        if (inferErr instanceof DOMException && inferErr.name === 'AbortError')
          return;
        if (inferErr instanceof AbortedError) return;
        // Non-fatal — continue to report generation even if inference fails
        console.warn(
          '[Family] Pipeline relationship inference failed:',
          inferErr
        );
      }
    }

    // Phase 3: Generate report
    const pipelineGroups = buildGroupedDocuments(latestFiles);
    if (pipelineGroups.length === 0) {
      setError('No analyzed files available for report generation');
      setPipeline({ stage: 'idle', percent: 0, message: '' });
      return;
    }

    // Split into included vs excluded by illegibility confidence
    const pipelineExcluded = pipelineGroups.filter(
      g => getGroupIllegibilityConfidence(g) === 'low'
    );
    const pipelineIncluded = pipelineGroups.filter(
      g => getGroupIllegibilityConfidence(g) !== 'low'
    );
    const pipelineExcludedDocs = pipelineExcluded.map(g => ({
      name: g.name,
      reason:
        'Document illegibility confidence is too low — content could not be reliably read and may contain errors',
    }));

    if (pipelineIncluded.length === 0) {
      setError(
        'All documents are illegible and have been excluded from the report. Please provide clearer scans.'
      );
      setPipeline({ stage: 'idle', percent: 0, message: '' });
      return;
    }

    setIsGeneratingReport(true);
    setPipeline({
      stage: 'generating-report',
      percent: 85,
      message: 'Reading documents for report...',
    });

    try {
      // ── Phase 1 (Map) — build compact summaries ───────────────────────────────
      const pipelineReportMode = process.env.NEXT_PUBLIC_REPORT_MODE ?? 'light';
      const pipelineSummaries: DocumentSummary[] = [];

      if (pipelineReportMode === 'deep') {
        let completed = 0;
        const deepSummaries = await Promise.all(
          pipelineIncluded.map(async g => {
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
                data.error || `Document analysis failed for ${g.name}`
              );
            }
            const s = (await resp.json()) as DocumentSummary;
            completed++;
            setPipeline({
              stage: 'generating-report',
              percent:
                Math.round((completed / pipelineIncluded.length) * 8) + 85,
              message: `Read document ${completed}/${pipelineIncluded.length}: ${g.name}`,
            });
            return s;
          })
        );
        pipelineSummaries.push(...deepSummaries);
      } else {
        for (const g of pipelineIncluded) {
          pipelineSummaries.push(buildDocumentSummaryFromOCR(g));
        }
      }

      // ── Phase 2.75: Classify field discrepancies (feeds into report) ──────────
      let pipelineFieldFindings: ClassifiedFieldFinding[] | undefined;
      if (pipelineIncluded.length >= 2) {
        setPipeline({
          stage: 'generating-report',
          percent: 88,
          message: 'Classifying field discrepancies...',
        });
        try {
          const discResponse = await fetchWithRetry(
            '/api/analyze-discrepancies',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                documents: pipelineIncluded,
                familyGraph: graphForReport,
                parsedIntent: pipelineIntent ?? undefined,
                perDocNotes: latestFiles
                  .filter(f => f.userNotes)
                  .map(f => ({ fileName: f.name, notes: f.userNotes! })),
                // Per-document legibility ratings so the classifier de-escalates
                // apparent conflicts sourced from poor/handwritten scans.
                docLegibility: pipelineSummaries.map(s => ({
                  name: s.documentName,
                  legibility: s.legibility,
                  isHandwritten: s.isHandwritten,
                })),
              }),
            },
            ctrl.signal
          );
          if (discResponse.ok) {
            const discResult = await discResponse.json();
            setDiscrepancyCheck({
              hasDiscrepancies: discResult.hasDiscrepancies,
              summary: discResult.summary,
              isChecking: false,
              fieldFindings: discResult.fieldFindings,
            });
            pipelineFieldFindings = discResult.fieldFindings;
          }
        } catch (discErr) {
          if (discErr instanceof DOMException && discErr.name === 'AbortError')
            return;
          if (discErr instanceof AbortedError) return;
          console.warn(
            '[Pipeline] Discrepancy classification failed, continuing:',
            discErr
          );
        }
      }

      // ── Phase 3 (Reduce) — synthesise full report ─────────────────────────────
      setPipeline({
        stage: 'generating-report',
        percent: 92,
        message: 'Generating comprehensive report...',
      });

      const response = await fetchWithRetry(
        '/api/generate-report',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summaries: pipelineSummaries,
            excludedDocuments: pipelineExcludedDocs.length
              ? pipelineExcludedDocs
              : undefined,
            familyGraph: graphForReport,
            parsedIntent: pipelineIntent ?? undefined,
            fieldFindings: pipelineFieldFindings,
          }),
        },
        ctrl.signal
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Report generation failed');
      }

      const reportData: AnalysisReport = await response.json();
      setReport(reportData);
      setPipeline({
        stage: 'complete',
        percent: 100,
        message: 'Pipeline complete!',
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
    saveResultsToDisk,
    familyModeEnabled,
    familyGraph,
    parseIntentIfNeeded,
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
            throw new Error(data.error || 'Translation failed');
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
              data.error || `Translation failed for ${files[index].name}`
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
          }),
        },
        ctrl.signal
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Discrepancy check failed');
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

  const generateFullReport = useCallback(async () => {
    const groups = buildGroupedDocuments(files);

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
      const reportMode = process.env.NEXT_PUBLIC_REPORT_MODE ?? 'light';
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
                data.error || `Document analysis failed for ${g.name}`
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
      // cross-reference. Re-run the classifier (mirroring runFullPipeline's Phase 2.75)
      // so the concordance and the family section are derived from the same graph.
      const graphForReport = familyModeEnabled ? familyGraph : undefined;
      let freshFieldFindings: ClassifiedFieldFinding[] | undefined =
        discrepancyCheck.fieldFindings;
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
                perDocNotes: files
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
        throw new Error(data.error || 'Report generation failed');
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
    discrepancyCheck,
  ]);

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
              data.error || `Translation failed for ${files[index].name}`
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
  };
};
