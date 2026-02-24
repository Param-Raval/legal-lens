"""
Type definitions for document analysis.
Uses TypedDict for JSON-compatible structures that match the TypeScript app.
"""

from typing import TypedDict, List, Optional, Any


# OCR Result Types (matches src/types/index.ts AnalysisResponse)
class StructuredField(TypedDict):
    key: str
    value: str


class StructuredData(TypedDict):
    fields: List[StructuredField]


class TableData(TypedDict):
    headers: List[str]
    rows: List[List[str]]


class OCRResult(TypedDict):
    text: str
    document_type: str
    document_language: str
    structured_data: StructuredData
    tables: List[TableData]


# Translation Result Types
class ImageText(TypedDict):
    original: str
    translated: str


class TranslationStructuredData(TypedDict):
    original_fields: List[StructuredField]
    translated_fields: List[StructuredField]


class TranslationResult(TypedDict):
    original_text: str
    translated_text: str
    original_language: str
    target_language: str
    image_text: ImageText
    structured_data: TranslationStructuredData
    layout_preserved: bool
    notes: str


# Document for Report Generation
class ProcessedDocument(TypedDict):
    name: str
    extracted_data: OCRResult
    translation_data: Optional[TranslationResult]


# Report Types
class ExecutiveSummary(TypedDict):
    overview: str
    documents_analyzed: int
    document_types: List[str]
    overall_assessment: str  # "CLEAR" | "MINOR CONCERNS" | "REQUIRES ATTENTION"
    key_findings: List[str]


class DocumentValue(TypedDict):
    document: str
    original: str
    translated: str


class ConcordanceRow(TypedDict):
    field: str
    values_by_document: List[DocumentValue]
    is_consistent: bool
    discrepancy_note: Optional[str]


class PersonalInfoConcordance(TypedDict):
    fields_compared: List[str]
    comparison_table: List[ConcordanceRow]
    consistency_summary: str


class KeyInformation(TypedDict):
    original: dict
    translated: dict


class DocumentAnalysis(TypedDict):
    document_name: str
    document_type: str
    issuing_authority: str
    issue_date: str
    validity: str
    key_information: KeyInformation
    legibility_assessment: str  # "Good" | "Fair" | "Poor"
    translation_notes: str
    flags: List[str]


class Discrepancy(TypedDict):
    discrepancy_type: str
    description: str
    documents_involved: List[str]
    original_values: List[str]
    severity: str  # "High" | "Medium" | "Low"
    recommendation: str


class AmbiguousTerm(TypedDict):
    term: str
    possible_translations: List[str]
    context: str


class CulturalTerm(TypedDict):
    term: str
    explanation: str


class TranslationNotes(TypedDict):
    ambiguous_terms: List[AmbiguousTerm]
    cultural_legal_terms: List[CulturalTerm]
    uncertain_readings: List[str]
    overall_translation_confidence: str  # "High" | "Medium" | "Low"


class ActionItem(TypedDict):
    priority: str  # "High" | "Medium" | "Low"
    category: str  # "Translation" | "Verification" | "Documentation" | "Application"
    action: str
    reason: str


class ReportMetadata(TypedDict):
    generated_at: str
    total_documents: int
    languages_detected: List[str]


class AnalysisReport(TypedDict):
    executive_summary: ExecutiveSummary
    personal_info_concordance: PersonalInfoConcordance
    document_analysis: List[DocumentAnalysis]
    cross_document_discrepancies: List[Discrepancy]
    translation_notes: TranslationNotes
    action_items: List[ActionItem]
    report_metadata: ReportMetadata
