/**
 * Client-side PDF export using jsPDF.
 * Ported from scripts/pdf_export.py ImmigrationReportPDF.
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { AnalysisReport } from '@/types';

// Extend jsPDF type for autoTable
declare module 'jspdf' {
  interface jsPDF {
    lastAutoTable: { finalY: number };
  }
}

const COLORS = {
  navy: [0, 51, 102] as [number, number, number],
  dark: [51, 51, 51] as [number, number, number],
  gray: [100, 100, 100] as [number, number, number],
  lightBorder: [200, 200, 200] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  black: [0, 0, 0] as [number, number, number],
  green: [40, 167, 69] as [number, number, number],
  yellow: [255, 193, 7] as [number, number, number],
  red: [220, 53, 69] as [number, number, number],
  lightGreen: [144, 238, 144] as [number, number, number],
  lightRed: [255, 182, 193] as [number, number, number],
};

function sanitize(text: unknown): string {
  if (typeof text !== 'string') text = String(text ?? '');
  return (text as string)
    .replace(/[\u2022]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013]/g, '-')
    .replace(/[\u2014]/g, '--');
}

function getAssessmentColor(assessment: string): [number, number, number] {
  if (assessment === 'CLEAR') return COLORS.green;
  if (assessment === 'MINOR CONCERNS') return COLORS.yellow;
  return COLORS.red;
}

function getSeverityColor(severity: string): [number, number, number] {
  if (severity === 'High') return COLORS.red;
  if (severity === 'Medium') return COLORS.yellow;
  return COLORS.green;
}

export function exportReportAsPdf(
  report: AnalysisReport,
  clientName: string = 'Client'
): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 20;
  const margin = 15;
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - margin * 2;

  const checkPageBreak = (needed: number) => {
    if (y + needed > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      y = 20;
    }
  };

  const sectionTitle = (title: string) => {
    checkPageBreak(20);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.navy);
    doc.text(sanitize(title), margin, y);
    y += 2;
    doc.setDrawColor(...COLORS.navy);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;
  };

  const subTitle = (title: string) => {
    checkPageBreak(12);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.dark);
    doc.text(sanitize(title), margin, y);
    y += 6;
  };

  const bodyText = (text: string, indent = 0) => {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.black);
    const lines = doc.splitTextToSize(sanitize(text), contentWidth - indent);
    checkPageBreak(lines.length * 5 + 2);
    doc.text(lines, margin + indent, y);
    y += lines.length * 5 + 2;
  };

  const bullet = (text: string, indent = 5) => {
    const lines = doc.splitTextToSize(
      `- ${sanitize(text)}`,
      contentWidth - indent
    );
    checkPageBreak(lines.length * 5);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.black);
    doc.text(lines, margin + indent, y);
    y += lines.length * 5;
  };

  // ── Header & Client Info ──────────────────────────────────────────────

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.gray);
  doc.text('Immigration Document Analysis Report', pageWidth / 2, 10, {
    align: 'center',
  });
  doc.setDrawColor(...COLORS.lightBorder);
  doc.line(margin, 14, pageWidth - margin, 14);

  y = 25;
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.dark);
  doc.text(`Client: ${sanitize(clientName)}`, pageWidth / 2, y, {
    align: 'center',
  });
  y += 8;
  doc.text(
    `Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    pageWidth / 2,
    y,
    { align: 'center' }
  );
  y += 12;

  // ── 1. Executive Summary ──────────────────────────────────────────────

  const exec = report.executive_summary;
  sectionTitle('1. EXECUTIVE SUMMARY');

  // Assessment badge
  const assessment = exec.overall_assessment || 'N/A';
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Overall Assessment: ', margin, y);
  const aWidth = doc.getTextWidth('Overall Assessment: ');
  const badgeColor = getAssessmentColor(assessment);
  doc.setFillColor(...badgeColor);
  doc.setTextColor(
    assessment === 'REQUIRES ATTENTION' ? 255 : 0,
    assessment === 'REQUIRES ATTENTION' ? 255 : 0,
    assessment === 'REQUIRES ATTENTION' ? 255 : 0
  );
  doc.rect(margin + aWidth + 2, y - 5, 50, 8, 'F');
  doc.setFontSize(9);
  doc.text(assessment, margin + aWidth + 27, y - 0.5, { align: 'center' });
  doc.setTextColor(...COLORS.black);
  y += 10;

  bodyText(`Documents Analyzed: ${exec.documents_analyzed}`);
  if (exec.document_types?.length) {
    bodyText(`Document Types: ${exec.document_types.join(', ')}`);
  }
  bodyText(exec.overview || '');
  y += 2;

  subTitle('Key Findings:');
  for (const finding of exec.key_findings || []) {
    bullet(finding);
  }
  y += 5;

  // ── 2. Personal Information Concordance ───────────────────────────────

  const concordance = report.personal_info_concordance;
  sectionTitle('2. PERSONAL INFORMATION CONCORDANCE');
  bodyText(concordance?.consistency_summary || '');
  y += 3;

  const table = concordance?.comparison_table;
  if (table?.length) {
    const numDocs = table[0].values_by_document?.length || 0;
    const head = [
      'Field',
      ...Array.from({ length: Math.min(numDocs, 3) }, (_, i) => `Doc ${i + 1}`),
      'Status',
    ];

    const body = table.map(row => {
      const vals = row.values_by_document || [];
      const docVals = Array.from({ length: Math.min(numDocs, 3) }, (_, i) => {
        const v = vals[i];
        return sanitize(v?.translated || v?.original || 'N/A').slice(0, 35);
      });
      return [
        sanitize(row.field).slice(0, 25),
        ...docVals,
        row.is_consistent ? 'MATCH' : 'MISMATCH',
      ];
    });

    autoTable(doc, {
      startY: y,
      head: [head],
      body,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: COLORS.navy, textColor: COLORS.white },
      didParseCell: data => {
        if (data.section === 'body' && data.column.index === head.length - 1) {
          const val = data.cell.raw as string;
          data.cell.styles.fillColor =
            val === 'MATCH' ? COLORS.lightGreen : COLORS.lightRed;
        }
      },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── 3. Document-by-Document Analysis ──────────────────────────────────

  sectionTitle('3. DOCUMENT-BY-DOCUMENT ANALYSIS');

  for (const da of report.document_analysis || []) {
    subTitle(`Document: ${da.document_name}`);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    bodyText(
      `Type: ${da.document_type || 'N/A'}  |  Authority: ${da.issuing_authority || 'N/A'}`
    );
    bodyText(
      `Issue Date: ${da.issue_date || 'N/A'}  |  Validity: ${da.validity || 'N/A'}  |  Legibility: ${da.legibility_assessment || 'N/A'}`
    );

    if (da.translation_notes) {
      doc.setFont('helvetica', 'italic');
      bodyText(`Translation Notes: ${da.translation_notes}`);
      doc.setFont('helvetica', 'normal');
    }

    if (da.flags?.length) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.red);
      checkPageBreak(8);
      doc.text('Flags/Concerns:', margin, y);
      y += 5;
      doc.setTextColor(...COLORS.black);
      doc.setFont('helvetica', 'normal');
      for (const flag of da.flags) {
        bullet(flag, 8);
      }
    }
    y += 5;
  }

  // ── 4. Cross-Document Discrepancies ───────────────────────────────────

  const discrepancies = report.cross_document_discrepancies;
  if (discrepancies?.length) {
    sectionTitle('4. CROSS-DOCUMENT DISCREPANCIES');

    for (let i = 0; i < discrepancies.length; i++) {
      const disc = discrepancies[i];
      checkPageBreak(30);

      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(
        `Discrepancy #${i + 1}: ${sanitize(disc.discrepancy_type)}`,
        margin,
        y
      );

      // Severity badge
      const sevColor = getSeverityColor(disc.severity);
      const badgeX = pageWidth - margin - 22;
      doc.setFillColor(...sevColor);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      const textFill = disc.severity === 'High' ? COLORS.white : COLORS.black;
      doc.setTextColor(...textFill);
      doc.rect(badgeX, y - 4, 22, 6, 'F');
      doc.text(disc.severity, badgeX + 11, y, { align: 'center' });
      doc.setTextColor(...COLORS.black);
      y += 7;

      doc.setFont('helvetica', 'normal');
      bodyText(`Description: ${disc.description}`);
      if (disc.documents_involved?.length) {
        bodyText(`Documents: ${disc.documents_involved.join(', ')}`);
      }
      if (disc.original_values?.length) {
        bodyText(`Values: ${disc.original_values.join(' vs ')}`);
      }
      doc.setFont('helvetica', 'italic');
      bodyText(`Recommendation: ${disc.recommendation || 'N/A'}`);
      doc.setFont('helvetica', 'normal');
      y += 5;
    }
  }

  // ── 5. Translation Notes ──────────────────────────────────────────────

  const tn = report.translation_notes;
  if (tn) {
    sectionTitle('5. TRANSLATION ACCURACY NOTES');
    bodyText(
      `Overall Translation Confidence: ${tn.overall_translation_confidence || 'N/A'}`
    );

    if (tn.ambiguous_terms?.length) {
      subTitle('Ambiguous Terms:');
      for (const t of tn.ambiguous_terms) {
        bullet(`${t.term}: ${t.possible_translations?.join(', ') || ''}`);
      }
      y += 3;
    }

    if (tn.cultural_legal_terms?.length) {
      subTitle('Cultural/Legal Terms:');
      for (const t of tn.cultural_legal_terms) {
        bullet(`${t.term}: ${t.explanation}`);
      }
      y += 3;
    }

    if (tn.uncertain_readings?.length) {
      subTitle('Uncertain/Hard-to-Read Sections:');
      for (const item of tn.uncertain_readings) {
        bullet(item);
      }
    }
    y += 5;
  }

  // ── 6. Action Items ───────────────────────────────────────────────────

  const actions = report.action_items;
  if (actions?.length) {
    sectionTitle('6. ACTION ITEMS');

    for (const priority of ['High', 'Medium', 'Low']) {
      const items = actions.filter(a => a.priority === priority);
      if (!items.length) continue;

      subTitle(`${priority} Priority:`);
      for (const item of items) {
        bullet(`[${item.category}] ${item.action}`);
        if (item.reason) {
          doc.setFontSize(8);
          doc.setFont('helvetica', 'italic');
          const reasonLines = doc.splitTextToSize(
            `Reason: ${sanitize(item.reason)}`,
            contentWidth - 12
          );
          checkPageBreak(reasonLines.length * 4);
          doc.text(reasonLines, margin + 12, y);
          y += reasonLines.length * 4;
          doc.setFont('helvetica', 'normal');
        }
      }
      y += 3;
    }
  }

  // ── Disclaimer ────────────────────────────────────────────────────────

  doc.addPage();
  sectionTitle('DISCLAIMER');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'italic');
  const disclaimer = `This report is generated using AI-assisted document analysis and is intended to support, not replace, professional legal review. All findings should be verified by qualified legal professionals before use in immigration applications.

The translation and analysis provided are based on automated processing and may not capture all nuances of the original documents. For official purposes, certified translations from accredited translators may be required.

This report is confidential and intended solely for use by the legal team handling this immigration matter.`;
  const dLines = doc.splitTextToSize(disclaimer, contentWidth);
  doc.text(dLines, margin, y);

  // ── Footer on every page ──────────────────────────────────────────────

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(128, 128, 128);
    doc.text(
      `Page ${i} / ${totalPages}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 8,
      { align: 'center' }
    );
  }

  // ── Save ──────────────────────────────────────────────────────────────

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${clientName.replace(/\s+/g, '_')}_Report_${timestamp}.pdf`;
  doc.save(filename);
}
