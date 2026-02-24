'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  FileText,
  Download,
  X,
  AlertTriangle,
  CheckCircle,
  Info,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { AnalysisReport } from '@/types';
import { exportReportAsPdf } from '@/lib/pdf-export';

interface ReportViewerProps {
  report: AnalysisReport;
  clientName: string;
  onClose: () => void;
}

export const ReportViewer = ({
  report,
  clientName,
  onClose,
}: ReportViewerProps) => {
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({
    executive: true,
    concordance: true,
    documents: false,
    discrepancies: true,
    translation: false,
    actions: true,
  });

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleDownloadPdf = () => {
    exportReportAsPdf(report, clientName);
  };

  const handleDownloadJson = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${clientName.replace(/\s+/g, '_')}_report.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exec = report.executive_summary;
  const assessmentColor =
    exec.overall_assessment === 'CLEAR'
      ? 'bg-green-100 text-green-800 border-green-200'
      : exec.overall_assessment === 'MINOR CONCERNS'
        ? 'bg-yellow-100 text-yellow-800 border-yellow-200'
        : 'bg-red-100 text-red-800 border-red-200';

  const SectionHeader = ({
    sectionKey,
    title,
    icon,
  }: {
    sectionKey: string;
    title: string;
    icon: React.ReactNode;
  }) => (
    <button
      onClick={() => toggleSection(sectionKey)}
      className="flex items-center space-x-2 w-full text-left py-2 hover:text-primary transition-colors"
    >
      {expandedSections[sectionKey] ? (
        <ChevronDown className="h-4 w-4" />
      ) : (
        <ChevronRight className="h-4 w-4" />
      )}
      {icon}
      <span className="font-semibold text-sm">{title}</span>
    </button>
  );

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent
        className="!w-[85vw] !max-w-[85vw] !h-[90vh] !max-h-[90vh] p-0 flex flex-col"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Analysis Report</DialogTitle>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-muted/30">
          <div className="flex items-center space-x-3">
            <FileText className="h-5 w-5 text-primary" />
            <div>
              <h2 className="font-semibold">Analysis Report</h2>
              <p className="text-xs text-muted-foreground">
                {clientName} &middot;{' '}
                {report.report_metadata?.generated_at
                  ? new Date(
                      report.report_metadata.generated_at
                    ).toLocaleDateString()
                  : 'Just now'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" onClick={handleDownloadJson}>
              <Download className="h-4 w-4 mr-1" />
              JSON
            </Button>
            <Button size="sm" onClick={handleDownloadPdf}>
              <Download className="h-4 w-4 mr-1" />
              PDF
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0 ml-2"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 space-y-6">
          {/* ── 1. Executive Summary ── */}
          <Card>
            <CardHeader className="pb-2">
              <SectionHeader
                sectionKey="executive"
                title="1. Executive Summary"
                icon={<Info className="h-4 w-4" />}
              />
            </CardHeader>
            {expandedSections.executive && (
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-3">
                  <span className="text-sm font-medium">
                    Overall Assessment:
                  </span>
                  <Badge variant="outline" className={assessmentColor}>
                    {exec.overall_assessment === 'CLEAR' && (
                      <CheckCircle className="h-3 w-3 mr-1" />
                    )}
                    {exec.overall_assessment === 'REQUIRES ATTENTION' && (
                      <AlertTriangle className="h-3 w-3 mr-1" />
                    )}
                    {exec.overall_assessment}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">
                      Documents Analyzed:{' '}
                    </span>
                    <strong>{exec.documents_analyzed}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      Document Types:{' '}
                    </span>
                    <strong>{exec.document_types?.join(', ')}</strong>
                  </div>
                </div>

                <p className="text-sm">{exec.overview}</p>

                {exec.key_findings?.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Key Findings:</h4>
                    <ul className="space-y-1">
                      {exec.key_findings.map((f, i) => (
                        <li
                          key={i}
                          className="text-sm text-muted-foreground flex items-start space-x-2"
                        >
                          <span className="text-primary mt-1">•</span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          {/* ── 2. Personal Info Concordance ── */}
          {report.personal_info_concordance && (
            <Card>
              <CardHeader className="pb-2">
                <SectionHeader
                  sectionKey="concordance"
                  title="2. Personal Information Concordance"
                  icon={<FileText className="h-4 w-4" />}
                />
              </CardHeader>
              {expandedSections.concordance && (
                <CardContent className="space-y-4">
                  <p className="text-sm">
                    {report.personal_info_concordance.consistency_summary}
                  </p>

                  {report.personal_info_concordance.comparison_table?.length >
                    0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr className="bg-muted/50">
                            <th className="text-left p-2 border font-medium">
                              Field
                            </th>
                            {report.personal_info_concordance.comparison_table[0]?.values_by_document?.map(
                              (v, i) => (
                                <th
                                  key={i}
                                  className="text-left p-2 border font-medium"
                                >
                                  {v.document
                                    ? v.document
                                        .split('/')
                                        .pop()
                                        ?.split('\\')
                                        .pop()
                                    : `Doc ${i + 1}`}
                                </th>
                              )
                            )}
                            <th className="text-center p-2 border font-medium">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.personal_info_concordance.comparison_table.map(
                            (row, ri) => (
                              <tr key={ri} className="hover:bg-muted/20">
                                <td className="p-2 border font-medium">
                                  {row.field}
                                </td>
                                {row.values_by_document?.map((v, vi) => (
                                  <td key={vi} className="p-2 border">
                                    <div>{v.translated || v.original}</div>
                                    {v.translated &&
                                      v.original !== v.translated && (
                                        <div className="text-xs text-muted-foreground italic">
                                          ({v.original})
                                        </div>
                                      )}
                                  </td>
                                ))}
                                <td className="p-2 border text-center">
                                  <Badge
                                    variant="outline"
                                    className={
                                      row.is_consistent
                                        ? 'bg-green-100 text-green-800 border-green-200'
                                        : 'bg-red-100 text-red-800 border-red-200'
                                    }
                                  >
                                    {row.is_consistent ? 'Match' : 'Mismatch'}
                                  </Badge>
                                </td>
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          )}

          {/* ── 3. Document Analysis ── */}
          {report.document_analysis?.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <SectionHeader
                  sectionKey="documents"
                  title="3. Document-by-Document Analysis"
                  icon={<FileText className="h-4 w-4" />}
                />
              </CardHeader>
              {expandedSections.documents && (
                <CardContent className="space-y-4">
                  {report.document_analysis.map((da, i) => (
                    <div key={i} className="border rounded-lg p-4 space-y-2">
                      <h4 className="font-medium text-sm">
                        {da.document_name}
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
                        <div>
                          Type:{' '}
                          <span className="text-foreground">
                            {da.document_type}
                          </span>
                        </div>
                        <div>
                          Authority:{' '}
                          <span className="text-foreground">
                            {da.issuing_authority || 'N/A'}
                          </span>
                        </div>
                        <div>
                          Issued:{' '}
                          <span className="text-foreground">
                            {da.issue_date || 'N/A'}
                          </span>
                        </div>
                        <div>
                          Legibility:{' '}
                          <span className="text-foreground">
                            {da.legibility_assessment || 'N/A'}
                          </span>
                        </div>
                      </div>
                      {da.translation_notes && (
                        <p className="text-xs italic text-muted-foreground">
                          Translation: {da.translation_notes}
                        </p>
                      )}
                      {da.flags?.length > 0 && (
                        <div className="space-y-1">
                          {da.flags.map((flag, fi) => (
                            <div
                              key={fi}
                              className="flex items-start space-x-2 text-xs text-red-700"
                            >
                              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                              <span>{flag}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          )}

          {/* ── 4. Cross-Document Discrepancies ── */}
          {report.cross_document_discrepancies?.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <SectionHeader
                  sectionKey="discrepancies"
                  title="4. Cross-Document Discrepancies"
                  icon={<AlertTriangle className="h-4 w-4" />}
                />
              </CardHeader>
              {expandedSections.discrepancies && (
                <CardContent className="space-y-3">
                  {report.cross_document_discrepancies.map((disc, i) => (
                    <div key={i} className="border rounded-lg p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium text-sm">
                          #{i + 1}: {disc.discrepancy_type}
                        </h4>
                        <Badge
                          variant="outline"
                          className={
                            disc.severity === 'High'
                              ? 'bg-red-100 text-red-800 border-red-200'
                              : disc.severity === 'Medium'
                                ? 'bg-yellow-100 text-yellow-800 border-yellow-200'
                                : 'bg-green-100 text-green-800 border-green-200'
                          }
                        >
                          {disc.severity}
                        </Badge>
                      </div>
                      <p className="text-sm">{disc.description}</p>
                      {disc.documents_involved?.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Documents: {disc.documents_involved.join(', ')}
                        </p>
                      )}
                      {disc.original_values?.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Values: {disc.original_values.join(' vs ')}
                        </p>
                      )}
                      <p className="text-xs italic">
                        Recommendation: {disc.recommendation}
                      </p>
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          )}

          {/* ── 5. Translation Notes ── */}
          {report.translation_notes && (
            <Card>
              <CardHeader className="pb-2">
                <SectionHeader
                  sectionKey="translation"
                  title="5. Translation Accuracy Notes"
                  icon={<Info className="h-4 w-4" />}
                />
              </CardHeader>
              {expandedSections.translation && (
                <CardContent className="space-y-3">
                  <p className="text-sm">
                    Confidence:{' '}
                    <strong>
                      {report.translation_notes
                        .overall_translation_confidence || 'N/A'}
                    </strong>
                  </p>

                  {report.translation_notes.ambiguous_terms?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium mb-1">
                        Ambiguous Terms
                      </h4>
                      {report.translation_notes.ambiguous_terms.map((t, i) => (
                        <p key={i} className="text-xs text-muted-foreground">
                          <strong>{t.term}</strong>:{' '}
                          {t.possible_translations?.join(', ')}
                        </p>
                      ))}
                    </div>
                  )}

                  {report.translation_notes.cultural_legal_terms?.length >
                    0 && (
                    <div>
                      <h4 className="text-sm font-medium mb-1">
                        Cultural/Legal Terms
                      </h4>
                      {report.translation_notes.cultural_legal_terms.map(
                        (t, i) => (
                          <p key={i} className="text-xs text-muted-foreground">
                            <strong>{t.term}</strong>: {t.explanation}
                          </p>
                        )
                      )}
                    </div>
                  )}

                  {report.translation_notes.uncertain_readings?.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium mb-1">
                        Uncertain Readings
                      </h4>
                      <ul className="list-disc list-inside">
                        {report.translation_notes.uncertain_readings.map(
                          (r, i) => (
                            <li
                              key={i}
                              className="text-xs text-muted-foreground"
                            >
                              {r}
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          )}

          {/* ── 6. Action Items ── */}
          {report.action_items?.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <SectionHeader
                  sectionKey="actions"
                  title="6. Action Items"
                  icon={<CheckCircle className="h-4 w-4" />}
                />
              </CardHeader>
              {expandedSections.actions && (
                <CardContent className="space-y-3">
                  {(['High', 'Medium', 'Low'] as const).map(priority => {
                    const items = report.action_items.filter(
                      a => a.priority === priority
                    );
                    if (!items.length) return null;
                    return (
                      <div key={priority}>
                        <h4 className="text-sm font-medium mb-2">
                          {priority} Priority
                        </h4>
                        {items.map((item, i) => (
                          <div
                            key={i}
                            className="flex items-start space-x-2 text-sm mb-2"
                          >
                            <Badge
                              variant="outline"
                              className={
                                priority === 'High'
                                  ? 'bg-red-100 text-red-800 border-red-200 shrink-0'
                                  : priority === 'Medium'
                                    ? 'bg-yellow-100 text-yellow-800 border-yellow-200 shrink-0'
                                    : 'bg-green-100 text-green-800 border-green-200 shrink-0'
                              }
                            >
                              {item.category}
                            </Badge>
                            <div>
                              <p>{item.action}</p>
                              {item.reason && (
                                <p className="text-xs text-muted-foreground italic">
                                  {item.reason}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </CardContent>
              )}
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
