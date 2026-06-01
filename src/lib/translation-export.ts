/**
 * Translation export utilities.
 * Provides functions to export translations in various formats (TXT, DOCX, JSON, CSV, PDF).
 */

import { TranslationResult, FileInfo, OCRResult } from '@/types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Document, Packer, Paragraph, HeadingLevel } from 'docx';
import JSZip from 'jszip';

// Extend jsPDF type for autoTable
declare module 'jspdf' {
  interface jsPDF {
    lastAutoTable: { finalY: number };
  }
}

const COLORS = {
  navy: [0, 51, 102] as [number, number, number],
  dark: [51, 51, 51] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  black: [0, 0, 0] as [number, number, number],
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

function safeFileName(fileName: string): string {
  return fileName.replace(/[^a-z0-9]/gi, '_');
}

function triggerDownload(blob: Blob, downloadName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName;
  a.click();
  URL.revokeObjectURL(url);
}

function buildOcrText(analysis: OCRResult, fileName: string): string {
  const lines: string[] = [];
  lines.push(
    `${fileName} | ${analysis.document_language.toUpperCase()} | ${analysis.document_type}`
  );
  lines.push('');

  if (analysis.illegibility?.detected) {
    lines.push('=== LEGIBILITY NOTE ===');
    lines.push(
      `Confidence: ${analysis.illegibility.confidence}${analysis.illegibility.reason ? ` | ${analysis.illegibility.reason}` : ''}`
    );
    lines.push('');
  }

  if ((analysis.structured_data?.fields?.length ?? 0) > 0) {
    lines.push('=== EXTRACTED FIELDS ===');
    for (const field of analysis.structured_data.fields) {
      lines.push(`${field.key}: ${field.value}`);
    }
    lines.push('');
  }

  lines.push('=== OCR TEXT ===');
  lines.push(analysis.text || '');
  return lines.join('\n');
}

function buildOcrDocxChildren(
  header: string,
  analysis: OCRResult
): Paragraph[] {
  const fieldParagraphs = (analysis.structured_data?.fields ?? []).flatMap(
    field => [new Paragraph({ text: `${field.key}: ${field.value}` })]
  );

  return [
    new Paragraph({ text: header, heading: HeadingLevel.HEADING_3 }),
    new Paragraph({}),
    ...(analysis.illegibility?.detected
      ? [
          new Paragraph({
            text: 'Legibility Note',
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            text: `Confidence: ${analysis.illegibility.confidence}${analysis.illegibility.reason ? ` | ${analysis.illegibility.reason}` : ''}`,
          }),
          new Paragraph({}),
        ]
      : []),
    ...(fieldParagraphs.length > 0
      ? [
          new Paragraph({
            text: 'Extracted Fields',
            heading: HeadingLevel.HEADING_2,
          }),
          ...fieldParagraphs,
          new Paragraph({}),
        ]
      : []),
    new Paragraph({ text: 'OCR Text', heading: HeadingLevel.HEADING_2 }),
    ...(analysis.text || '').split('\n').map(line => new Paragraph({ text: line })),
  ];
}

export function exportOcrAsText(analysis: OCRResult, fileName: string): void {
  const blob = new Blob([buildOcrText(analysis, fileName)], {
    type: 'text/plain',
  });
  triggerDownload(blob, `${safeFileName(fileName)}_ocr.txt`);
}

export async function exportOcrAsDocx(
  analysis: OCRResult,
  fileName: string
): Promise<void> {
  const header = `${fileName} | ${analysis.document_language.toUpperCase()} | ${analysis.document_type}`;
  const doc = new Document({
    sections: [
      {
        children: buildOcrDocxChildren(header, analysis),
      },
    ],
  });

  const docxBlob = await Packer.toBlob(doc);
  triggerDownload(docxBlob, `${safeFileName(fileName)}_ocr.docx`);
}

export function exportAllOcrAsText(
  files: FileInfo[],
  clientName: string = 'Client'
): void {
  const analyzedFiles = files.filter(f => f.analysis);
  if (!analyzedFiles.length) {
    console.warn('No OCR results to export');
    return;
  }

  const combined = analyzedFiles
    .map((file, index) => {
      const content = buildOcrText(file.analysis!, file.name);
      if (index === analyzedFiles.length - 1) return content;
      return `${content}\n\n---\n`;
    })
    .join('\n');

  const blob = new Blob([combined], { type: 'text/plain' });
  triggerDownload(blob, `${clientName.replace(/\s+/g, '_')}_ocr.txt`);
}

export async function exportAllOcrAsDocx(
  files: FileInfo[],
  clientName: string = 'Client'
): Promise<void> {
  const analyzedFiles = files.filter(f => f.analysis);
  if (!analyzedFiles.length) {
    console.warn('No OCR results to export');
    return;
  }

  if (analyzedFiles.length === 1) {
    const file = analyzedFiles[0];
    await exportOcrAsDocx(file.analysis!, file.name);
    return;
  }

  const zip = new JSZip();

  for (const file of analyzedFiles) {
    const analysis = file.analysis!;
    const header = `${file.name} | ${analysis.document_language.toUpperCase()} | ${analysis.document_type}`;
    const doc = new Document({
      sections: [
        {
          children: buildOcrDocxChildren(header, analysis),
        },
      ],
    });

    const docxBlob = await Packer.toBlob(doc);
    zip.file(`${safeFileName(file.name)}_ocr.docx`, docxBlob);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(zipBlob, `${clientName.replace(/\s+/g, '_')}_ocr.zip`);
}

/** Export a single translation as plain text (two-block format with minimal header) */
export function exportTranslationAsText(
  translation: TranslationResult,
  fileName: string
): void {
  const lines: string[] = [];
  lines.push(
    `${fileName} | ${translation.original_language.toUpperCase()} \u2192 ${translation.target_language.toUpperCase()}`
  );
  lines.push('');
  lines.push('=== ORIGINAL TEXT ===');
  lines.push(translation.original_text);
  lines.push('');
  lines.push('=== TRANSLATED TEXT ===');
  lines.push(translation.translated_text);

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  triggerDownload(blob, `${safeFileName(fileName)}_translation.txt`);
}

/** Export a single translation as PDF */
export function exportTranslationAsPdf(
  translation: TranslationResult,
  fileName: string
): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 15;
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - margin * 2;
  let y = 20;

  const checkPageBreak = (needed: number) => {
    if (y + needed > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      y = 20;
    }
  };

  // Header
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.navy);
  doc.text('Translation Report', margin, y);
  y += 10;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.black);
  doc.text(`Document: ${sanitize(fileName)}`, margin, y);
  y += 6;
  doc.text(
    `${translation.original_language.toUpperCase()} → ${translation.target_language.toUpperCase()}`,
    margin,
    y
  );
  y += 12;

  // Original text section
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.navy);
  doc.text('Original Text', margin, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.black);
  const originalLines = doc.splitTextToSize(
    sanitize(translation.original_text),
    contentWidth
  );
  checkPageBreak(originalLines.length * 5 + 10);
  doc.text(originalLines, margin, y);
  y += originalLines.length * 5 + 10;

  // Translated text section
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.navy);
  doc.text('Translated Text', margin, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.black);
  const translatedLines = doc.splitTextToSize(
    sanitize(translation.translated_text),
    contentWidth
  );
  checkPageBreak(translatedLines.length * 5 + 10);
  doc.text(translatedLines, margin, y);
  y += translatedLines.length * 5 + 10;

  // Structured data if available
  if (translation.structured_data?.original_fields.length) {
    checkPageBreak(60);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.navy);
    doc.text('Structured Data', margin, y);
    y += 10;

    const tableData: string[][] = [
      ['Field', 'Original Value', 'Translated Value'],
    ];

    for (let i = 0; i < translation.structured_data.original_fields.length; i++) {
      const origField = translation.structured_data.original_fields[i];
      const transField = translation.structured_data.translated_fields[i];
      tableData.push([
        sanitize(origField.key),
        sanitize(origField.value),
        sanitize(transField?.value || ''),
      ]);
    }

    autoTable(doc, {
      head: [tableData[0]],
      body: tableData.slice(1),
      startY: y,
      margin: margin,
      columnStyles: {
        0: { halign: 'left', cellWidth: 50 },
        1: { halign: 'left', cellWidth: 70 },
        2: { halign: 'left', cellWidth: 70 },
      },
      headStyles: {
        fillColor: COLORS.navy,
        textColor: COLORS.white,
        fontStyle: 'bold',
      },
    });
  }

  doc.save(`${fileName.replace(/[^a-z0-9]/gi, '_')}_translation.pdf`);
}

/** Export as JSON */
export function exportTranslationAsJson(
  translation: TranslationResult,
  fileName: string
): void {
  const blob = new Blob([JSON.stringify(translation, null, 2)], {
    type: 'application/json',
  });
  triggerDownload(blob, `${safeFileName(fileName)}_translation.json`);
}

/** Export multiple translations as a combined JSON file */
export function exportAllTranslationsAsJson(
  files: FileInfo[],
  clientName: string = 'Client'
): void {
  const translatedFiles = files.filter(f => f.translation);
  if (!translatedFiles.length) {
    console.warn('No translations to export');
    return;
  }

  const exportData = {
    clientName,
    exportDate: new Date().toISOString(),
    totalTranslations: translatedFiles.length,
    translations: translatedFiles.map(f => ({
      fileName: f.name,
      data: f.translation,
    })),
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: 'application/json',
  });
  triggerDownload(blob, `${clientName.replace(/\s+/g, '_')}_translations.json`);
}

/** Export multiple translations as CSV */
export function exportAllTranslationsAsCsv(
  files: FileInfo[],
  clientName: string = 'Client'
): void {
  const translatedFiles = files.filter(f => f.translation);
  if (!translatedFiles.length) {
    console.warn('No translations to export');
    return;
  }

  const rows: string[] = [];
  rows.push(
    'File Name,Original Language,Target Language,Original Text,Translated Text'
  );

  for (const file of translatedFiles) {
    if (file.translation) {
      const t = file.translation;
      const escapeCsv = (str: string) =>
        `"${str.replace(/"/g, '""').replace(/\n/g, ' ')}"`;

      rows.push(
        [
          escapeCsv(file.name),
          t.original_language,
          t.target_language,
          escapeCsv(t.original_text),
          escapeCsv(t.translated_text),
        ].join(',')
      );
    }
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  triggerDownload(blob, `${clientName.replace(/\s+/g, '_')}_translations.csv`);
}

/** Export multiple translations in a single TXT file */
export function exportAllTranslationsAsText(
  files: FileInfo[],
  clientName: string = 'Client'
): void {
  const translatedFiles = files.filter(f => f.translation);
  if (!translatedFiles.length) {
    console.warn('No translations to export');
    return;
  }

  const lines: string[] = [];

  for (let i = 0; i < translatedFiles.length; i++) {
    const file = translatedFiles[i];
    const t = file.translation!;
    lines.push(
      `${file.name} | ${t.original_language.toUpperCase()} -> ${t.target_language.toUpperCase()}`
    );
    lines.push('');
    lines.push('=== ORIGINAL TEXT ===');
    lines.push(t.original_text);
    lines.push('');
    lines.push('=== TRANSLATED TEXT ===');
    lines.push(t.translated_text);

    if (i < translatedFiles.length - 1) {
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  triggerDownload(blob, `${clientName.replace(/\s+/g, '_')}_translations.txt`);
}

/** Build the children array for a translation DOCX section */
function buildDocxChildren(
  header: string,
  originalText: string,
  translatedText: string
): Paragraph[] {
  return [
    new Paragraph({ text: header, heading: HeadingLevel.HEADING_3 }),
    new Paragraph({}),
    new Paragraph({ text: 'Original Text', heading: HeadingLevel.HEADING_2 }),
    ...originalText.split('\n').map(line => new Paragraph({ text: line })),
    new Paragraph({}),
    new Paragraph({ text: 'Translated Text', heading: HeadingLevel.HEADING_2 }),
    ...translatedText.split('\n').map(line => new Paragraph({ text: line })),
  ];
}

/** Export a single translation as a Word document (.docx) */
export async function exportTranslationAsDocx(
  translation: TranslationResult,
  fileName: string
): Promise<void> {
  const header = `${fileName} | ${translation.original_language.toUpperCase()} \u2192 ${translation.target_language.toUpperCase()}`;

  const doc = new Document({
    sections: [
      {
        children: buildDocxChildren(
          header,
          translation.original_text,
          translation.translated_text
        ),
      },
    ],
  });

  const docxBlob = await Packer.toBlob(doc);
  triggerDownload(docxBlob, `${safeFileName(fileName)}_translation.docx`);
}

/** Export multiple translations as individual .docx files bundled in a .zip */
export async function exportAllTranslationsAsDocx(
  files: FileInfo[],
  clientName: string = 'Client'
): Promise<void> {
  const translatedFiles = files.filter(f => f.translation);
  if (!translatedFiles.length) {
    console.warn('No translations to export');
    return;
  }

  if (translatedFiles.length === 1) {
    const file = translatedFiles[0];
    const t = file.translation!;
    const header = `${file.name} | ${t.original_language.toUpperCase()} \u2192 ${t.target_language.toUpperCase()}`;

    const doc = new Document({
      sections: [
        {
          children: buildDocxChildren(header, t.original_text, t.translated_text),
        },
      ],
    });

    const docxBlob = await Packer.toBlob(doc);
    triggerDownload(docxBlob, `${safeFileName(file.name)}_translation.docx`);
    return;
  }

  const zip = new JSZip();

  for (const file of translatedFiles) {
    const t = file.translation!;
    const header = `${file.name} | ${t.original_language.toUpperCase()} \u2192 ${t.target_language.toUpperCase()}`;

    const doc = new Document({
      sections: [
        {
          children: buildDocxChildren(header, t.original_text, t.translated_text),
        },
      ],
    });

    const docxBlob = await Packer.toBlob(doc);
    const safeName = safeFileName(file.name);
    zip.file(`${safeName}_translation.docx`, docxBlob);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(zipBlob, `${clientName.replace(/\s+/g, '_')}_translations.zip`);
}
