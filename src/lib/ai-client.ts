/**
 * AI client abstraction - supports both OpenAI (Azure) and Ollama backends.
 * Ported from scripts/ocr.py, scripts/translation.py, scripts/report.py
 */
import { config } from './config';

// ── Shared helpers ──────────────────────────────────────────────────────

/**
 * Attempt to repair truncated JSON (matches scripts/ocr.py _repair_truncated_json).
 */
function repairTruncatedJson(text: string): Record<string, unknown> {
  if (!text?.trim()) throw new Error('Empty response text');

  try {
    return JSON.parse(text);
  } catch {
    // continue to repair
  }

  const jsonStart = text.indexOf('{');
  if (jsonStart > 0) text = text.slice(jsonStart);

  let inString = false;
  let escapeNext = false;
  const stack: string[] = [];

  for (const char of text) {
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' && stack.at(-1) === '{') stack.pop();
    else if (char === ']' && stack.at(-1) === '[') stack.pop();
  }

  if (inString) text += '"';
  text = text.replace(/[,:\s]+$/, '');
  for (const bracket of [...stack].reverse()) {
    text += bracket === '[' ? ']' : '}';
  }

  return JSON.parse(text);
}

// ── OpenAI helpers ──────────────────────────────────────────────────────

interface ChatMessage {
  role: 'system' | 'user';
  content:
    | string
    | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;

async function openaiChat(opts: ChatOptions): Promise<Record<string, unknown>> {
  const {
    messages,
    temperature = 0.1,
    maxTokens = 10000,
    jsonMode = true,
  } = opts;

  const body: Record<string, unknown> = {
    model: config.openai.model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(`${config.openai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openai.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterMs = retryAfterHeader
        ? parseInt(retryAfterHeader, 10) * 1000
        : BASE_DELAY_MS * Math.pow(2, attempt);

      if (attempt < MAX_RETRIES) {
        console.warn(
          `[WARN] Rate limited (429). Retry ${attempt + 1}/${MAX_RETRIES} after ${Math.round(retryAfterMs / 1000)}s...`
        );
        await new Promise(resolve =>
          setTimeout(resolve, retryAfterMs + Math.round(retryAfterMs * 0.1))
        );
        continue;
      }

      throw new Error(
        `Rate limited after ${MAX_RETRIES} retries. Please wait a moment and try again. Consider reducing the number of concurrent requests.`
      );
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      lastError = new Error(`OpenAI API error ${response.status}: ${errText}`);
      // Retry on 5xx server errors
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `[WARN] Server error (${response.status}). Retry ${attempt + 1}/${MAX_RETRIES} after ${Math.round(delay / 1000)}s...`
        );
        await new Promise(resolve =>
          setTimeout(resolve, delay + Math.round(delay * 0.1))
        );
        continue;
      }
      throw lastError;
    }

    const result = await response.json();
    const choice = result.choices?.[0];
    if (!choice?.message?.content) {
      // Treat empty response as a transient error — retry
      lastError = new Error(
        `Empty response from OpenAI (finish_reason=${choice?.finish_reason ?? 'unknown'})`
      );
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `[WARN] Empty response. Retry ${attempt + 1}/${MAX_RETRIES} after ${Math.round(delay / 1000)}s...`
        );
        await new Promise(resolve =>
          setTimeout(resolve, delay + Math.round(delay * 0.1))
        );
        continue;
      }
      throw lastError;
    }

    const text = choice.message.content;
    if (choice.finish_reason === 'length') {
      console.warn(
        '[WARN] OpenAI response was truncated, attempting JSON repair...'
      );
    }

    try {
      return JSON.parse(text);
    } catch {
      return repairTruncatedJson(text);
    }
  }

  throw lastError ?? new Error('OpenAI request failed after retries');
}

// ── Ollama helpers ──────────────────────────────────────────────────────

async function ollamaGenerate(opts: {
  model: string;
  prompt: string;
  images?: string[];
}): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    model: opts.model,
    prompt: opts.prompt,
    stream: false,
    format: 'json',
  };
  if (opts.images) body.images = opts.images;

  const response = await fetch(`${config.ollama.baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);

  const result = await response.json();
  return JSON.parse(result.response);
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * OCR: Extract text and structured data from a document image.
 * Matches scripts/ocr.py extract_text().
 */
export async function extractText(
  base64Image: string,
  mimeType: string,
  languageHint?: string
) {
  const langNote = languageHint
    ? `\nIMPORTANT: The user has indicated that this document is in **${languageHint}**. Use this as the primary language assumption when extracting and classifying text. Set "document_language" to "${languageHint}" unless you are very confident it is a different language.\n`
    : '';

  const OCR_PROMPT = `Extract all text and structured data from this document.
${langNote}
Please provide:
1. All text content in the document, preserving the layout and line breaks where appropriate
2. Identify the document type (e.g., passport, ID card, birth certificate, etc.)
3. Detect the document language
4. Extract key-value pairs for structured documents (e.g., Name, DOB, Document Number, etc.)
5. Extract any tables with headers and rows

Return your response as JSON with this EXACT structure:
{
    "text": "all extracted text here, preserving line breaks",
    "document_type": "type of document (e.g., passport, driver_license, birth_certificate, etc.)",
    "document_language": "language code (e.g., en, fr, ar, zh, etc.)",
    "structured_data": {
        "fields": [
            {"key": "field name", "value": "field value"}
        ]
    },
    "tables": [
        {
            "headers": ["header1", "header2"],
            "rows": [["value1", "value2"]]
        }
    ]
}

Return ONLY valid JSON, no additional text.`;

  if (config.provider === 'openai') {
    return await openaiChat({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: OCR_PROMPT },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Image}` },
            },
          ],
        },
      ],
      temperature: 0.1,
      maxTokens: 10000,
    });
  }

  // Ollama fallback
  return await ollamaGenerate({
    model: config.ollama.visionModel,
    prompt: OCR_PROMPT,
    images: [base64Image],
  });
}

/**
 * Translate a document image.
 * Matches scripts/translation.py translate_document().
 */
export async function translateDocument(
  base64Image: string,
  mimeType: string,
  targetLanguage: string = 'en',
  languageHint?: string
) {
  const LANGUAGE_NAMES: Record<string, string> = {
    en: 'English',
    fr: 'French',
    ar: 'Arabic',
    fa_AF: 'Dari',
    zh: 'Chinese',
    es: 'Spanish',
    pt: 'Portuguese',
    de: 'German',
    ja: 'Japanese',
    ko: 'Korean',
    hi: 'Hindi',
    bn: 'Bengali',
    ne: 'Nepali',
    ht: 'Haitian Creole',
    ru: 'Russian',
    fa: 'Farsi',
    ur: 'Urdu',
    tr: 'Turkish',
    ta: 'Tamil',
  };
  const langName = LANGUAGE_NAMES[targetLanguage] || targetLanguage;
  const sourceLang = languageHint
    ? LANGUAGE_NAMES[languageHint] || languageHint
    : null;

  const sourceNote = sourceLang
    ? `\nIMPORTANT: The user has indicated that the original document language is **${sourceLang} (${languageHint})**. Use this as the source language assumption.\n`
    : '';

  const TRANSLATE_PROMPT = `Translate this document to ${langName} (${targetLanguage}).
${sourceNote}
For government documents with text and images:
1. Extract all text from the document
2. Translate all text to ${langName}
3. Preserve the document structure and layout
4. For text found in images (logos, stamps, handwritten text), extract and translate it
5. Present the translation alongside the original, indicating which parts are from images vs regular text

Return your response as JSON with this structure:
{
    "original_text": "original extracted text",
    "translated_text": "translated text to ${langName}",
    "original_language": "detected language code",
    "target_language": "${targetLanguage}",
    "image_text": {
        "original": "text found in images/stamps/logos",
        "translated": "translated image text"
    },
    "structured_data": {
        "original_fields": [
            {"key": "field name", "value": "original value"}
        ],
        "translated_fields": [
            {"key": "translated field name", "value": "translated value"}
        ]
    },
    "layout_preserved": true,
    "notes": "any relevant notes about the translation or document structure"
}

Return ONLY valid JSON, no additional text.`;

  if (config.provider === 'openai') {
    return await openaiChat({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: TRANSLATE_PROMPT },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Image}` },
            },
          ],
        },
      ],
      temperature: 0.1,
      maxTokens: 10000,
    });
  }

  return await ollamaGenerate({
    model: config.ollama.visionModel,
    prompt: TRANSLATE_PROMPT,
    images: [base64Image],
  });
}

/**
 * Text-based translation — uses the already-extracted OCR text instead of
 * re-sending the image to the vision model.  This avoids burning vision
 * tokens and dramatically reduces 429 / empty-response errors.
 */
export async function translateText(
  ocrText: string,
  ocrFields: Array<{ key: string; value: string }>,
  sourceLanguage: string,
  targetLanguage: string = 'en',
  languageHint?: string
) {
  const LANGUAGE_NAMES: Record<string, string> = {
    en: 'English',
    fr: 'French',
    ar: 'Arabic',
    fa_AF: 'Dari',
    zh: 'Chinese',
    es: 'Spanish',
    pt: 'Portuguese',
    de: 'German',
    ja: 'Japanese',
    ko: 'Korean',
    hi: 'Hindi',
    bn: 'Bengali',
    ne: 'Nepali',
    ht: 'Haitian Creole',
    ru: 'Russian',
    fa: 'Farsi',
    ur: 'Urdu',
    tr: 'Turkish',
    ta: 'Tamil',
  };
  const langName = LANGUAGE_NAMES[targetLanguage] || targetLanguage;
  const srcLang = languageHint || sourceLanguage;
  const srcName = LANGUAGE_NAMES[srcLang] || srcLang;

  const TRANSLATE_PROMPT = `You are a professional translator. Translate the following document text from ${srcName} to ${langName}.

## ORIGINAL TEXT:
${ocrText}

## STRUCTURED FIELDS:
${JSON.stringify(ocrFields, null, 2)}

Return your response as JSON with this structure:
{
    "original_text": "the original text (copy from above)",
    "translated_text": "full translated text in ${langName}",
    "original_language": "${srcLang}",
    "target_language": "${targetLanguage}",
    "image_text": {
        "original": "",
        "translated": ""
    },
    "structured_data": {
        "original_fields": [
            {"key": "field name", "value": "original value"}
        ],
        "translated_fields": [
            {"key": "translated field name", "value": "translated value"}
        ]
    },
    "layout_preserved": true,
    "notes": "any relevant notes about the translation"
}

Return ONLY valid JSON, no additional text.`;

  if (config.provider === 'openai') {
    return await openaiChat({
      messages: [{ role: 'user', content: TRANSLATE_PROMPT }],
      temperature: 0.1,
      maxTokens: 8000,
    });
  }

  return await ollamaGenerate({
    model: config.ollama.reasoningModel,
    prompt: TRANSLATE_PROMPT,
  });
}

/**
 * Check for discrepancies across analyzed documents.
 * Simple version for quick checks.
 */
export async function checkDiscrepancies(
  documents: Array<{ name: string; analysis: Record<string, unknown> }>
) {
  const prompt = `Here is a list of documents that will be used in an immigration application to Canada. Check for any potential discrepancies/issues with these documents. Return a JSON response with hasDiscrepancies (boolean) and summary (string):

${JSON.stringify(documents, null, 2)}`;

  if (config.provider === 'openai') {
    return await openaiChat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      maxTokens: 4000,
    });
  }

  return await ollamaGenerate({
    model: config.ollama.reasoningModel,
    prompt,
  });
}

/**
 * Generate a comprehensive immigration document analysis report.
 * Matches scripts/report.py generate_report().
 */
export async function generateReport(
  documents: Array<{
    name: string;
    extracted_data: Record<string, unknown>;
    translation_data?: Record<string, unknown> | null;
  }>
) {
  // Prepare documents for analysis (matches report.py logic)
  const docsForAnalysis = documents.map(doc => {
    const extracted = doc.extracted_data || {};
    const translation = doc.translation_data || {};
    const structuredData = (extracted.structured_data ?? {}) as Record<
      string,
      unknown
    >;
    const translationStructured = (translation.structured_data ?? {}) as Record<
      string,
      unknown
    >;

    return {
      document_name: doc.name,
      document_type: extracted.document_type ?? 'unknown',
      original_language: extracted.document_language ?? 'unknown',
      original_text: extracted.text ?? '',
      original_fields: (structuredData.fields as unknown[]) ?? [],
      translated_text: translation.translated_text ?? '',
      translated_fields:
        (translationStructured.translated_fields as unknown[]) ?? [],
      image_text_original:
        ((translation.image_text as Record<string, unknown>)
          ?.original as string) ?? '',
      image_text_translated:
        ((translation.image_text as Record<string, unknown>)
          ?.translated as string) ?? '',
      translation_notes: translation.notes ?? '',
    };
  });

  const REPORT_PROMPT = `You are a legal document analyst specializing in immigration applications. Your task is to analyze identity and official documents for a client/family applying for immigration.

## DOCUMENTS PROVIDED:
${JSON.stringify(docsForAnalysis, null, 2)}

## YOUR TASK:
Generate a comprehensive analysis report. Be precise, factual, and focus on information relevant to immigration applications.

Return your response as JSON with this EXACT structure:
{
    "executive_summary": {
        "overview": "brief description of document set",
        "documents_analyzed": ${documents.length},
        "document_types": ["type1", "type2"],
        "overall_assessment": "CLEAR | MINOR CONCERNS | REQUIRES ATTENTION",
        "key_findings": ["finding 1", "finding 2"]
    },
    "personal_info_concordance": {
        "fields_compared": ["Full Name", "Date of Birth", "Place of Birth"],
        "comparison_table": [
            {
                "field": "Full Name",
                "values_by_document": [
                    {"document": "doc1.jpg", "original": "value", "translated": "value"}
                ],
                "is_consistent": true,
                "discrepancy_note": null
            }
        ],
        "consistency_summary": "summary"
    },
    "document_analysis": [
        {
            "document_name": "filename",
            "document_type": "type",
            "issuing_authority": "authority",
            "issue_date": "date or N/A",
            "validity": "validity or N/A",
            "key_information": { "original": {}, "translated": {} },
            "legibility_assessment": "Good | Fair | Poor",
            "translation_notes": "notes",
            "flags": ["flag 1"]
        }
    ],
    "cross_document_discrepancies": [
        {
            "discrepancy_type": "Name Spelling | Date | Information Conflict | Missing Info",
            "description": "detailed description",
            "documents_involved": ["doc1", "doc2"],
            "original_values": ["value1", "value2"],
            "severity": "High | Medium | Low",
            "recommendation": "what to do about it"
        }
    ],
    "translation_notes": {
        "ambiguous_terms": [{ "term": "term", "possible_translations": ["opt1"], "context": "ctx" }],
        "cultural_legal_terms": [{ "term": "term", "explanation": "explanation" }],
        "uncertain_readings": ["description"],
        "overall_translation_confidence": "High | Medium | Low"
    },
    "action_items": [
        {
            "priority": "High | Medium | Low",
            "category": "Translation | Verification | Documentation | Application",
            "action": "specific action",
            "reason": "why needed"
        }
    ],
    "report_metadata": {
        "generated_at": "${new Date().toISOString()}",
        "total_documents": ${documents.length},
        "languages_detected": []
    }
}

IMPORTANT:
- Compare BOTH original text AND translations when analyzing
- Pay special attention to name spellings - even minor variations matter for immigration
- Note any dates that don't align
- Flag anything that could raise questions during immigration processing
- Be concise but thorough

Return ONLY valid JSON, no additional text.`;

  if (config.provider === 'openai') {
    return await openaiChat({
      messages: [
        {
          role: 'system',
          content:
            'You are an expert immigration document analyst. Generate precise, actionable reports for legal professionals. Focus on factual analysis and flag any inconsistencies that could affect an immigration application.',
        },
        { role: 'user', content: REPORT_PROMPT },
      ],
      temperature: 0.2,
      maxTokens: 16000,
    });
  }

  return await ollamaGenerate({
    model: config.ollama.reasoningModel,
    prompt: REPORT_PROMPT,
  });
}
