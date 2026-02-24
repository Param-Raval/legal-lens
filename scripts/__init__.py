# Legal Lens - Document Analysis Scripts
# Python modules for OCR, translation, and report generation using GPT-4o

from .ocr import extract_text
from .translation import translate_document
from .report import generate_report
from .pdf_export import save_as_pdf

__all__ = ['extract_text', 'translate_document', 'generate_report', 'save_as_pdf']
