import { z } from 'zod';

// ── OCR Result (matches scripts/types.py OCRResult) ─────────────────────

export const DocumentSchema = z
  .object({
    document_type: z.string(),
  })
  .passthrough();

export type Document = z.infer<typeof DocumentSchema>;

export interface OCRResult {
  text: string;
  document_type: string;
  document_language: string;
  structured_data: {
    fields: Array<{ key: string; value: string }>;
  };
  tables?: Array<{
    headers: string[];
    rows: string[][];
  }>;
  [key: string]: unknown;
}

// ── Translation Result (matches scripts/types.py TranslationResult) ─────

export interface TranslationResult {
  original_text: string;
  translated_text: string;
  original_language: string;
  target_language: string;
  image_text?: {
    original: string;
    translated: string;
  };
  structured_data?: {
    original_fields: Array<{ key: string; value: string }>;
    translated_fields: Array<{ key: string; value: string }>;
  };
  layout_preserved?: boolean;
  notes?: string;
}

// ── File information ────────────────────────────────────────────────────

export interface FileInfo {
  id: string;
  name: string;
  size: number;
  type: string;
  file: File;
  /** Optional language hint set by user (ISO 639-1 code) */
  languageHint?: string;
  analysis?: OCRResult;
  translation?: TranslationResult;
  /** Shared UUID linking all pages extracted from the same PDF */
  pdfSourceId?: string;
  /** Original PDF filename (e.g. "passport.pdf") */
  pdfSourceName?: string;
  /** 1-based page number within the source PDF */
  pdfPageNumber?: number;
  /** Total number of pages extracted from the source PDF */
  pdfTotalPages?: number;
}

// ── Grouped document types for API payloads ─────────────────────────────

/** A single page's analysis + translation data (no File handle — safe to serialise). */
export interface DocumentPage {
  pageNumber: number;
  name: string;
  extracted_data?: OCRResult;
  translation_data?: TranslationResult | null;
}

/** A logical document: either a standalone image or a multi-page PDF. */
export interface DocumentGroup {
  /** Display name (PDF filename or image filename) */
  name: string;
  /** Unique group key (pdfSourceId or file id) */
  groupId: string;
  pages: DocumentPage[];
}

// ── Analysis Report (matches scripts/types.py AnalysisReport) ───────────

export interface AnalysisReport {
  executive_summary: {
    overview: string;
    documents_analyzed: number;
    document_types: string[];
    overall_assessment: 'CLEAR' | 'MINOR CONCERNS' | 'REQUIRES ATTENTION';
    key_findings: string[];
  };
  personal_info_concordance: {
    fields_compared: string[];
    comparison_table: Array<{
      field: string;
      values_by_document: Array<{
        document: string;
        original: string;
        translated: string;
      }>;
      is_consistent: boolean;
      discrepancy_note: string | null;
    }>;
    consistency_summary: string;
  };
  document_analysis: Array<{
    document_name: string;
    document_type: string;
    issuing_authority: string;
    issue_date: string;
    validity: string;
    key_information: {
      original: Record<string, string>;
      translated: Record<string, string>;
    };
    legibility_assessment: string;
    translation_notes: string;
    flags: string[];
  }>;
  cross_document_discrepancies: Array<{
    discrepancy_type: string;
    description: string;
    documents_involved: string[];
    original_values: string[];
    severity: 'High' | 'Medium' | 'Low';
    recommendation: string;
  }>;
  translation_notes: {
    ambiguous_terms: Array<{
      term: string;
      possible_translations: string[];
      context: string;
    }>;
    cultural_legal_terms: Array<{
      term: string;
      explanation: string;
    }>;
    uncertain_readings: string[];
    overall_translation_confidence: string;
  };
  action_items: Array<{
    priority: 'High' | 'Medium' | 'Low';
    category: string;
    action: string;
    reason: string;
  }>;
  report_metadata: {
    generated_at: string;
    total_documents: number;
    languages_detected: string[];
  };
}

// ── API response types ──────────────────────────────────────────────────

export interface AnalysisResponse {
  document_type: string;
  [key: string]: unknown;
}

export interface DiscrepancyResponse {
  hasDiscrepancies: boolean;
  summary: string;
}

export interface DiscrepancyCheck {
  hasDiscrepancies: boolean;
  summary: string;
  isChecking: boolean;
}

// ── Workflow state ──────────────────────────────────────────────────────

export type WorkflowStage =
  | 'upload'
  | 'analyze'
  | 'translate'
  | 'report'
  | 'export';
