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
  Eye,
  Clock,
} from 'lucide-react';
import type { AnalysisReport, FamilyCrossReferenceSection } from '@/types';
import { exportReportAsPdf } from '@/lib/pdf-export';
import { getMemberColorClasses } from '@/lib/utils';
import { FamilyTree } from '@/components/FamilyTree';

interface ReportViewerProps {
  report: AnalysisReport;
  clientName: string;
  onClose: () => void;
  onViewSource?: (documentName: string) => void;
}

export const ReportViewer = ({
  report,
  clientName,
  onClose,
  onViewSource,
}: ReportViewerProps) => {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    perDocument: true,
    discrepancies: true,
    userChecks: true,
    family: true,
    timeline: true,
    concordance: true,
  });

  const ViewSource = ({ doc }: { doc: string }) =>
    onViewSource && doc ? (
      <button
        type="button"
        onClick={() => onViewSource(doc)}
        title={`View source: ${doc}`}
        className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline align-middle"
      >
        <Eye className="h-3 w-3" />
        source
      </button>
    ) : null;

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

  const comparisonTable = report.personal_info_concordance?.comparison_table ?? [];
  const allDocs: string[] = Array.from(
    new Set(comparisonTable.flatMap(row => (row.values_by_document ?? []).map(v => v.document)))
  );

  const SectionHeader = ({
    sectionKey,
    title,
    description,
    icon,
  }: {
    sectionKey: string;
    title: string;
    description?: string;
    icon: React.ReactNode;
  }) => (
    <div>
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
      {description && <p className="text-xs text-muted-foreground pl-6 pb-1">{description}</p>}
    </div>
  );

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent
        className="!w-[85vw] !max-w-[85vw] !h-[90vh] !max-h-[90vh] p-0 flex flex-col"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Analysis Report</DialogTitle>

        <div className="flex items-center justify-between p-4 border-b bg-muted/30">
          <div className="flex items-center space-x-3">
            <FileText className="h-5 w-5 text-primary" />
            <div>
              <h2 className="font-semibold">Analysis Report</h2>
              <p className="text-xs text-muted-foreground">
                {clientName} &middot;{' '}
                {report.report_metadata?.generated_at
                  ? new Date(report.report_metadata.generated_at).toLocaleDateString()
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
            <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0 ml-2">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-6">
          {(report.analysis_warnings?.length ?? 0) > 0 && (
            <div className="flex items-start space-x-2 text-sm text-red-800 bg-red-50 border border-red-300 rounded-lg p-3">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Analysis incomplete — verify manually</p>
                <ul className="mt-1 space-y-0.5 list-disc pl-5">
                  {report.analysis_warnings!.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {(report.report_metadata?.excluded_documents?.length ?? 0) > 0 && (
            <div className="flex items-start space-x-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">
                  {report.report_metadata.excluded_documents!.length} document
                  {report.report_metadata.excluded_documents!.length > 1 ? 's were' : ' was'} excluded from this report due to illegibility
                </p>
                <ul className="mt-1 space-y-0.5">
                  {report.report_metadata.excluded_documents!.map((d, i) => (
                    <li key={i} className="text-xs text-amber-700">
                      <strong>{d.name}</strong> — {d.reason}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {report.per_document_discrepancies?.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <SectionHeader
                  sectionKey="perDocument"
                  title="1. Per-Document Discrepancies"
                  description="Issues found within each individual document — internal inconsistencies, impossible dates, missing required fields, and legibility problems."
                  icon={<AlertTriangle className="h-4 w-4" />}
                />
              </CardHeader>
              {expandedSections.perDocument && (
                <CardContent className="space-y-4">
                  {(() => {
                    const docToMember = new Map<string, { name: string; color: string }>();
                    report.familyCrossReference?.familyMembers?.forEach(m => {
                      (m.assignedDocuments ?? []).forEach(d => {
                        docToMember.set(d, { name: m.name, color: m.color ?? 'blue' });
                      });
                    });
                    return report.per_document_discrepancies.map((docDisc, i) => {
                      const hasDiscrepancies = docDisc.discrepancies?.length > 0;
                      const statusColor = hasDiscrepancies
                        ? 'bg-red-100 text-red-800 border-red-200'
                        : 'bg-green-100 text-green-800 border-green-200';
                      const owner = docToMember.get(docDisc.document_name);
                      const ownerColors = owner
                        ? getMemberColorClasses(owner.color as Parameters<typeof getMemberColorClasses>[0])
                        : null;
                      return (
                        <div key={i} className="border rounded-lg p-4 space-y-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <h4 className="font-medium text-sm flex items-center gap-2">
                              {docDisc.document_name}
                              <ViewSource doc={docDisc.document_name} />
                              {owner && ownerColors && (
                                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${ownerColors.bg} ${ownerColors.text} ${ownerColors.border}`}>
                                  <span className={`h-1.5 w-1.5 rounded-full ${ownerColors.dot}`} />
                                  {owner.name}
                                </span>
                              )}
                            </h4>
                            <Badge variant="outline" className={statusColor}>
                              {hasDiscrepancies ? 'Has discrepancies' : 'No material discrepancies'}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{docDisc.summary}</p>
                          {hasDiscrepancies && (
                            <div className="space-y-1">
                              {docDisc.discrepancies.map((item, fi) => (
                                <div key={fi} className="rounded border border-red-200 bg-red-50 p-2 space-y-1">
                                  <p className="text-xs font-medium text-red-800">{item.discrepancy_type}</p>
                                  <p className="text-xs text-red-700">{item.description}</p>
                                  {item.fields_involved && item.fields_involved.length > 0 && (
                                    <p className="text-[11px] text-muted-foreground">Fields: {item.fields_involved.join(', ')}</p>
                                  )}
                                  {item.original_values && item.original_values.length > 0 && (
                                    <p className="text-[11px] text-muted-foreground">Values: {item.original_values.join(' vs ')}</p>
                                  )}
                                  <p className="text-[11px] italic text-muted-foreground">Recommendation: {item.recommendation}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </CardContent>
              )}
            </Card>
          )}

          {report.analysis_scope && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Scope of Analysis</h3>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-xs text-muted-foreground">How your request was interpreted — confirm this matches your intent:</p>
                <p>{report.analysis_scope.interpretation}</p>
                {report.analysis_scope.derivedChecks.length > 0 && (
                  <div>
                    <p className="text-xs font-medium mb-1">Checks performed:</p>
                    <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
                      {report.analysis_scope.derivedChecks.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {report.analysis_scope.assumptions.length > 0 && (
                  <div className="rounded border border-amber-200 bg-amber-50 p-2">
                    <p className="text-xs font-medium text-amber-800 mb-1">Assumptions made — verify these:</p>
                    <ul className="list-disc pl-5 text-xs text-amber-700 space-y-0.5">
                      {report.analysis_scope.assumptions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {report.user_requested_checks && report.user_requested_checks.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <SectionHeader sectionKey="userChecks" title="User-Requested Checks" icon={<CheckCircle className="h-4 w-4" />} />
              </CardHeader>
              {expandedSections.userChecks && (
                <CardContent className="space-y-3">
                  {report.user_requested_checks.map((check, i) => (
                    <div key={i} className="border rounded-lg p-4 space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <h4 className="font-medium text-sm">{check.requestedBy}</h4>
                        <Badge
                          variant="outline"
                          className={
                            check.finding === 'consistent'
                              ? 'bg-green-100 text-green-800 border-green-200'
                              : check.finding === 'inconsistent'
                                ? 'bg-red-100 text-red-800 border-red-200'
                                : 'bg-amber-100 text-amber-800 border-amber-200'
                          }
                        >
                          {check.finding}
                        </Badge>
                      </div>
                      <p className="text-sm">{check.description}</p>
                      {check.documentsInvolved?.length > 0 && (
                        <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-1 gap-y-0.5">
                          <span>Documents:</span>
                          {check.documentsInvolved.map((d, di) => (
                            <span key={di} className="inline-flex items-center gap-0.5">
                              {d}
                              <ViewSource doc={d} />
                              {di < check.documentsInvolved.length - 1 ? ',' : ''}
                            </span>
                          ))}
                        </p>
                      )}
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          )}

          {report.cross_document_discrepancies?.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <SectionHeader
                  sectionKey="discrepancies"
                  title={
                    report.familyCrossReference
                      ? '2. Within-Member Cross-Document Discrepancies'
                      : '2. Cross-Document Discrepancies'
                  }
                  description={
                    report.familyCrossReference
                      ? 'Genuine conflicts between different documents belonging to the same person — e.g. an address that changes between two of their own documents.'
                      : 'Genuine conflicts when the same fact appears differently across two or more documents.'
                  }
                  icon={<AlertTriangle className="h-4 w-4" />}
                />
              </CardHeader>
              {expandedSections.discrepancies && (
                <CardContent className="space-y-3">
                  {report.familyCrossReference && (
                    <p className="text-xs text-muted-foreground italic">
                      These discrepancies are within a single family member&apos;s own documents. Cross-member discrepancies are in the Family Cross-Reference section below.
                    </p>
                  )}
                  {report.cross_document_discrepancies.map((disc, i) => (
                    <div key={i} className="border rounded-lg p-4 space-y-2">
                      <h4 className="font-medium text-sm">#{i + 1}: {disc.discrepancy_type}</h4>
                      <p className="text-sm">{disc.description}</p>
                      {disc.documents_involved?.length > 0 && (
                        <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-1 gap-y-0.5">
                          <span>Documents:</span>
                          {disc.documents_involved.map((d, di) => (
                            <span key={di} className="inline-flex items-center gap-0.5">
                              {d}
                              <ViewSource doc={d} />
                              {di < disc.documents_involved.length - 1 ? ',' : ''}
                            </span>
                          ))}
                        </p>
                      )}
                      {disc.original_values?.length > 0 && (
                        <p className="text-xs text-muted-foreground">Values: {disc.original_values.join(' vs ')}</p>
                      )}
                      <p className="text-xs italic">Recommendation: {disc.recommendation}</p>
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          )}

          {report.familyCrossReference && (() => {
            const fc: FamilyCrossReferenceSection = report.familyCrossReference!;
            return (
              <Card>
                <CardHeader className="pb-2">
                  <SectionHeader
                    sectionKey="family"
                    title="3. Family Cross-Reference"
                    description="Inferred family structure, document ownership, and cross-person shared-field checks (e.g. parents’ names that siblings should agree on)."
                    icon={<Info className="h-4 w-4" />}
                  />
                </CardHeader>
                {expandedSections.family && (
                  <CardContent className="space-y-5">
                    {fc.familyMembers && fc.familyMembers.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium mb-3">Family Structure</h4>
                        <FamilyTree members={fc.familyMembers} relationships={fc.inferredRelationships ?? []} />
                      </div>
                    )}

                    {fc.familyMembers && fc.familyMembers.some(m => m.assignedDocuments && m.assignedDocuments.length > 0) && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">Document Assignments</h4>
                        <div className="space-y-2">
                          {fc.familyMembers.map(m => {
                            const colors = getMemberColorClasses(m.color);
                            const docs = m.assignedDocuments ?? [];
                            return (
                              <div key={m.id} className="flex items-start gap-2 text-xs">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium border shrink-0 ${colors.bg} ${colors.text} ${colors.border}`}>
                                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${colors.dot}`} />
                                  {m.name}
                                </span>
                                <span className="text-muted-foreground pt-0.5">
                                  {docs.length > 0 ? docs.join(', ') : '(no documents assigned)'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {fc.unassignedDocuments && fc.unassignedDocuments.length > 0 && (
                      <div className="rounded border border-amber-200 bg-amber-50 p-2">
                        <h4 className="text-sm font-medium text-amber-800 mb-1">Unattributed documents</h4>
                        <p className="text-xs text-amber-700 mb-1">
                          These could not be tied to a specific family member. They receive per-document analysis and are cross-checked for duplicate document identifiers, but — because their owner is unknown — they are NOT included in the per-member concordance or the cross-member shared-field comparison. Assign them to a member and re-generate the report to include them fully.
                        </p>
                        <p className="text-xs text-amber-700">{fc.unassignedDocuments.join(', ')}</p>
                      </div>
                    )}

                    {fc.sharedFieldComparisons && fc.sharedFieldComparisons.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">Shared Field Comparisons</h4>
                        <table className="w-full text-xs border rounded overflow-hidden">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="text-left px-3 py-1.5">Field</th>
                              <th className="text-left px-3 py-1.5">Values by Member</th>
                              <th className="text-left px-3 py-1.5">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {fc.sharedFieldComparisons.map((cmp, i) => (
                              <tr key={i} className="border-t">
                                <td className="px-3 py-2 font-medium capitalize">{cmp.field}</td>
                                <td className="px-3 py-2">
                                  <div className="space-y-0.5">
                                    {cmp.values.map((v, j) => (
                                      <div key={j} className="flex items-center gap-1.5">
                                        <span className="text-muted-foreground">{v.memberName}:</span>
                                        <span>{v.value}</span>
                                      </div>
                                    ))}
                                  </div>
                                  {cmp.inconsistencyNote && (
                                    <p className="text-muted-foreground italic mt-0.5">{cmp.inconsistencyNote}</p>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  {cmp.isConsistent ? (
                                    <Badge variant="outline" className="bg-green-100 text-green-700 border-green-200 text-[10px] px-1.5 py-0">
                                      <CheckCircle className="h-3 w-3 mr-1" />
                                      Consistent
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="bg-red-100 text-red-700 border-red-200 text-[10px] px-1.5 py-0">
                                      <AlertTriangle className="h-3 w-3 mr-1" />
                                      Mismatch
                                    </Badge>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {fc.crossPersonDiscrepancies && fc.crossPersonDiscrepancies.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">Cross-Person Discrepancies</h4>
                        <div className="space-y-2">
                          {fc.crossPersonDiscrepancies.map((d, i) => {
                            const affectedNames = (d.affectedMemberIds ?? [])
                              .map(id => fc.familyMembers.find(m => m.id === id)?.name ?? id)
                              .join(' × ');
                            return (
                              <div key={i} className="p-3 rounded-lg border text-sm">
                                <p className="font-medium mb-1">{d.discrepancy_type}</p>
                                <p className="text-xs text-muted-foreground mb-1">{d.description}</p>
                                {affectedNames && <p className="text-xs text-muted-foreground">Affects: {affectedNames}</p>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })()}

          {report.timeline && (report.timeline.events.length > 0 || report.timeline.contradictions.length > 0) && (
            <Card>
              <CardHeader className="pb-2">
                <SectionHeader
                  sectionKey="timeline"
                  title="4. Timeline & Chronology"
                  description="Ordered sequence of dated events across all documents, with flags for impossible sequences (e.g. a document expiring before it was issued)."
                  icon={<Clock className="h-4 w-4" />}
                />
              </CardHeader>
              {expandedSections.timeline && (
                <CardContent className="space-y-4">
                  {report.timeline.summary && <p className="text-sm text-muted-foreground">{report.timeline.summary}</p>}
                  {report.timeline.contradictions.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium">Chronological issues</h4>
                      {report.timeline.contradictions.map((c, i) => (
                        <div key={i} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                          <p className="text-red-800">{c.description}</p>
                          {c.documents_involved?.length > 0 && (
                            <p className="text-xs text-red-700 mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5">
                              <span>Documents:</span>
                              {c.documents_involved.map((d, di) => (
                                <span key={di} className="inline-flex items-center gap-0.5">
                                  {d}
                                  <ViewSource doc={d} />
                                  {di < c.documents_involved.length - 1 ? ',' : ''}
                                </span>
                              ))}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {report.timeline.events.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium mb-2">Events</h4>
                      <ol className="relative border-l border-muted-foreground/20 ml-2 space-y-3">
                        {report.timeline.events.map((e, i) => (
                          <li key={i} className="ml-4">
                            <div className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-primary/60" />
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <span className="text-sm font-medium tabular-nums">{e.date || '—'}</span>
                              <span className="text-sm">{e.label}</span>
                            </div>
                            <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-1">
                              {e.memberName ? <span>{e.memberName} ·</span> : null}
                              <span>{e.document}</span>
                              <ViewSource doc={e.document} />
                            </p>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          )}

          {report.personal_info_concordance && (
            <Card>
              <CardHeader className="pb-2">
                <SectionHeader
                  sectionKey="concordance"
                  title="5. Personal Information Concordance"
                  description="Side-by-side comparison of key identity fields (name, DOB, nationality, etc.) across all documents for each person."
                  icon={<FileText className="h-4 w-4" />}
                />
              </CardHeader>
              {expandedSections.concordance && (
                <CardContent className="space-y-4">
                  <p className="text-sm">{report.personal_info_concordance.consistency_summary}</p>

                  {report.personal_info_concordance.byMember ? (
                    <div className="space-y-4">
                      {report.personal_info_concordance.byMember.map(memberConc => {
                        const memberInfo = report.familyCrossReference?.familyMembers.find(
                          m => m.id === memberConc.memberId
                        );
                        const mc = memberInfo
                          ? getMemberColorClasses(memberInfo.color)
                          : getMemberColorClasses('blue');
                        const memberDocs = Array.from(
                          new Set(
                            memberConc.comparison_table.flatMap(row =>
                              (row.values_by_document ?? []).map(v => v.document)
                            )
                          )
                        );
                        return (
                          <div
                            key={memberConc.memberId}
                            className={`border rounded-lg overflow-hidden ${mc.border}`}
                          >
                            <div className={`px-3 py-2 flex items-center justify-between ${mc.bg}`}>
                              <span className={`text-sm font-medium ${mc.text}`}>{memberConc.memberName}</span>
                              <span className={`text-xs opacity-75 ${mc.text}`}>{memberConc.consistency_summary}</span>
                            </div>
                            {memberConc.comparison_table.length > 0 ? (
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm border-collapse">
                                  <thead>
                                    <tr className="bg-muted/50">
                                      <th className="text-left p-2 border font-medium">Field</th>
                                      {memberDocs.map((docName, i) => (
                                        <th key={i} className="text-left p-2 border font-medium">
                                          {docName.split('/').pop()?.split('\\').pop() ?? `Doc ${i + 1}`}
                                        </th>
                                      ))}
                                      <th className="text-center p-2 border font-medium">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {memberConc.comparison_table.map((row, ri) => {
                                      const valueMap = new Map((row.values_by_document ?? []).map(v => [v.document, v]));
                                      return (
                                        <tr key={ri} className="hover:bg-muted/20">
                                          <td className="p-2 border font-medium">{row.field}</td>
                                          {memberDocs.map((docName, vi) => {
                                            const v = valueMap.get(docName);
                                            return (
                                              <td key={vi} className="p-2 border">
                                                {v ? (
                                                  <>
                                                    <div>{v.translated || v.original}</div>
                                                    {v.translated && v.original !== v.translated && (
                                                      <div className="text-xs text-muted-foreground italic">({v.original})</div>
                                                    )}
                                                    {(v.legibility === 'Poor' || v.legibility === 'Fair') && (
                                                      <div className={`text-[10px] font-medium mt-0.5 ${v.legibility === 'Poor' ? 'text-red-600' : 'text-amber-600'}`}>
                                                        ⚠ {v.legibility} legibility
                                                      </div>
                                                    )}
                                                  </>
                                                ) : (
                                                  <span className="text-muted-foreground text-xs italic">—</span>
                                                )}
                                              </td>
                                            );
                                          })}
                                          <td className="p-2 border text-center">
                                            <div className="flex flex-col items-center gap-1">
                                              <Badge
                                                variant="outline"
                                                className={
                                                  row.status === 'consistent'
                                                    ? 'bg-green-100 text-green-800 border-green-200'
                                                    : row.status === 'inconsistent'
                                                      ? 'bg-red-100 text-red-800 border-red-200'
                                                      : row.status === 'missing_info'
                                                        ? 'bg-orange-100 text-orange-800 border-orange-200'
                                                        : 'bg-amber-100 text-amber-800 border-amber-200'
                                                }
                                              >
                                                {row.status === 'consistent'
                                                  ? 'Consistent'
                                                  : row.status === 'inconsistent'
                                                    ? 'Inconsistent'
                                                    : row.status === 'missing_info'
                                                      ? 'Missing info'
                                                      : 'Requires review'}
                                              </Badge>
                                              {row.note && row.status !== 'consistent' && (
                                                <p className="text-[10px] text-muted-foreground text-center max-w-[120px]">
                                                  {row.note}
                                                </p>
                                              )}
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground p-3 italic">
                                No cross-document field comparisons for this member.
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    report.personal_info_concordance.comparison_table?.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="bg-muted/50">
                              <th className="text-left p-2 border font-medium">Field</th>
                              {allDocs.map((docName, i) => (
                                <th key={i} className="text-left p-2 border font-medium">
                                  {docName.split('/').pop()?.split('\\').pop() ?? `Doc ${i + 1}`}
                                </th>
                              ))}
                              <th className="text-center p-2 border font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {comparisonTable.map((row, ri) => {
                              const valueMap = new Map((row.values_by_document ?? []).map(v => [v.document, v]));
                              return (
                                <tr key={ri} className="hover:bg-muted/20">
                                  <td className="p-2 border font-medium">{row.field}</td>
                                  {allDocs.map((docName, vi) => {
                                    const v = valueMap.get(docName);
                                    return (
                                      <td key={vi} className="p-2 border">
                                        {v ? (
                                          <>
                                            <div>{v.translated || v.original}</div>
                                            {v.translated && v.original !== v.translated && (
                                              <div className="text-xs text-muted-foreground italic">({v.original})</div>
                                            )}
                                            {(v.legibility === 'Poor' || v.legibility === 'Fair') && (
                                              <div className={`text-[10px] font-medium mt-0.5 ${v.legibility === 'Poor' ? 'text-red-600' : 'text-amber-600'}`}>
                                                ⚠ {v.legibility} legibility
                                              </div>
                                            )}
                                          </>
                                        ) : (
                                          <span className="text-muted-foreground text-xs italic">—</span>
                                        )}
                                      </td>
                                    );
                                  })}
                                  <td className="p-2 border text-center">
                                    <div className="flex flex-col items-center gap-1">
                                      <Badge
                                        variant="outline"
                                        className={
                                          row.status === 'consistent'
                                            ? 'bg-green-100 text-green-800 border-green-200'
                                            : row.status === 'inconsistent'
                                              ? 'bg-red-100 text-red-800 border-red-200'
                                              : row.status === 'missing_info'
                                                ? 'bg-orange-100 text-orange-800 border-orange-200'
                                                : 'bg-amber-100 text-amber-800 border-amber-200'
                                        }
                                      >
                                        {row.status === 'consistent'
                                          ? 'Consistent'
                                          : row.status === 'inconsistent'
                                            ? 'Inconsistent'
                                            : row.status === 'missing_info'
                                              ? 'Missing info'
                                              : 'Requires review'}
                                      </Badge>
                                      {row.note && row.status !== 'consistent' && (
                                        <p className="text-[10px] text-muted-foreground text-center max-w-[120px]">
                                          {row.note}
                                        </p>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )
                  )}
                </CardContent>
              )}
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
