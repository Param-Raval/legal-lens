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
    'zh': 'Chinese',
    'es': 'Spanish',
    'pt': 'Portuguese',
    'de': 'German',
    'ja': 'Japanese',
    'ko': 'Korean',
    'hi': 'Hindi',
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
