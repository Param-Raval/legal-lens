"""
OCR module - Extract text and structured data from document images using GPT-4o Vision.
"""

import base64
import json
import re
import time
from pathlib import Path
from openai import OpenAI

from .config import GPT4O_ENDPOINT, GPT4O_API_KEY, GPT4O_DEPLOYMENT
from .types import OCRResult


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
    text = re.sub(r'[,:\s]+$', '', text)

    # Close open structures in reverse order
    for bracket in reversed(stack):
        text += ']' if bracket == '[' else '}'

    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"Could not repair truncated JSON: {e}")


OCR_PROMPT = """Extract all text and structured data from this document.

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

Return ONLY valid JSON, no additional text."""


def extract_text(image_path: str) -> OCRResult:
    """
    Extract text and structured data from a document image using GPT-4o Vision.
    
    Args:
        image_path: Path to the image file
        
    Returns:
        OCRResult dictionary with text, document_type, document_language,
        structured_data, and tables
        
    Raises:
        FileNotFoundError: If image file doesn't exist
        Exception: If API call fails or response parsing fails
    """
    if not Path(image_path).exists():
        raise FileNotFoundError(f"Image not found: {image_path}")
    
    client = _get_client()
    mime_type = _get_mime_type(image_path)
    base64_image = _encode_image(image_path)
    
    max_retries = 1
    last_error = None
    
    for attempt in range(max_retries + 1):
        try:
            response = client.chat.completions.create(
                model=GPT4O_DEPLOYMENT,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": OCR_PROMPT},
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
                print(f"  [RETRY] OCR attempt {attempt + 1} failed: {e}")
                time.sleep(2 ** attempt)
                continue
            raise Exception(f"Failed to parse OCR response after {attempt + 1} attempt(s): {last_error}")
