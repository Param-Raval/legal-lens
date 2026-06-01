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

// Turkish (and a few related) letters that are NOT in jsPDF's default Helvetica
// (WinAnsi/CP1252) encoding. Left unmapped, jsPDF substitutes garbage glyphs
// (\u0130 rendered as "0", \u015e as "^") AND mis-measures the line width, which is what
// produced the stretched "A Y L 0 N" letter-spacing in the report. We
// transliterate them to ASCII so names render readably (e.g. AYL\u0130N, AY\u015eE).
const NON_WINANSI_MAP: Record<string, string> = {
  İ: 'I',
  ı: 'i',
  Ş: 'S',
  ş: 's',
  Ğ: 'G',
  ğ: 'g',
};

function sanitize(text: unknown): string {
  if (typeof text !== 'string') text = String(text ?? '');
  return (
    (text as string)
      .replace(/[•]/g, '-')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–]/g, '-')
      .replace(/[—]/g, '--')
      .replace(/[İıŞşĞğ]/g, c => NON_WINANSI_MAP[c] ?? c)
      // Any char >= U+0100 is outside Latin-1 (which jsPDF's WinAnsi font covers)
      // and renders as garbage: fold accents to ASCII (Ā -> A) where possible,
      // else drop it. Chars <= U+00FF (ASCII, newlines/tabs, accented Latin-1) are
      // left untouched.
      .replace(/[Ā-￿]/g, c => {
        const folded = c.normalize('NFKD').replace(/[̀-ͯ]/g, '');
        // Fold accents to ASCII where possible; otherwise emit a sentinel (NEVER '')
        // so a non-Latin name (Cyrillic/Arabic/CJK) can't silently vanish from the PDF.
        return /^[\x20-\x7e]*$/.test(folded) ? folded : '¤';
      })
      // Collapse runs of untransliterable characters into one visible marker. The exact
      // characters remain intact in the on-screen report and the JSON export.
      .replace(/¤+/g, '[?]')
  );
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
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.dark);
    // Wrap long sub-titles (e.g. member concordance summaries) instead of letting
    // them run off the right margin.
    const lines = doc.splitTextToSize(sanitize(title), contentWidth);
    checkPageBreak(lines.length * 6 + 2);
    doc.text(lines, margin, y);
    y += lines.length * 6;
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
  y += 6;

  // Transliteration disclaimer: the PDF font cannot render non-Latin scripts, so
  // names are transliterated and unrenderable characters are marked "[?]". The exact
  // characters are preserved in the on-screen report and the JSON export.
  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(...COLORS.gray);
  const disclaimerLines = doc.splitTextToSize(
    'Names in non-Latin scripts are transliterated to Latin for display ("[?]" marks characters that could not be rendered). The JSON export preserves the exact original characters.',
    pageWidth - margin * 2
  );
  doc.text(disclaimerLines, pageWidth / 2, y, { align: 'center' });
  y += disclaimerLines.length * 3.5 + 8;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.black);

  // ── 1. Personal Information Concordance ───────────────────────────────

  const concordance = report.personal_info_concordance;
  sectionTitle('1. PERSONAL INFORMATION CONCORDANCE');
  bodyText(concordance?.consistency_summary || '');
  y += 3;

  const buildConcordanceAutoTable = (
    rows: NonNullable<typeof concordance>['comparison_table'],
    label?: string
  ) => {
    if (!rows?.length) return;
    if (label) subTitle(label);
    const head = ['Field', 'Values by Document', 'Status', 'Note'];
    const body = rows.map(row => {
      const values = (row.values_by_document || [])
        .map(v => {
          const docName = sanitize(
            v.document
              ? (v.document.split('/').pop()?.split('\\').pop() ?? v.document)
              : 'Document'
          );
          const display = sanitize(v.translated || v.original || 'N/A');
          const legNote =
            v.legibility === 'Poor'
              ? ' (⚠ Poor legibility)'
              : v.legibility === 'Fair'
                ? ' (⚠ Fair legibility)'
                : '';
          return `${docName}: ${display}${legNote}`;
        })
        .join('\n');
      return [
        sanitize(row.field).slice(0, 28),
        values || 'N/A',
        row.status === 'consistent'
          ? 'Consistent'
          : row.status === 'inconsistent'
            ? 'Inconsistent'
            : row.status === 'missing_info'
              ? 'Missing info'
              : 'Needs review',
        sanitize(row.note || ''),
      ];
    });
    autoTable(doc, {
      startY: y,
      head: [head],
      body,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: COLORS.navy, textColor: COLORS.white },
      columnStyles: {
        0: { cellWidth: 35 },
        1: { cellWidth: 95 },
        2: { cellWidth: 20, halign: 'center' },
      },
      didParseCell: data => {
        if (data.section === 'body' && data.column.index === 2) {
          const val = data.cell.raw as string;
          data.cell.styles.fillColor =
            val === 'Consistent'
              ? COLORS.lightGreen
              : val === 'Inconsistent'
                ? COLORS.lightRed
                : val === 'Missing info'
                  ? ([255, 213, 153] as [number, number, number])
                  : ([255, 236, 153] as [number, number, number]);
        }
      },
    });
    y = doc.lastAutoTable.finalY + 8;
  };

  if (concordance?.byMember?.length) {
    // Family mode: one sub-table per member
    for (const memberConc of concordance.byMember) {
      checkPageBreak(20);
      const memberLabel = `${memberConc.memberName}: ${memberConc.consistency_summary}`;
      if (memberConc.comparison_table.length > 0) {
        buildConcordanceAutoTable(memberConc.comparison_table, memberLabel);
      } else {
        subTitle(memberLabel);
        bodyText('No cross-document field comparisons for this member.', 3);
        y += 4;
      }
    }
  } else {
    // Non-family mode: flat table
    const table = concordance?.comparison_table;
    buildConcordanceAutoTable(table ?? []);
  }

  // ── 2. Per-Document Discrepancies ─────────────────────────────────────

  const perDoc = report.per_document_discrepancies;
  if (perDoc?.length) {
    sectionTitle('2. PER-DOCUMENT DISCREPANCIES');

    for (const item of perDoc) {
      subTitle(`Document: ${item.document_name}`);
      bodyText(
        item.summary || 'No material document-level discrepancies detected.'
      );

      if (item.discrepancies?.length) {
        // Discrepancies are pre-sorted most-important-first; no severity label shown.
        for (const d of item.discrepancies) {
          doc.setFont('helvetica', 'normal');
          bodyText(`${d.discrepancy_type}: ${d.description}`, 3);
          if (d.fields_involved?.length) {
            bodyText(`Fields: ${d.fields_involved.join(', ')}`, 6);
          }
          if (d.original_values?.length) {
            bodyText(`Values: ${d.original_values.join(' vs ')}`, 6);
          }
          bodyText(`Recommendation: ${d.recommendation || 'N/A'}`, 6);
          y += 2;
        }
      } else {
        bodyText('No discrepancy items.', 3);
      }
      y += 4;
    }
  }

  // ── Scope of Analysis (how the request was interpreted) ───────────────

  const scope = report.analysis_scope;
  if (scope) {
    sectionTitle('SCOPE OF ANALYSIS');
    bodyText(
      'How your request was interpreted — confirm this matches your intent:'
    );
    bodyText(scope.interpretation || '');
    if (scope.derivedChecks?.length) {
      subTitle('Checks performed:');
      for (const c of scope.derivedChecks) bullet(c);
    }
    if (scope.assumptions?.length) {
      subTitle('Assumptions made (verify):');
      for (const a of scope.assumptions) bullet(a);
    }
    y += 5;
  }

  // ── User-Requested Checks ─────────────────────────────────────────────

  const userChecks = report.user_requested_checks;
  if (userChecks?.length) {
    sectionTitle('USER-REQUESTED CHECKS');

    for (let i = 0; i < userChecks.length; i++) {
      const check = userChecks[i];
      checkPageBreak(30);

      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(`${i + 1}. ${sanitize(check.requestedBy)}`, margin, y);

      // Finding badge
      const findingColor: [number, number, number] =
        check.finding === 'consistent'
          ? COLORS.lightGreen
          : check.finding === 'inconsistent'
            ? COLORS.lightRed
            : [255, 236, 153];
      const badgeX = pageWidth - margin - 28;
      doc.setFillColor(...findingColor);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.black);
      doc.rect(badgeX, y - 4, 28, 6, 'F');
      doc.text(check.finding, badgeX + 14, y, { align: 'center' });
      y += 7;

      doc.setFont('helvetica', 'normal');
      bodyText(check.description);
      if (check.documentsInvolved?.length) {
        bodyText(`Documents: ${check.documentsInvolved.join(', ')}`);
      }
      y += 3;
    }
  }

  // ── 3. Cross-Document Discrepancies ───────────────────────────────────

  const discrepancies = report.cross_document_discrepancies;
  if (discrepancies?.length) {
    const sec4Title = report.familyCrossReference
      ? '3. WITHIN-MEMBER CROSS-DOCUMENT DISCREPANCIES'
      : '3. CROSS-DOCUMENT DISCREPANCIES';
    sectionTitle(sec4Title);
    if (report.familyCrossReference) {
      bodyText(
        "These discrepancies are within a single family member's own documents. Cross-member discrepancies are in Section 5 (Family Cross-Reference).",
        3
      );
      y += 2;
    }

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

  // ── 4. Family Cross-Reference ─────────────────────────────────────────

  const fc = report.familyCrossReference;
  if (fc) {
    sectionTitle('4. FAMILY CROSS-REFERENCE');
    bodyText(fc.summary || '');
    y += 3;

    // Family members
    if (fc.familyMembers?.length) {
      subTitle('Family Members:');
      for (const m of fc.familyMembers) {
        const docs = m.assignedDocuments?.join(', ') || 'none assigned';
        bullet(`${m.name}${m.role ? ` (${m.role})` : ''}: ${docs}`);
      }
      y += 3;
    }

    // Relationships table — only render rows that actually name a relationship
    // (an empty/garbled relationship would otherwise show as a blank grey row).
    const relRows = (fc.inferredRelationships ?? [])
      .map(r => {
        const fromName =
          fc.familyMembers?.find(m => m.id === r.fromId)?.name ?? r.fromId;
        const toName =
          fc.familyMembers?.find(m => m.id === r.toId)?.name ?? r.toId;
        return [
          sanitize(fromName),
          sanitize(r.relationshipType),
          sanitize(toName),
          sanitize(r.confidence),
        ];
      })
      .filter(row => row[0] && row[1] && row[2]);
    if (relRows.length) {
      subTitle('Relationships:');
      autoTable(doc, {
        startY: y,
        head: [['Member', 'Is', 'Related To', 'Confidence']],
        body: relRows,
        margin: { left: margin, right: margin },
        styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
        headStyles: { fillColor: COLORS.navy, textColor: COLORS.white },
      });
      y = doc.lastAutoTable.finalY + 6;
    }

    // Shared field comparisons table
    if (fc.sharedFieldComparisons?.some(c => c.values?.length)) {
      subTitle('Shared Field Comparisons:');
      autoTable(doc, {
        startY: y,
        head: [['Field', 'Member', 'Value', 'Consistent']],
        body: fc.sharedFieldComparisons.flatMap(cmp =>
          cmp.values.map((v, vi) => [
            vi === 0 ? sanitize(cmp.field) : '',
            sanitize(v.memberName),
            sanitize(v.value).slice(0, 40),
            vi === 0 ? (cmp.isConsistent ? 'Yes' : 'No') : '',
          ])
        ),
        margin: { left: margin, right: margin },
        styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
        headStyles: { fillColor: COLORS.navy, textColor: COLORS.white },
        didParseCell: data => {
          if (data.section === 'body' && data.column.index === 3) {
            const val = data.cell.raw as string;
            if (val === 'Yes') data.cell.styles.fillColor = COLORS.lightGreen;
            else if (val === 'No') data.cell.styles.fillColor = COLORS.lightRed;
          }
        },
      });
      y = doc.lastAutoTable.finalY + 6;
    }

    // Cross-person discrepancies (pre-sorted most-important-first; no severity label)
    if (fc.crossPersonDiscrepancies?.length) {
      subTitle('Cross-Person Discrepancies:');
      for (const d of fc.crossPersonDiscrepancies) {
        checkPageBreak(20);
        const affected = (d.affectedMemberIds ?? [])
          .map(id => fc.familyMembers?.find(m => m.id === id)?.name ?? id)
          .join(' x ');
        doc.setFont('helvetica', 'bold');
        bodyText(d.discrepancy_type, 3);
        doc.setFont('helvetica', 'normal');
        bodyText(d.description, 6);
        if (affected) bodyText(`Affects: ${affected}`, 6);
        if (d.documents_involved?.length) {
          bodyText(`Documents: ${d.documents_involved.join(', ')}`, 6);
        }
        if (d.recommendation)
          bodyText(`Recommendation: ${d.recommendation}`, 6);
        y += 2;
      }
      y += 3;
    }

    // Unattributed documents — still analyzed, just not tied to a member.
    if (fc.unassignedDocuments?.length) {
      subTitle('Unattributed Documents (still analyzed):');
      bodyText(fc.unassignedDocuments.join(', '), 3);
      y += 3;
    }
    y += 5;
  }

  // ── 5. Timeline & Chronology ──────────────────────────────────────────

  const timeline = report.timeline;
  if (
    timeline &&
    (timeline.events.length > 0 || timeline.contradictions.length > 0)
  ) {
    sectionTitle('5. TIMELINE & CHRONOLOGY');
    if (timeline.summary) bodyText(timeline.summary);
    if (timeline.contradictions.length > 0) {
      subTitle('Chronological issues:');
      for (const c of timeline.contradictions) {
        bodyText(c.description, 3);
        if (c.documents_involved?.length) {
          bodyText(`Documents: ${c.documents_involved.join(', ')}`, 6);
        }
        y += 1;
      }
      y += 2;
    }
    if (timeline.events.length > 0) {
      subTitle('Events:');
      for (const e of timeline.events) {
        const who = e.memberName ? ` (${e.memberName})` : '';
        bullet(`${e.date || '—'} — ${e.label}${who} [${e.document}]`);
      }
      y += 3;
    }
    y += 3;
  }

  // ── Disclaimer ────────────────────────────────────────────────────────

  // Start the disclaimer on the current page if it fits; only break to a new
  // page when there isn't room. An unconditional addPage() here produced a
  // stray blank page when the prior section already ended near a page boundary.
  checkPageBreak(60);
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
