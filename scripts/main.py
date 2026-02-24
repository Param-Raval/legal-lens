#!/usr/bin/env python3
"""
Main script to test the document analysis pipeline.
Run from the project root: python -m scripts.main
"""

import json
import sys
from datetime import datetime
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts.config import validate_config
from scripts.ocr import extract_text
from scripts.translation import translate_document
from scripts.report import generate_report
from scripts.pdf_export import save_as_pdf


def print_header(text: str):
    """Print a formatted header."""
    print("\n" + "=" * 70)
    print(text)
    print("=" * 70)


def print_step(step: int, text: str):
    """Print a step indicator."""
    print(f"\n[{step}] {text}")
    print("-" * 60)


def test_ocr(image_path: str):
    """Test OCR functionality."""
    print_step(1, f"Testing OCR on: {image_path}")
    
    result = extract_text(image_path)
    
    print(f"  Document Type: {result.get('document_type', 'N/A')}")
    print(f"  Language: {result.get('document_language', 'N/A')}")
    print(f"  Text Length: {len(result.get('text', ''))} characters")
    
    fields = result.get('structured_data', {}).get('fields', [])
    print(f"  Structured Fields: {len(fields)}")
    for field in fields[:5]:  # Show first 5 fields
        print(f"    - {field.get('key')}: {field.get('value')[:50]}...")
    
    return result


def test_translation(image_path: str, target_language: str = 'en'):
    """Test translation functionality."""
    print_step(2, f"Testing Translation to '{target_language}'")
    
    result = translate_document(image_path, target_language)
    
    print(f"  Original Language: {result.get('original_language', 'N/A')}")
    print(f"  Target Language: {result.get('target_language', 'N/A')}")
    print(f"  Original Text Length: {len(result.get('original_text', ''))} chars")
    print(f"  Translated Text Length: {len(result.get('translated_text', ''))} chars")
    
    if result.get('notes'):
        print(f"  Notes: {result.get('notes')[:100]}...")
    
    return result


def test_report(documents: list):
    """Test report generation."""
    print_step(3, f"Testing Report Generation ({len(documents)} documents)")
    
    report = generate_report(documents)
    
    exec_summary = report.get('executive_summary', {})
    print(f"  Assessment: {exec_summary.get('overall_assessment', 'N/A')}")
    print(f"  Documents Analyzed: {exec_summary.get('documents_analyzed', 0)}")
    
    discrepancies = report.get('cross_document_discrepancies', [])
    print(f"  Discrepancies Found: {len(discrepancies)}")
    for disc in discrepancies[:3]:  # Show first 3
        print(f"    - [{disc.get('severity')}] {disc.get('discrepancy_type')}: {disc.get('description')[:60]}...")
    
    action_items = report.get('action_items', [])
    print(f"  Action Items: {len(action_items)}")
    
    return report


def test_pdf_export(report: dict, output_path: str, client_name: str):
    """Test PDF export."""
    print_step(4, f"Testing PDF Export")
    
    pdf_path = save_as_pdf(report, output_path, client_name)
    
    print(f"  PDF saved to: {pdf_path}")
    print(f"  File size: {Path(pdf_path).stat().st_size / 1024:.1f} KB")
    
    return pdf_path


def run_full_pipeline(document_paths: list, client_name: str, output_dir: str = "output"):
    """
    Run the complete document analysis pipeline.
    
    Args:
        document_paths: List of tuples (doc_name, image_path)
        client_name: Name for the report
        output_dir: Directory for output files
    """
    print_header("IMMIGRATION DOCUMENT ANALYSIS PIPELINE")
    print(f"Client: {client_name}")
    print(f"Documents: {len(document_paths)}")
    
    # Validate configuration
    try:
        validate_config()
        print("\n[OK] Configuration validated")
    except EnvironmentError as e:
        print(f"\n[ERROR] {e}")
        return None
    
    # Create output directory
    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True)
    
    # Process each document
    processed_documents = []
    
    for doc_name, image_path in document_paths:
        print_header(f"Processing: {doc_name}")
        
        if not Path(image_path).exists():
            print(f"[SKIP] File not found: {image_path}")
            continue
        
        try:
            # OCR
            ocr_result = test_ocr(image_path)
            
            # Translation (if not English)
            translation_result = None
            if ocr_result.get('document_language', 'en') != 'en':
                translation_result = test_translation(image_path, 'en')
            else:
                print("\n[2] Translation: Skipped (document is already in English)")
            
            processed_documents.append({
                'name': doc_name,
                'extracted_data': ocr_result,
                'translation_data': translation_result
            })
            
        except Exception as e:
            print(f"[ERROR] Failed to process {doc_name}: {e}")
            continue
    
    if not processed_documents:
        print("\n[ERROR] No documents were successfully processed")
        return None
    
    # Generate report
    print_header("GENERATING ANALYSIS REPORT")
    try:
        report = test_report(processed_documents)
        
        # Save report JSON
        json_path = output_path / f"{client_name.replace(' ', '_')}_report.json"
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        print(f"\n  JSON report saved to: {json_path}")
        
    except Exception as e:
        print(f"[ERROR] Report generation failed: {e}")
        return None
    
    # Export PDF
    print_header("EXPORTING PDF REPORT")
    try:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        pdf_filename = f"{client_name.replace(' ', '_')}_{timestamp}.pdf"
        pdf_path = str(output_path / pdf_filename)
        
        test_pdf_export(report, pdf_path, client_name)
        
    except Exception as e:
        print(f"[ERROR] PDF export failed: {e}")
        pdf_path = None
    
    print_header("PIPELINE COMPLETE")
    
    return {
        'documents': processed_documents,
        'report': report,
        'json_path': str(json_path),
        'pdf_path': pdf_path
    }


# ============================================================================
# SAMPLE USAGE
# ============================================================================

if __name__ == "__main__":
    # Example: Process sample documents
    # Modify these paths to point to your actual documents
    
    # SAMPLE_DOCUMENTS = [
    #     ("Birth-Certificate-Haiti-handwritten.jpg", "sample_docs/French Haiti/Birth-Certificate-Haiti-handwritten.jpg"),
    #     ("Haitian.birthcertificate handwritten and scanned.png", "sample_docs/French Haiti/Haitian.birthcertificate handwritten and scanned.png"),
    # ]
    
    SAMPLE_DOCUMENTS = [
        ("Afghan Tazkera P1.png", "sample_docs\Afghan\Afghan Tazkera P1.png"),
        ("Afghan Tazkera P2.png", "sample_docs\Afghan\Afghan Tazkera P2.png"),
        ("Afghan Tazkera P3.png", "sample_docs\Afghan\Afghan Tazkera P3.png"),
        ("Afghan Tazkera P4.png", "sample_docs\Afghan\Afghan Tazkera P4.png"),
        ("Afghan Tazkera P5.png", "sample_docs\Afghan\Afghan Tazkera P5.png"),
        ("Afghan Tazkera.png", "sample_docs\Afghan\Afghan Tazkera.png"),
        ("Afghanistan - national ID card - typed.png", "sample_docs\Afghan\Afghanistan - national ID card - typed.png"),
        ("Afghanistan - national ID card - typed+handwritten.png", "sample_docs\Afghan\Afghanistan - national ID card - typed+handwritten.png")
    ]
    
    CLIENT_NAME = "Afghan Test Client"
    OUTPUT_DIR = "output"
    
    # Check if sample documents exist
    existing_docs = [(name, path) for name, path in SAMPLE_DOCUMENTS if Path(path).exists()]
    
    if not existing_docs:
        print("No sample documents found. Please update SAMPLE_DOCUMENTS paths in main.py")
        print("\nExpected paths:")
        for name, path in SAMPLE_DOCUMENTS:
            status = "[OK]" if Path(path).exists() else "[NOT FOUND]"
            print(f"  {status} {path}")
        sys.exit(1)
    
    print(f"Found {len(existing_docs)} of {len(SAMPLE_DOCUMENTS)} sample documents")
    
    # Run the pipeline
    result = run_full_pipeline(existing_docs, CLIENT_NAME, OUTPUT_DIR)
    
    if result:
        print("\n" + "=" * 70)
        print("OUTPUT FILES:")
        print("=" * 70)
        print(f"  JSON Report: {result.get('json_path')}")
        print(f"  PDF Report:  {result.get('pdf_path')}")
        print("\nDone!")
    else:
        print("\nPipeline failed. Check error messages above.")
        sys.exit(1)
