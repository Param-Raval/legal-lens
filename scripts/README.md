# Legal Lens - Document Analysis Scripts

Python modules for OCR, translation, and report generation using GPT-4o.

## Structure

```
scripts/
├── __init__.py          # Package exports
├── config.py            # Configuration and env vars
├── types.py             # Type definitions (TypedDict)
├── ocr.py               # OCR using GPT-4o Vision
├── translation.py       # Document translation
├── report.py            # Report generation
├── pdf_export.py        # PDF export
├── main.py              # Test runner
└── requirements.txt     # Dependencies
```

## Installation

```bash
cd scripts
pip install -r requirements.txt
```

## Environment Variables

Create a `.env` file in the project root:

```
GPT4O_ENDPOINT=https://your-endpoint.openai.azure.com/
GPT4O_API_KEY=your-api-key
GPT4O_DEPLOYMENT=gpt-4o
```

## Usage

### Run Full Pipeline

```bash
# From project root
python -m scripts.main
```

### Use Individual Modules

```python
from scripts.ocr import extract_text
from scripts.translation import translate_document
from scripts.report import generate_report
from scripts.pdf_export import save_as_pdf

# 1. OCR
ocr_result = extract_text("path/to/document.jpg")
# Returns: { text, document_type, document_language, structured_data, tables }

# 2. Translation
translation = translate_document("path/to/document.jpg", target_language="en")
# Returns: { original_text, translated_text, structured_data, notes, ... }

# 3. Report Generation
documents = [
    {"name": "doc1.jpg", "extracted_data": ocr_result, "translation_data": translation}
]
report = generate_report(documents)
# Returns: { executive_summary, personal_info_concordance, discrepancies, ... }

# 4. PDF Export
pdf_path = save_as_pdf(report, "output/report.pdf", client_name="John Doe")
```

## Integration with TypeScript App

The types in `types.py` mirror the TypeScript interfaces in `src/types/index.ts`. 
When integrating:

1. **Call from API routes**: Use Python subprocess or a separate microservice
2. **JSON compatibility**: All return types are JSON-serializable
3. **Type mapping**:
   - `OCRResult` → `AnalysisResponse`
   - `AnalysisReport` → New type for comprehensive reports

### Example API Integration

```typescript
// src/app/api/analyze-full/route.ts
import { spawn } from 'child_process';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  // Save files, call Python script, return JSON report
}
```

## Output Types

### OCRResult
```json
{
  "text": "extracted text",
  "document_type": "birth_certificate",
  "document_language": "fr",
  "structured_data": { "fields": [...] },
  "tables": [...]
}
```

### AnalysisReport
```json
{
  "executive_summary": { "overall_assessment": "CLEAR|MINOR CONCERNS|REQUIRES ATTENTION", ... },
  "personal_info_concordance": { "comparison_table": [...] },
  "cross_document_discrepancies": [{ "severity": "High|Medium|Low", ... }],
  "action_items": [{ "priority": "High|Medium|Low", "category": "...", "action": "..." }]
}
```
