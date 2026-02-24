"""
Report generation module - Generate comprehensive immigration document analysis reports.
"""

import json
import re
import time
from typing import List
from openai import OpenAI

from .config import GPT4O_ENDPOINT, GPT4O_API_KEY, GPT4O_DEPLOYMENT
from .types import ProcessedDocument, AnalysisReport


# Initialize client
_client = None

def _get_client() -> OpenAI:
    """Get or create the OpenAI client."""
    global _client
    if _client is None:
        _client = OpenAI(base_url=GPT4O_ENDPOINT, api_key=GPT4O_API_KEY)
    return _client


REPORT_PROMPT_TEMPLATE = """You are a legal document analyst specializing in immigration applications. Your task is to analyze identity and official documents for a client/family applying for immigration.

## DOCUMENTS PROVIDED:
{documents_json}

## YOUR TASK:
Generate a comprehensive analysis report with the following sections. Be precise, factual, and focus on information relevant to immigration applications.

## REPORT STRUCTURE:

### 1. EXECUTIVE SUMMARY
- Very brief overview (2-3 sentences) of the document set
- Number and types of documents analyzed
- Overall assessment: CLEAR (no issues), MINOR CONCERNS, or REQUIRES ATTENTION
- Key findings summary

### 2. PERSONAL INFORMATION CONCORDANCE TABLE
Create a table comparing key identifying information ACROSS ALL documents:
| Field | Document 1 Value | Document 2 Value | ... | Consistent? |
Focus on: Full Name, Date of Birth, Place of Birth, Parents' Names, Document Numbers, Gender, Nationality, Expiry Dates, etc.

### 3. DOCUMENT-BY-DOCUMENT ANALYSIS
For EACH document, provide:
- Document Type & Issuing Authority
- Issue Date & Validity (if applicable)
- Key Information Extracted (original + translation)
- Document Quality/Legibility Assessment
- Translation Accuracy Notes (if foreign language)
- Flags/Concerns specific to this document

### 4. CROSS-DOCUMENT DISCREPANCIES
List ALL inconsistencies found between documents:
- Name spelling variations (critical for immigration)
- Date discrepancies
- Information conflicts
- Missing information that should be present
For each, indicate: SEVERITY (High/Medium/Low) and EXPLANATION

### 5. TRANSLATION ACCURACY NOTES
- Highlight any terms with multiple possible translations
- Note cultural/legal terms that may need explanation
- Flag any ambiguous or uncertain translations
- Note if handwritten text was difficult to interpret

### 6. ACTION ITEMS
Specific recommendations for the legal team:
- Documents that may need certified re-translation
- Information to verify with the client
- Additional documents to request
- Issues to address in the application

Return your response as JSON with this EXACT structure:
{{
    "executive_summary": {{
        "overview": "brief description of document set",
        "documents_analyzed": 2,
        "document_types": ["type1", "type2"],
        "overall_assessment": "CLEAR | MINOR CONCERNS | REQUIRES ATTENTION",
        "key_findings": ["finding 1", "finding 2"]
    }},
    "personal_info_concordance": {{
        "fields_compared": ["Full Name", "Date of Birth", "Place of Birth", "Parents Names", "Gender", "Nationality"],
        "comparison_table": [
            {{
                "field": "Full Name",
                "values_by_document": [
                    {{"document": "doc1.jpg", "original": "original value", "translated": "translated value"}},
                    {{"document": "doc2.jpg", "original": "original value", "translated": "translated value"}}
                ],
                "is_consistent": true,
                "discrepancy_note": "null or explanation if inconsistent"
            }}
        ],
        "consistency_summary": "summary of overall consistency"
    }},
    "document_analysis": [
        {{
            "document_name": "filename",
            "document_type": "type",
            "issuing_authority": "authority if identifiable",
            "issue_date": "date or N/A",
            "validity": "validity period or N/A",
            "key_information": {{
                "original": {{"field": "value"}},
                "translated": {{"field": "value"}}
            }},
            "legibility_assessment": "Good | Fair | Poor",
            "translation_notes": "notes on translation quality/issues",
            "flags": ["flag 1", "flag 2"]
        }}
    ],
    "cross_document_discrepancies": [
        {{
            "discrepancy_type": "Name Spelling | Date | Information Conflict | Missing Info",
            "description": "detailed description",
            "documents_involved": ["doc1", "doc2"],
            "original_values": ["value1", "value2"],
            "severity": "High | Medium | Low",
            "recommendation": "what to do about it"
        }}
    ],
    "translation_notes": {{
        "ambiguous_terms": [
            {{"term": "original term", "possible_translations": ["option1", "option2"], "context": "explanation"}}
        ],
        "cultural_legal_terms": [
            {{"term": "term", "explanation": "what it means in this context"}}
        ],
        "uncertain_readings": ["description of hard-to-read sections"],
        "overall_translation_confidence": "High | Medium | Low"
    }},
    "action_items": [
        {{
            "priority": "High | Medium | Low",
            "category": "Translation | Verification | Documentation | Application",
            "action": "specific action to take",
            "reason": "why this is needed"
        }}
    ],
    "report_metadata": {{
        "generated_at": "timestamp",
        "total_documents": 2,
        "languages_detected": ["fr", "en"]
    }}
}}

IMPORTANT:
- Compare BOTH original text AND translations when analyzing
- Pay special attention to name spellings - even minor variations matter for immigration
- Note any dates that don't align (birth dates, issue dates, etc.)
- Flag anything that could raise questions during immigration processing
- Be concise but thorough - this report is for legal professionals

Return ONLY valid JSON, no additional text."""


def generate_report(documents: List[ProcessedDocument]) -> AnalysisReport:
    """
    Generate a comprehensive immigration document analysis report.
    
    Args:
        documents: List of ProcessedDocument dictionaries, each containing:
            - name: Document filename
            - extracted_data: OCR result from extract_text()
            - translation_data: Translation result from translate_document() (optional)
            
    Returns:
        AnalysisReport dictionary with all report sections
        
    Raises:
        ValueError: If no documents provided
        Exception: If API call fails or response parsing fails
    """
    if not documents:
        raise ValueError("No documents provided for analysis")
    
    # Prepare documents for analysis
    docs_for_analysis = []
    for doc in documents:
        extracted = doc.get('extracted_data', {})
        translation = doc.get('translation_data', {})
        
        doc_info = {
            'document_name': doc.get('name', 'unknown'),
            'document_type': extracted.get('document_type', 'unknown'),
            'original_language': extracted.get('document_language', 'unknown'),
            'original_text': extracted.get('text', ''),
            'original_fields': extracted.get('structured_data', {}).get('fields', []),
            'translated_text': translation.get('translated_text', '') if translation else '',
            'translated_fields': translation.get('structured_data', {}).get('translated_fields', []) if translation else [],
            'image_text_original': translation.get('image_text', {}).get('original', '') if translation else '',
            'image_text_translated': translation.get('image_text', {}).get('translated', '') if translation else '',
            'translation_notes': translation.get('notes', '') if translation else ''
        }
        docs_for_analysis.append(doc_info)
    
    prompt = REPORT_PROMPT_TEMPLATE.format(
        documents_json=json.dumps(docs_for_analysis, indent=2, ensure_ascii=False)
    )
    
    client = _get_client()
    
    max_retries = 2
    last_error = None
    
    for attempt in range(max_retries + 1):
        try:
            response = client.chat.completions.create(
                model=GPT4O_DEPLOYMENT,
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert immigration document analyst. Generate precise, actionable reports for legal professionals. Focus on factual analysis and flag any inconsistencies that could affect an immigration application."
                    },
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2,
                max_tokens=16000,
                response_format={"type": "json_object"}
            )
            
            # Check for empty/filtered response
            choice = response.choices[0] if response.choices else None
            if not choice or not choice.message or not choice.message.content:
                finish = choice.finish_reason if choice else 'unknown'
                if attempt < max_retries:
                    print(f"  [RETRY] Empty response (finish_reason={finish}), retrying...")
                    time.sleep(2 ** attempt)
                    continue
                raise Exception(
                    f"Empty response from API (finish_reason={finish}). "
                    "This may be due to content filtering."
                )
            
            response_text = choice.message.content
            
            if choice.finish_reason == 'length':
                print(f"  [WARN] Report response was truncated (hit token limit), attempting JSON repair...")
            
            try:
                return json.loads(response_text)
            except json.JSONDecodeError:
                # Try to repair truncated JSON
                from .ocr import _repair_truncated_json
                return _repair_truncated_json(response_text)
        
        except Exception as e:
            last_error = e
            if attempt < max_retries and "Empty response" not in str(e):
                print(f"  [RETRY] Report generation attempt {attempt + 1} failed: {e}")
                time.sleep(2 ** attempt)
                continue
            raise Exception(f"Failed to parse report response after {attempt + 1} attempt(s): {last_error}")
