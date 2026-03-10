import { useState, useCallback, useRef } from 'react';
import {
  FileInfo,
  OCRResult,
  TranslationResult,
  DiscrepancyCheck,
  AnalysisReport,
  DocumentGroup,
  DocumentPage,
} from '@/types';
import { extractPdfPages } from '@/lib/pdf-extract';

/** Sentinel error thrown when the user cancels processing. */
class AbortedError extends Error {
  constructor() {
    super('Processing stopped by user');
    this.name = 'AbortedError';
  }
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

  const uploadFiles = useCallback((fileArray: File[]) => {
    setError('');
    setReport(null);
    setDiscrepancyCheck({
      hasDiscrepancies: false,
      summary: '',
      isChecking: false,
    });

    // Separate PDFs from non-PDFs
    const pdfs: File[] = [];
    const nonPdfs: FileInfo[] = [];
    for (const file of fileArray) {
      if (
        file.type === 'application/pdf' ||
        file.name.toLowerCase().endsWith('.pdf')
      ) {
        pdfs.push(file);
      } else {
        nonPdfs.push({
          id: `${file.name}-${file.lastModified}`,
          name: file.name,
          size: file.size,
          type: file.type,
          file,
        });
      }
    }

    // Set non-PDF files immediately so the UI is responsive
    setFiles(nonPdfs);

    if (pdfs.length === 0) return;

    // Extract PDF pages asynchronously
    setIsPdfExtracting(true);
    (async () => {
      const warnings: string[] = [];
      for (const pdf of pdfs) {
        try {
          const result = await extractPdfPages(pdf);
          setFiles(prev => [...prev, ...result.pages]);
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
   * Build document groups from the flat FileInfo array.
   * Pages from the same PDF are merged into a single group; standalone
   * images each become their own single-page group.
   * Only files with analysis data are included.
   */
  const buildGroupedDocuments = useCallback(
    (fileList: FileInfo[]): DocumentGroup[] => {
      const groupMap = new Map<string, DocumentPage[]>();
      const groupNames = new Map<string, string>();
      const groupOrder: string[] = [];

      for (const f of fileList) {
        if (!f.analysis) continue;
        const key = f.pdfSourceId ?? f.id;
        if (!groupMap.has(key)) {
          groupMap.set(key, []);
          groupNames.set(key, f.pdfSourceName ?? f.name);
          groupOrder.push(key);
        }
        groupMap.get(key)!.push({
          pageNumber: f.pdfPageNumber ?? 1,
          name: f.name,
          extracted_data: f.analysis,
          translation_data: f.translation ?? null,
        });
      }

      return groupOrder.map(key => ({
        name: groupNames.get(key)!,
        groupId: key,
        pages: groupMap.get(key)!.sort((a, b) => a.pageNumber - b.pageNumber),
      }));
    },
    []
  );

  // ── Persist results to disk (fire-and-forget) ─────────────────────────

  const saveResultsToDisk = useCallback(
    (fileName: string, ocr?: OCRResult, translation?: TranslationResult) => {
      // Only persist results in local development — never send document text
      // to the server in production where there is nothing to write to disk.
      if (process.env.NODE_ENV !== 'development') return;

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
  // ── OCR / Analyze ─────────────────────────────────────────────────────

  const analyzeFile = useCallback(
    async (index: number) => {
      const file = files[index];
      if (!file?.type.startsWith('image/')) {
        setError('Only image files can be analyzed');
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
        const formData = new FormData();
        formData.append('file', file.file);
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

        const analysis: OCRResult = await response.json();

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
      .filter(({ file }) => file.type.startsWith('image/') && !file.analysis);

    if (!imageFiles.length) {
      setError('No unanalyzed image files found');
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
        const formData = new FormData();
        formData.append('file', files[index].file);
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

        const analysis: OCRResult = await response.json();

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

  const runFullPipeline = useCallback(async () => {
    const ctrl = freshAbort();
    setPipeline({
      stage: 'analyzing',
      percent: 0,
      message: 'Starting analysis pipeline...',
    });
    setError('');

    // Phase 1: OCR all image files that haven't been analyzed
    const imageFiles = files
      .map((f, i) => ({ file: f, index: i }))
      .filter(({ file }) => file.type.startsWith('image/') && !file.analysis);

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
        const formData = new FormData();
        formData.append('file', files[index].file);
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

        const analysis: OCRResult = await response.json();
        latestFiles = latestFiles.map((f, i) =>
          i === index ? { ...f, analysis } : f
        );
        setFiles(latestFiles as FileInfo[]);
        saveResultsToDisk(files[index].name, analysis);
        completed++;
        // Cooldown between OCR requests
        if (completed < imageFiles.length) {
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

    // Phase 2: Translate all non-English analyzed files that aren't translated
    const toTranslate = latestFiles
      .map((f, i) => ({ file: f, index: i }))
      .filter(
        ({ file }) =>
          file.type.startsWith('image/') &&
          file.analysis &&
          file.analysis.document_language !== 'en' &&
          !file.translation
      );

    setPipeline({
      stage: 'translating',
      percent: Math.round(
        (completed / (totalSteps + toTranslate.length)) * 100
      ),
      message: toTranslate.length
        ? `Translating ${toTranslate.length} non-English document(s)...`
        : 'All documents in English, skipping translation...',
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

        const translation: TranslationResult = await response.json();
        latestFiles = latestFiles.map((f, i) =>
          i === index ? { ...f, translation } : f
        );
        setFiles(latestFiles as FileInfo[]);
        saveResultsToDisk(latestFiles[index].name, undefined, translation);
        completed++;
        // Cooldown between requests
        if (completed < toTranslate.length) {
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

    // Phase 3: Generate report
    const pipelineGroups = buildGroupedDocuments(latestFiles);
    if (pipelineGroups.length === 0) {
      setError('No analyzed files available for report generation');
      setPipeline({ stage: 'idle', percent: 0, message: '' });
      return;
    }

    setIsGeneratingReport(true);
    setPipeline({
      stage: 'generating-report',
      percent: 85,
      message: 'Generating comprehensive report...',
    });

    try {
      const response = await fetchWithRetry(
        '/api/generate-report',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documents: pipelineGroups }),
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
  ]);

  // ── Translation ───────────────────────────────────────────────────────

  const translateFile = useCallback(
    async (index: number) => {
      const file = files[index];
      if (!file?.type.startsWith('image/')) {
        setError('Only image files can be translated');
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
        const formData = new FormData();
        formData.append('targetLanguage', 'en');
        if (file.languageHint) {
          formData.append('languageHint', file.languageHint);
        }
        if (file.analysis) {
          // Text path – no file bytes needed.
          formData.append('ocrText', file.analysis.text || '');
          formData.append(
            'ocrFields',
            JSON.stringify(file.analysis.structured_data?.fields || [])
          );
          formData.append('ocrLanguage', file.analysis.document_language || '');
        } else {
          formData.append('file', file.file);
        }

        const response = await fetchWithRetry(
          '/api/translate',
          { method: 'POST', body: formData },
          ctrl.signal
        );

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'Translation failed');
        }

        const translation: TranslationResult = await response.json();

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
      .filter(
        ({ file }) =>
          file.type.startsWith('image/') &&
          file.analysis &&
          file.analysis.document_language !== 'en' &&
          !file.translation
      );

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
        const formData = new FormData();
        formData.append('targetLanguage', 'en');
        if (files[index].languageHint) {
          formData.append('languageHint', files[index].languageHint!);
        }
        if (files[index].analysis) {
          // Text path – no file bytes needed.
          formData.append('ocrText', files[index].analysis!.text || '');
          formData.append(
            'ocrFields',
            JSON.stringify(files[index].analysis!.structured_data?.fields || [])
          );
          formData.append(
            'ocrLanguage',
            files[index].analysis!.document_language || ''
          );
        } else {
          formData.append('file', files[index].file);
        }

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

        const translation: TranslationResult = await response.json();

        setFiles(prev =>
          prev.map((f, i) => (i === index ? { ...f, translation } : f))
        );
        saveResultsToDisk(files[index].name, undefined, translation);
        completed++;
        // Cooldown between requests to avoid rate-limit bursts
        if (completed < total) {
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
      const response = await fetchWithRetry(
        '/api/analyze-discrepancies',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documents: groups }),
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
  }, [files, buildGroupedDocuments, fetchWithRetry, freshAbort]);

  // ── Report Generation ─────────────────────────────────────────────────

  const generateFullReport = useCallback(async () => {
    const groups = buildGroupedDocuments(files);

    if (groups.length === 0) {
      setError('No analyzed files available for report generation');
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
      const response = await fetchWithRetry(
        '/api/generate-report',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documents: groups }),
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
  }, [files, buildGroupedDocuments, fetchWithRetry, freshAbort]);

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
    uploadFiles,
    analyzeFile,
    analyzeAllFiles,
    runFullPipeline,
    translateFile,
    translateAllFiles,
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
  };
};
