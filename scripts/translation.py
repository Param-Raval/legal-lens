"""
Translation module - Translate documents using GPT-4o VLM.
"""

import base64
import json
import re
import time
from pathlib import Path
from openai import OpenAI

from .config import GPT4O_ENDPOINT, GPT4O_API_KEY, GPT4O_DEPLOYMENT
from .types import TranslationResult


# Language code to name mapping
LANGUAGE_NAMES = {
    'en': 'English',
    'fr': 'French',
    'ar': 'Arabic',
    'fa_AF': 'Dari',
    'fa': 'Farsi',
    'zh': 'Chinese',
    'es': 'Spanish',
    'pt': 'Portuguese',
    'de': 'German',
    'ja': 'Japanese',
    'ko': 'Korean',
    'hi': 'Hindi',
    'bn': 'Bengali',
    'ne': 'Nepali',
    'ru': 'Russian',
    'ur': 'Urdu',
    'tr': 'Turkish',
    'ta': 'Tamil',
    'ht': 'Haitian Creole',
}


# Initialize client
_client = None

def _get_client() -> OpenAI:
    """Get or create the OpenAI client."""
    global _client
    if _client is None:
        _client = OpenAI(base_url=GPT4O_ENDPOINT, api_key=GPT4O_API_KEY)
    return _client


def _get_mime_type(image_path: str) -> str:
    """Determine MIME type from file extension."""
    ext = Path(image_path).suffix.lower()
    return {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
    }.get(ext, 'image/jpeg')


def _encode_image(image_path: str) -> str:
    """Read and encode image to base64."""
    with open(image_path, 'rb') as f:
        return base64.b64encode(f.read()).decode('utf-8')


def _repair_truncated_json(text: str) -> dict:
    """
    Attempt to repair truncated JSON by closing open strings, arrays, and objects.
    This handles cases where the response was cut off due to max_tokens.
    """
    if not text or not text.strip():
        raise ValueError("Empty response text")

    # Try parsing as-is first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try extracting JSON block
    json_match = re.search(r'\{', text)
    if json_match:
        text = text[json_match.start():]

    # Track state to close open structures
    in_string = False
    escape_next = False
    stack = []

    for char in text:
        if escape_next:
            escape_next = False
            continue
        if char == '\\':
            if in_string:
                escape_next = True
            continue
        if char == '"' and not escape_next:
            in_string = not in_string
            continue
        if in_string:
            continue
        if char in ('{', '['):
            stack.append(char)
        elif char == '}' and stack and stack[-1] == '{':
            stack.pop()
        elif char == ']' and stack and stack[-1] == '[':
            stack.pop()

    # Close any open string
    if in_string:
        text += '"'

    # Remove any trailing comma or colon before closing
    text = re.sub(r'[,:\\s]+$', '', text)

    # Close open structures in reverse order
    for bracket in reversed(stack):
        text += ']' if bracket == '[' else '}'

    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"Could not repair truncated JSON: {e}")


def _get_translation_prompt(target_language: str) -> str:
    """Generate the translation prompt for a target language."""
    lang_name = LANGUAGE_NAMES.get(target_language, target_language)
    
    return f"""Translate this document to {lang_name} ({target_language}).

For government documents with text and images:
1. Extract all text from the document
2. Translate all text to {lang_name}
3. Preserve the document structure and layout
4. For text found in images (logos, stamps, handwritten text), extract and translate it
5. Present the translation alongside the original, indicating which parts are from images vs regular text

Return your response as JSON with this structure:
{{
    "original_text": "original extracted text",
    "translated_text": "translated text to {lang_name}",
    "original_language": "detected language code",
    "target_language": "{target_language}",
    "image_text": {{
        "original": "text found in images/stamps/logos",
        "translated": "translated image text"
    }},
    "structured_data": {{
        "original_fields": [
            {{"key": "field name", "value": "original value"}}
        ],
        "translated_fields": [
            {{"key": "translated field name", "value": "translated value"}}
        ]
    }},
    "layout_preserved": true,
    "notes": "any relevant notes about the translation or document structure"
}}

Return ONLY valid JSON, no additional text."""


def _safe_json_object_response(text: str) -> dict:
    """Parse JSON object with repair fallback for truncated model output."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return _repair_truncated_json(text)


def _postprocess_line_alignment(source_lines: list[str], translated_lines: list[str]) -> list[str]:
    """Keep output deterministic: one translated line per source line."""
    if len(translated_lines) == len(source_lines):
        return translated_lines
    fixed = translated_lines[: len(source_lines)]
    if len(fixed) < len(source_lines):
        fixed.extend(source_lines[len(fixed):])
    return fixed


def translate_lines_strict(
    lines: list[str],
    source_language: str,
    target_language: str = 'en',
    language_hint: str | None = None,
) -> dict:
    """
    Translate OCR lines with strict anti-hallucination constraints.

    Returns:
      {
        "source_language": str,
        "target_language": str,
        "translated_lines": list[str]
      }
    """
    if not lines:
        return {
            'source_language': language_hint or source_language,
            'target_language': target_language,
            'translated_lines': [],
        }

    src_lang = language_hint or source_language or 'unknown'
    src_name = LANGUAGE_NAMES.get(src_lang, src_lang)
    tgt_name = LANGUAGE_NAMES.get(target_language, target_language)

    prompt = f"""You are a professional legal-document translator.
Translate each input line from {src_name} ({src_lang}) to {tgt_name} ({target_language}).

CRITICAL RULES:
1. Output must contain exactly the same number of lines as input.
2. Preserve order exactly.
3. Do NOT add information not present in source.
4. Keep numbers, IDs, dates, document numbers, stamps, and codes unchanged unless translation is obvious and lossless.
5. If text is unclear/illegible, copy the original line unchanged.
6. Keep proper names transliterated, not invented.
7. No summaries, no explanations.

Return JSON only:
{{
  "translated_lines": ["..."],
  "notes": "optional short note"
}}

Input lines:
{json.dumps(lines, ensure_ascii=False)}
"""

    client = _get_client()
    response = client.chat.completions.create(
        model=GPT4O_DEPLOYMENT,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.0,
        max_tokens=8000,
        response_format={"type": "json_object"},
    )

    content = (response.choices[0].message.content or '{}').strip()
    payload = _safe_json_object_response(content)
    translated_lines = payload.get('translated_lines', [])
    translated_lines = _postprocess_line_alignment(lines, translated_lines)

    return {
        'source_language': src_lang,
        'target_language': target_language,
        'translated_lines': translated_lines,
        'notes': payload.get('notes', ''),
    }


def translate_text_strict(
    ocr_text: str,
    ocr_fields: list[dict],
    source_language: str,
    target_language: str = 'en',
    language_hint: str | None = None,
) -> TranslationResult:
    """
    App-aligned text translation path (like src/lib/ai-client.ts translateText)
    with stronger anti-hallucination constraints.
    """
    src_lang = language_hint or source_language or 'unknown'
    src_name = LANGUAGE_NAMES.get(src_lang, src_lang)
    tgt_name = LANGUAGE_NAMES.get(target_language, target_language)

    prompt = f"""You are a professional translator for immigration/legal documents.
Translate the following OCR text from {src_name} ({src_lang}) to {tgt_name} ({target_language}).

STRICT CONSTRAINTS:
1. Do not invent or infer missing content.
2. Preserve numbers, identifiers, dates, and proper nouns unless direct translation/transliteration is clear.
3. If a segment is illegible, keep it unchanged.
4. Keep document structure and line breaks as much as possible.

## ORIGINAL TEXT
{ocr_text}

## STRUCTURED FIELDS
{json.dumps(ocr_fields, ensure_ascii=False)}

Return JSON only with this exact schema:
{{
  "original_text": "...",
  "translated_text": "...",
  "original_language": "{src_lang}",
  "target_language": "{target_language}",
  "image_text": {{"original": "", "translated": ""}},
  "structured_data": {{
    "original_fields": [{{"key": "...", "value": "..."}}],
    "translated_fields": [{{"key": "...", "value": "..."}}]
  }},
  "layout_preserved": true,
  "notes": "brief quality note"
}}
"""

    client = _get_client()
    response = client.chat.completions.create(
        model=GPT4O_DEPLOYMENT,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.0,
        max_tokens=9000,
        response_format={"type": "json_object"},
    )

    content = (response.choices[0].message.content or '{}').strip()
    payload = _safe_json_object_response(content)

    # Defensive defaults for schema compatibility.
    return {
        'original_text': payload.get('original_text', ocr_text),
        'translated_text': payload.get('translated_text', ''),
        'original_language': payload.get('original_language', src_lang),
        'target_language': payload.get('target_language', target_language),
        'image_text': payload.get('image_text', {'original': '', 'translated': ''}),
        'structured_data': payload.get(
            'structured_data',
            {
                'original_fields': ocr_fields or [],
                'translated_fields': [],
            },
        ),
        'layout_preserved': bool(payload.get('layout_preserved', True)),
        'notes': payload.get('notes', ''),
    }


def translate_document(image_path: str, target_language: str = 'en') -> TranslationResult:
    """
    Translate a document image using GPT-4o VLM.
    
    Args:
        image_path: Path to the document image
        target_language: Target language code (default: 'en')
        
    Returns:
        TranslationResult dictionary with original and translated text,
        structured data, and translation notes
        
    Raises:
        FileNotFoundError: If image file doesn't exist
        Exception: If API call fails or response parsing fails
    """
    if not Path(image_path).exists():
        raise FileNotFoundError(f"Image not found: {image_path}")
    
    client = _get_client()
    mime_type = _get_mime_type(image_path)
    base64_image = _encode_image(image_path)
    prompt = _get_translation_prompt(target_language)
    
    max_retries = 1
    last_error = None
    
    for attempt in range(max_retries + 1):
        try:
            response = client.chat.completions.create(
                model=GPT4O_DEPLOYMENT,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{base64_image}"}}
                    ]
                }],
                temperature=0.1,
                max_tokens=10000,
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
                    "This may be due to content filtering or the image being unreadable."
                )
            
            response_text = choice.message.content
            
            # Warn if response was truncated
            if choice.finish_reason == 'length':
                print(f"  [WARN] Response was truncated (hit token limit), attempting JSON repair...")
            
            # Parse — with repair fallback for truncated responses
            try:
                return json.loads(response_text)
            except json.JSONDecodeError:
                return _repair_truncated_json(response_text)
        
        except Exception as e:
            last_error = e
            if attempt < max_retries and "Empty response" not in str(e):
                print(f"  [RETRY] Translation attempt {attempt + 1} failed: {e}")
                time.sleep(2 ** attempt)
                continue
            raise Exception(f"Failed to parse translation response after {attempt + 1} attempt(s): {last_error}")
