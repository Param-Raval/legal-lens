"""
PDF export module - Generate formatted PDF reports for legal review.
"""

import os
from datetime import datetime
from fpdf import FPDF

from .types import AnalysisReport


class ImmigrationReportPDF(FPDF):
    """Custom PDF class for immigration document analysis reports."""
    
    def __init__(self):
        super().__init__()
        self.set_auto_page_break(auto=True, margin=15)
        
    def header(self):
        self.set_font('Helvetica', 'B', 10)
        self.set_text_color(100, 100, 100)
        self.cell(0, 10, 'Immigration Document Analysis Report', align='C')
        self.ln(5)
        self.set_draw_color(200, 200, 200)
        self.line(10, 20, 200, 20)
        self.ln(10)
        
    def footer(self):
        self.set_y(-15)
        self.set_font('Helvetica', 'I', 8)
        self.set_text_color(128, 128, 128)
        self.cell(0, 10, f'Page {self.page_no()}/{{nb}}', align='C')
    
    def section_title(self, title: str):
        self.set_font('Helvetica', 'B', 14)
        self.set_text_color(0, 51, 102)
        self.cell(0, 10, self._sanitize(title), ln=True)
        self.set_draw_color(0, 51, 102)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(5)
        
    def subsection_title(self, title: str):
        self.set_font('Helvetica', 'B', 11)
        self.set_text_color(51, 51, 51)
        self.cell(0, 8, self._sanitize(title), ln=True)
        self.ln(2)
        
    def body_text(self, text: str):
        self.set_font('Helvetica', '', 10)
        self.set_text_color(0, 0, 0)
        self.set_x(self.l_margin)  # Ensure x is at left margin
        self.multi_cell(0, 6, self._sanitize(text))
        self.ln(2)
        
    def bullet_point(self, text: str, indent: int = 10):
        self.set_font('Helvetica', '', 10)
        self.set_text_color(0, 0, 0)
        self.set_x(self.l_margin + indent)  # Use relative indent from left margin
        self.multi_cell(0, 6, f"- {self._sanitize(text)}")
        
    def severity_badge(self, severity: str):
        colors = {
            'High': (220, 53, 69),
            'Medium': (255, 193, 7),
            'Low': (40, 167, 69)
        }
        color = colors.get(severity, (128, 128, 128))
        self.set_fill_color(*color)
        self.set_text_color(255, 255, 255) if severity == 'High' else self.set_text_color(0, 0, 0)
        self.set_font('Helvetica', 'B', 8)
        self.cell(20, 5, severity, fill=True, align='C')
        self.set_text_color(0, 0, 0)
    
    def _sanitize(self, text) -> str:
        """Remove or replace Unicode characters that Helvetica can't handle."""
        if not isinstance(text, str):
            text = str(text)
        # Replace common Unicode characters with ASCII equivalents
        replacements = {
            '\u2022': '-', '\u2019': "'", '\u2018': "'",
            '\u201c': '"', '\u201d': '"', '\u2013': '-', '\u2014': '--',
            '\u00e9': 'e', '\u00e8': 'e', '\u00ea': 'e',
            '\u00e0': 'a', '\u00e2': 'a', '\u00ee': 'i',
            '\u00f4': 'o', '\u00fb': 'u', '\u00e7': 'c',
            '\u00c9': 'E', '\u00c8': 'E', '\u00ca': 'E',
            '\u00c0': 'A', '\u00c2': 'A', '\u00ce': 'I',
            '\u00d4': 'O', '\u00db': 'U', '\u00c7': 'C',
        }
        for unicode_char, ascii_char in replacements.items():
            text = text.replace(unicode_char, ascii_char)
        return text.encode('latin-1', 'replace').decode('latin-1')


def save_as_pdf(report: AnalysisReport, output_path: str, client_name: str = "Client") -> str:
    """
    Save the analysis report as a formatted PDF.
    
    Args:
        report: AnalysisReport dictionary from generate_report()
        output_path: Path where the PDF will be saved
        client_name: Name of the client/applicant for the cover page
        
    Returns:
        Path to the saved PDF file
    """
    pdf = ImmigrationReportPDF()
    pdf.alias_nb_pages()
    
    # Executive Summary (first page with client info)
    pdf.add_page()
    pdf.set_font('Helvetica', '', 14)
    pdf.set_text_color(51, 51, 51)
    pdf.cell(0, 10, f'Client: {pdf._sanitize(client_name)}', align='C', ln=True)
    pdf.cell(0, 10, f'Generated: {datetime.now().strftime("%B %d, %Y at %H:%M")}', align='C', ln=True)
    
    exec_summary = report.get('executive_summary', {})
    pdf.section_title('1. EXECUTIVE SUMMARY')
    
    assessment = exec_summary.get('overall_assessment', 'N/A')
    assessment_colors = {
        'CLEAR': (40, 167, 69),
        'MINOR CONCERNS': (255, 193, 7),
        'REQUIRES ATTENTION': (220, 53, 69)
    }
    
    pdf.set_font('Helvetica', 'B', 12)
    pdf.cell(50, 8, 'Overall Assessment: ')
    color = assessment_colors.get(assessment, (128, 128, 128))
    pdf.set_fill_color(*color)
    pdf.set_text_color(255, 255, 255) if assessment == 'REQUIRES ATTENTION' else pdf.set_text_color(0, 0, 0)
    pdf.cell(50, 8, assessment, fill=True, align='C', ln=True)
    pdf.set_text_color(0, 0, 0)
    pdf.ln(5)
    
    pdf.body_text(f"Documents Analyzed: {exec_summary.get('documents_analyzed', 'N/A')}")
    
    doc_types = exec_summary.get('document_types', [])
    if doc_types:
        pdf.body_text(f"Document Types: {', '.join(doc_types)}")
    
    pdf.body_text(exec_summary.get('overview', ''))
    
    pdf.subsection_title('Key Findings:')
    for finding in exec_summary.get('key_findings', []):
        pdf.bullet_point(finding)
    pdf.ln(5)
    
    # Personal Information Concordance
    concordance = report.get('personal_info_concordance', {})
    pdf.section_title('2. PERSONAL INFORMATION CONCORDANCE')
    pdf.body_text(concordance.get('consistency_summary', ''))
    pdf.ln(3)
    
    comparison_table = concordance.get('comparison_table', [])
    if comparison_table:
        # Build document glossary from the first row's values_by_document
        doc_glossary = {}
        first_row = comparison_table[0] if comparison_table else {}
        values = first_row.get('values_by_document', [])
        for idx, val in enumerate(values):
            doc_name = val.get('document', f'Document {idx + 1}')
            # Extract just the filename (not the full path)
            filename = os.path.basename(doc_name)
            doc_glossary[f'Doc {idx + 1}'] = filename
        
        # Print document glossary
        if doc_glossary:
            pdf.subsection_title('Document Key:')
            pdf.set_font('Helvetica', '', 9)
            for key, filename in doc_glossary.items():
                pdf.body_text(f"  {key}: {filename}")
            pdf.ln(3)
        
        pdf.set_font('Helvetica', 'B', 9)
        pdf.set_fill_color(0, 51, 102)
        pdf.set_text_color(255, 255, 255)
        
        col_widths = [30, 50, 50, 40]  # Total 170mm, leaving margin for safety
        # Use short headers that reference the glossary
        num_docs = len(values)
        headers = ['Field'] + [f'Doc {i+1}' for i in range(min(num_docs, 2))] + ['Status']
        if num_docs < 2:
            headers = ['Field', 'Doc 1', 'Doc 2', 'Status']  # Default if less than 2 docs
        for i, header in enumerate(headers):
            pdf.cell(col_widths[i], 8, header, border=1, fill=True, align='C')
        pdf.ln()
        
        pdf.set_font('Helvetica', '', 8)
        pdf.set_text_color(0, 0, 0)
        
        for row in comparison_table:
            field = pdf._sanitize(row.get('field', ''))[:20]
            values = row.get('values_by_document', [])
            val1 = pdf._sanitize(values[0].get('translated', values[0].get('original', 'N/A')))[:30] if len(values) > 0 else 'N/A'
            val2 = pdf._sanitize(values[1].get('translated', values[1].get('original', 'N/A')))[:30] if len(values) > 1 else 'N/A'
            consistent = 'MATCH' if row.get('is_consistent', False) else 'MISMATCH'
            
            fill_color = (144, 238, 144) if consistent == 'MATCH' else (255, 182, 193)
            
            pdf.cell(col_widths[0], 7, field, border=1)
            pdf.cell(col_widths[1], 7, val1, border=1)
            pdf.cell(col_widths[2], 7, val2, border=1)
            pdf.set_fill_color(*fill_color)
            pdf.cell(col_widths[3], 7, consistent, border=1, fill=True, align='C')
            pdf.ln()
    pdf.ln(5)
    
    # Document-by-Document Analysis
    # pdf.add_page()
    pdf.section_title('3. DOCUMENT-BY-DOCUMENT ANALYSIS')
    
    for doc in report.get('document_analysis', []):
        pdf.subsection_title(f"Document: {doc.get('document_name', 'Unknown')}")
        
        pdf.set_font('Helvetica', '', 9)
        pdf.cell(50, 6, f"Type: {pdf._sanitize(doc.get('document_type', 'N/A'))}")
        pdf.cell(0, 6, f"Issuing Authority: {pdf._sanitize(doc.get('issuing_authority', 'N/A'))}", ln=True)
        pdf.cell(50, 6, f"Issue Date: {pdf._sanitize(doc.get('issue_date', 'N/A'))}")
        pdf.cell(0, 6, f"Validity: {pdf._sanitize(doc.get('validity', 'N/A'))}", ln=True)
        pdf.cell(0, 6, f"Legibility: {pdf._sanitize(doc.get('legibility_assessment', 'N/A'))}", ln=True)
        
        if doc.get('translation_notes'):
            pdf.set_x(pdf.l_margin)  # Ensure x is at left margin
            pdf.set_font('Helvetica', 'I', 9)
            pdf.multi_cell(0, 5, f"Translation Notes: {pdf._sanitize(doc.get('translation_notes'))}")
        
        flags = doc.get('flags', [])
        if flags:
            pdf.set_x(pdf.l_margin)  # Ensure x is at left margin
            pdf.set_font('Helvetica', 'B', 9)
            pdf.set_text_color(220, 53, 69)
            pdf.multi_cell(0, 6, "Flags/Concerns:")
            pdf.set_text_color(0, 0, 0)
            pdf.set_font('Helvetica', '', 9)
            for flag in flags:
                pdf.set_x(pdf.l_margin + 5)  # Small indent from left margin
                pdf.multi_cell(0, 5, f"- {pdf._sanitize(flag)}")
        pdf.ln(5)
    
    # Cross-Document Discrepancies
    discrepancies = report.get('cross_document_discrepancies', [])
    if discrepancies:
        # pdf.add_page()
        pdf.section_title('4. CROSS-DOCUMENT DISCREPANCIES')
        
        for i, disc in enumerate(discrepancies, 1):
            pdf.set_font('Helvetica', 'B', 10)
            pdf.cell(140, 7, f"Discrepancy #{i}: {pdf._sanitize(disc.get('discrepancy_type', 'Unknown'))}")
            pdf.severity_badge(disc.get('severity', 'Medium'))
            pdf.ln(8)
            pdf.set_x(pdf.l_margin)  # Reset x to left margin
            
            pdf.set_font('Helvetica', '', 9)
            pdf.multi_cell(0, 5, f"Description: {pdf._sanitize(disc.get('description', 'N/A'))}")
            
            docs_involved = disc.get('documents_involved', [])
            if docs_involved:
                pdf.set_x(pdf.l_margin)
                pdf.multi_cell(0, 5, f"Documents: {', '.join(pdf._sanitize(d) for d in docs_involved)}")
            
            orig_values = disc.get('original_values', [])
            if orig_values:
                pdf.set_x(pdf.l_margin)
                pdf.multi_cell(0, 5, f"Values Found: {pdf._sanitize(' vs '.join(str(v) for v in orig_values))}")
            
            pdf.set_x(pdf.l_margin)
            pdf.set_font('Helvetica', 'I', 9)
            pdf.multi_cell(0, 5, f"Recommendation: {pdf._sanitize(disc.get('recommendation', 'N/A'))}")
            pdf.ln(5)
    
    # Translation Notes
    translation_notes = report.get('translation_notes', {})
    if translation_notes:
        # pdf.add_page()
        pdf.section_title('5. TRANSLATION ACCURACY NOTES')
        
        confidence = translation_notes.get('overall_translation_confidence', 'N/A')
        pdf.body_text(f"Overall Translation Confidence: {confidence}")
        
        ambiguous = translation_notes.get('ambiguous_terms', [])
        if ambiguous:
            pdf.subsection_title('Ambiguous Terms:')
            for term in ambiguous:
                translations = term.get('possible_translations', [])
                pdf.bullet_point(f"{pdf._sanitize(term.get('term', ''))}: {', '.join(pdf._sanitize(t) for t in translations)}")
        
        pdf.ln(10)
        
        cultural = translation_notes.get('cultural_legal_terms', [])
        if cultural:
            pdf.subsection_title('Cultural/Legal Terms:')
            for term in cultural:
                pdf.bullet_point(f"{pdf._sanitize(term.get('term', ''))}: {pdf._sanitize(term.get('explanation', ''))}")
        
        pdf.ln(10)
        
        uncertain = translation_notes.get('uncertain_readings', [])
        if uncertain:
            pdf.subsection_title('Uncertain/Hard-to-Read Sections:')
            for item in uncertain:
                pdf.bullet_point(pdf._sanitize(item))
        pdf.ln(5)
    
    # Action Items
    action_items = report.get('action_items', [])
    if action_items:
        # pdf.add_page()
        pdf.section_title('6. ACTION ITEMS')
        
        for priority in ['High', 'Medium', 'Low']:
            priority_items = [a for a in action_items if a.get('priority') == priority]
            if priority_items:
                pdf.subsection_title(f'{priority} Priority:')
                for item in priority_items:
                    pdf.set_font('Helvetica', '', 9)
                    category = item.get('category', 'General')
                    action = pdf._sanitize(item.get('action', 'N/A'))
                    reason = pdf._sanitize(item.get('reason', ''))
                    
                    pdf.bullet_point(f"[{category}] {action}")
                    if reason:
                        pdf.set_x(pdf.l_margin + 10)  # Indent from left margin
                        pdf.set_font('Helvetica', 'I', 8)
                        pdf.multi_cell(0, 5, f"Reason: {reason}")
                pdf.ln(3)
    
    # Disclaimer
    pdf.add_page()
    pdf.section_title('DISCLAIMER')
    pdf.set_font('Helvetica', 'I', 9)
    disclaimer = """This report is generated using AI-assisted document analysis and is intended to support, not replace, professional legal review. All findings should be verified by qualified legal professionals before use in immigration applications.

The translation and analysis provided are based on automated processing and may not capture all nuances of the original documents. For official purposes, certified translations from accredited translators may be required.

This report is confidential and intended solely for use by the legal team handling this immigration matter."""
    pdf.multi_cell(0, 5, disclaimer)
    
    pdf.output(output_path)
    return output_path
