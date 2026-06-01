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
  illegibility?: {
    detected: boolean;
    confidence: 'high' | 'medium' | 'low';
    /** True when meaningful key fields are filled in by hand (set by the OCR prompt). */
    handwritten?: boolean;
    reason?: string;
  };
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
  illegibility?: {
    uncertain_segments: string[];
    overall_confidence: 'high' | 'medium' | 'low';
  };
}

// ── Family / Multi-person analysis ─────────────────────────────────────

/** Predefined colour keys for family member badges. */
export type MemberColorKey =
  | 'blue'
  | 'purple'
  | 'green'
  | 'amber'
  | 'pink'
  | 'teal'
  | 'orange'
  | 'indigo';

/** A named family member that documents can be assigned to. */
export interface FamilyMember {
  id: string;
  name: string;
  /** Free-text role, e.g. "Principal Applicant", "Spouse", "Child" */
  role?: string;
  /** Colour key — maps to a Tailwind colour palette in the UI */
  color: MemberColorKey;
}

/** A relationship between two family members. */
export interface FamilyRelationship {
  fromId: string;
  toId: string;
  /** Human-readable label, e.g. "spouse of", "parent of", "sibling of" */
  relationshipType: string;
  /**
   * - declared  = user explicitly set it
   * - inferred  = AI inferred from document contents with reasonable confidence
   * - unsure    = AI guessed but marked as uncertain
   */
  confidence: 'declared' | 'inferred' | 'unsure';
  /** Optional reasoning from the AI (non-empty only for inferred/unsure). */
  reasoning?: string;
}

/** The full family relationship graph. */
export interface FamilyGraph {
  members: FamilyMember[];
  relationships: FamilyRelationship[];
}

/** One member's value for a cross-family shared field. */
export interface SharedFieldValue {
  memberId: string;
  memberName: string;
  value: string;
  documentName: string;
}

/** Cross-family comparison of a single shared field (e.g. "Father's Name"). */
export interface SharedFieldComparison {
  field: string;
  values: SharedFieldValue[];
  isConsistent: boolean;
  inconsistencyNote: string | null;
}

/** A discrepancy that spans two or more family members. */
export interface CrossPersonDiscrepancy {
  discrepancy_type: string;
  description: string;
  documents_involved: string[];
  original_values: string[];
  severity: 'High' | 'Medium' | 'Low';
  recommendation: string;
  /** IDs of the family members whose documents are involved. */
  affectedMemberIds: string[];
}

/** The family cross-reference section appended to the full report. */
export interface FamilyCrossReferenceSection {
  familyMembers: Array<{
    id: string;
    name: string;
    role?: string;
    color: MemberColorKey;
    /** Documents explicitly assigned to this member. */
    assignedDocuments?: string[];
  }>;
  inferredRelationships: FamilyRelationship[];
  /** Documents that reference multiple family members (e.g. marriage certificates). */
  sharedDocuments?: Array<{
    documentName: string;
    memberIds: string[];
    reason: string;
  }>;
  sharedFieldComparisons: SharedFieldComparison[];
  crossPersonDiscrepancies: CrossPersonDiscrepancy[];
  /**
   * Documents that could not be attributed to a specific family member.
   * They are still included in discrepancy/concordance analysis — listed here
   * only so the lawyer knows their ownership is unconfirmed.
   */
  unassignedDocuments?: string[];
  summary: string;
}

/** Compact per-document summary produced in Phase 1 (Map) of report generation.
 *  Contains only pre-extracted key fields — no raw OCR blobs — so the
 *  Phase 2 synthesis prompt stays well within the 4096-token output cap. */
export interface DocumentSummary {
  documentName: string;
  documentType: string;
  issuingAuthority: string;
  issueDate: string;
  validity: string;
  originalLanguage: string;
  legibility: 'Good' | 'Fair' | 'Poor';
  /**
   * True when significant key-field content (names, dates, places) is handwritten
   * rather than typed or printed. Detected during Phase 1 deep analysis.
   * When true, extracted values must be treated as lower-confidence regardless of OCR success.
   */
  isHandwritten?: boolean;
  /** Up to 15 key fields with original and translated values. */
  keyFields: Array<{ field: string; original: string; translated: string }>;
  flags: string[];
  translationNotes: string;
  familyMemberId?: string;
  familyMemberName?: string;
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
  /**
   * Exact text extracted from a born-digital PDF page's text layer (pdfjs
   * getTextContent). When present, OCR structures this text directly instead of
   * vision-OCRing the rendered image — faster, exact (no OCR errors), and skips
   * the image tokens. Absent for scanned pages (no usable text layer).
   */
  pdfTextLayer?: string;
  /** Family member this document is assigned to (family mode only) */
  familyMemberId?: string;
  /** Optional user-provided notes describing this document's context */
  userNotes?: string;
  /** Path relative to the drag-drop or webkitdirectory root (e.g. "/ClientCase/John/passport.jpg") */
  folderPath?: string;
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
  /** Family member this group is assigned to (family mode only) */
  familyMemberId?: string;
  familyMemberName?: string;
  /** Aggregated user notes for this group (from document-level notes) */
  userNotes?: string;
}

// ── Timeline / chronology ───────────────────────────────────────────────

export interface TimelineEvent {
  /** Normalized date (YYYY-MM-DD when possible; partial like "1985" allowed). */
  date: string;
  /** What happened, e.g. "Date of birth", "Passport issued". */
  label: string;
  /** Source document name. */
  document: string;
  /** Family member, when known. */
  memberName?: string | null;
}

export interface TimelineContradiction {
  description: string;
  documents_involved: string[];
  severity: 'High' | 'Medium' | 'Low';
}

/** Chronological synthesis across documents, flagging impossible sequences. */
export interface TimelineSection {
  events: TimelineEvent[];
  contradictions: TimelineContradiction[];
  summary: string;
}

// ── Analysis Report (matches scripts/types.py AnalysisReport) ───────────

export interface AnalysisReport {
  personal_info_concordance: {
    fields_compared: string[];
    comparison_table: Array<{
      field: string;
      values_by_document: Array<{
        document: string;
        original: string;
        translated: string;
        /**
         * Source document legibility — present when Fair or Poor.
         * Shown as a warning badge in the UI so lawyers know the value may be unreliable.
         */
        legibility?: 'Good' | 'Fair' | 'Poor';
      }>;
      status: FieldComparisonStatus;
      note: string | null;
      /**
       * Internal importance rank, sourced from the AI ClassifiedFieldFinding.
       * NOT displayed as a label — used only to sort rows most-important-first.
       */
      severity?: 'High' | 'Medium' | 'Low';
    }>;
    consistency_summary: string;
    /**
     * Per-member concordance tables — present only in family mode.
     * Each entry compares only that member's own documents against each other.
     */
    byMember?: Array<{
      memberId: string;
      memberName: string;
      comparison_table: Array<{
        field: string;
        values_by_document: Array<{
          document: string;
          original: string;
          translated: string;
          legibility?: 'Good' | 'Fair' | 'Poor';
        }>;
        status: FieldComparisonStatus;
        note: string | null;
        /** Internal importance rank for ordering — not displayed. */
        severity?: 'High' | 'Medium' | 'Low';
      }>;
      consistency_summary: string;
    }>;
  };
  per_document_discrepancies: Array<{
    document_name: string;
    summary: string;
    discrepancies: Array<{
      discrepancy_type: string;
      description: string;
      original_values: string[];
      severity: 'High' | 'Medium' | 'Low';
      recommendation: string;
      fields_involved?: string[];
    }>;
  }>;
  cross_document_discrepancies: Array<{
    discrepancy_type: string;
    description: string;
    documents_involved: string[];
    original_values: string[];
    severity: 'High' | 'Medium' | 'Low';
    recommendation: string;
  }>;
  report_metadata: {
    generated_at: string;
    total_documents: number;
    languages_detected: string[];
    excluded_documents?: Array<{ name: string; reason: string }>;
  };
  /**
   * Present only when the user provided analysis context. Restates how the
   * request was interpreted so a parser/synthesis misread is visible to the
   * lawyer ("Scope of Analysis" panel).
   */
  analysis_scope?: {
    interpretation: string;
    derivedChecks: string[];
    assumptions: string[];
  };
  /**
   * Present only when the user provided analysis context/intent.
   * Every user-requested check is explicitly listed here with a verdict,
   * even when the result is "consistent" (nothing is silently omitted).
   */
  user_requested_checks?: UserRequestedCheck[];
  /** Present only when family mode was enabled during report generation. */
  familyCrossReference?: FamilyCrossReferenceSection;
  /** Chronological timeline + contradictions. Present when documents carry dates. */
  timeline?: TimelineSection;
  /**
   * Non-fatal degradation warnings (e.g. an AI pass failed to complete) so a
   * lawyer never mistakes an errored run for a clean "no issues found" result.
   */
  analysis_warnings?: string[];
}

// ── User context & intent parsing ─────────────────────────────────────

/**
 * Structured output from the Intent Parser micro-agent.
 * Derived from the user's free-text global analysis context.
 */
export interface ParsedIntent {
  /** Specific fields the user wants compared across documents (e.g. "Father's Name") */
  fieldsToCompare: string[];
  /** Family relationships the user wants verified (e.g. "confirm A is parent of B") */
  relationshipsToCheck: string[];
  /** Specific inconsistency checks requested (e.g. "spelling differences in parent names") */
  specificInconsistencies: string[];
  /** Broad focus areas that guide the overall analysis */
  focusAreas: string[];
  /** The original raw text the user entered */
  rawContext: string;
  /**
   * Plain-language restatement of how the parser understood the request.
   * Shown back to the user ("Scope of Analysis") so a misread is never silent.
   */
  interpretation?: string;
  /** Ambiguities or things the parser had to infer/assume from vague context. */
  assumptions?: string[];
}

/**
 * A named finding produced for each user-requested check.
 * Every item in ParsedIntent must produce exactly one UserRequestedCheck —
 * even when the result is "consistent" (explicitly confirmed, not just absent).
 */
export interface UserRequestedCheck {
  /** Short identifier, e.g. "check-fathers-name" */
  checkId: string;
  /** The original request as phrased by the system / parsed intent */
  requestedBy: string;
  /** Explicit verdict — inconclusive is allowed, silent omission is not */
  finding: 'consistent' | 'inconsistent' | 'inconclusive';
  /** Full explanation of what was found */
  description: string;
  /** Document names referenced in the finding */
  documentsInvolved: string[];
  /** Only set when finding is "inconsistent" */
  severity?: 'High' | 'Medium' | 'Low';
}

// ── Field comparison status & classified findings ─────────────────────

export type FieldComparisonStatus =
  | 'consistent'
  | 'inconsistent'
  | 'missing_info'
  | 'requires_review';

export interface ClassifiedFieldFinding {
  field: string;
  canonicalName: string;
  status: FieldComparisonStatus;
  note: string | null;
  documentsInvolved: string[];
  valuesByDocument: Array<{ document: string; original: string; translated: string }>;
  severity?: 'High' | 'Medium' | 'Low';
}

// ── API response types ──────────────────────────────────────────────────

export interface AnalysisResponse {
  document_type: string;
  [key: string]: unknown;
}

export interface DiscrepancyResponse {
  hasDiscrepancies: boolean;
  summary: string;
  fieldFindings?: ClassifiedFieldFinding[];
  /** True when the AI field-classification pass failed — result is NOT "clean". */
  classificationFailed?: boolean;
}

export interface DiscrepancyCheck {
  hasDiscrepancies: boolean;
  summary: string;
  isChecking: boolean;
  fieldFindings?: ClassifiedFieldFinding[];
  classificationFailed?: boolean;
}

// ── Workflow state ──────────────────────────────────────────────────────

export type WorkflowStage =
  | 'upload'
  | 'analyze'
  | 'translate'
  | 'report'
  | 'export';
