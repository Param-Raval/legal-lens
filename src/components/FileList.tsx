'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  File,
  Eye,
  Brain,
  CheckCircle,
  Languages,
  Loader2,
  ChevronRight,
  ChevronDown,
  FileText,
  StickyNote,
} from 'lucide-react';
import { FileInfo, FamilyMember } from '@/types';
import { formatFileSize, canAnalyzeFile, canTranslateFile, getMemberColorClasses } from '@/lib/utils';

const LANGUAGE_OPTIONS = [
  { value: '', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'French' },
  { value: 'ar', label: 'Arabic' },
  { value: 'fa_AF', label: 'Dari' },
  { value: 'es', label: 'Spanish' },
  { value: 'ht', label: 'Haitian Creole' },
  { value: 'zh', label: 'Chinese' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'de', label: 'German' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'hi', label: 'Hindi' },
  { value: 'bn', label: 'Bengali' },
  { value: 'ne', label: 'Nepali' },
  { value: 'ru', label: 'Russian' },
  { value: 'fa', label: 'Farsi / Persian' },
  { value: 'ur', label: 'Urdu' },
  { value: 'tr', label: 'Turkish' },
  { value: 'ta', label: 'Tamil' },
];

interface FileListProps {
  files: FileInfo[];
  isAnalyzing: number | null;
  isTranslating: number | null;
  onView: (index: number) => void;
  onAnalyze: (index: number) => void;
  onTranslate: (index: number) => void;
  onSetLanguage: (index: number, lang: string) => void;
  onRemove: (indexOrGroupId: number | string) => void;
  // Family mode
  familyModeEnabled?: boolean;
  familyMembers?: FamilyMember[];
  onAssignMember?: (groupId: string, memberId: string) => void;
  // Per-document notes
  onUpdateFileNotes?: (fileId: string, notes: string) => void;
}

/** A visual group: either a multi-page PDF or a single standalone file. */
interface FileGroup {
  key: string;
  label: string;
  isPdf: boolean;
  /** Indices into the parent `files` array */
  indices: number[];
}

export const FileList = ({
  files,
  isAnalyzing,
  isTranslating,
  onView,
  onAnalyze,
  onTranslate,
  onSetLanguage,
  onRemove,
  familyModeEnabled = false,
  familyMembers = [],
  onAssignMember,
  onUpdateFileNotes,
}: FileListProps) => {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [openNotesId, setOpenNotesId] = useState<string | null>(null);

  /** Render the family assignment dropdown + badge for a group. */
  const renderFamilyAssignment = (groupId: string, assignedMemberId?: string) => {
    if (!familyModeEnabled) return null;
    const assignedMember = familyMembers.find(m => m.id === assignedMemberId);
    const colors = assignedMember ? getMemberColorClasses(assignedMember.color) : null;
    return (
      <div className="flex items-center gap-1.5">
        {assignedMember && colors ? (
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 flex items-center gap-1 ${colors.bg} ${colors.text} ${colors.border}`}
          >
            <span className={`inline-block h-2 w-2 rounded-full ${colors.dot}`} />
            {assignedMember.name}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 bg-amber-50 text-amber-700 border-amber-200"
          >
            Unassigned
          </Badge>
        )}
        {familyMembers.length > 0 && onAssignMember && (
          <select
            className="h-7 text-xs border rounded px-1.5 bg-background text-foreground"
            value={assignedMemberId ?? ''}
            onChange={e => onAssignMember(groupId, e.target.value)}
            title="Assign to family member"
          >
            <option value="">— Unassign —</option>
            {familyMembers.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  };

  /** Build ordered groups: multi-page PDFs are grouped; standalone files are their own group. */
  const groups: FileGroup[] = useMemo(() => {
    const result: FileGroup[] = [];
    const pdfMap = new Map<string, number[]>();
    const pdfOrder: string[] = [];

    files.forEach((f, idx) => {
      if (f.pdfSourceId) {
        if (!pdfMap.has(f.pdfSourceId)) {
          pdfMap.set(f.pdfSourceId, []);
          pdfOrder.push(f.pdfSourceId);
        }
        pdfMap.get(f.pdfSourceId)!.push(idx);
      } else {
        result.push({
          key: f.id,
          label: f.name,
          isPdf: false,
          indices: [idx],
        });
      }
    });

    // Insert PDF groups at the position of their first page
    for (const sourceId of pdfOrder) {
      const indices = pdfMap.get(sourceId)!;
      const first = files[indices[0]];
      result.push({
        key: sourceId,
        label: first.pdfSourceName ?? first.name,
        isPdf: true,
        indices,
      });
    }

    // Sort groups by their first file index to preserve original upload order
    result.sort((a, b) => a.indices[0] - b.indices[0]);
    return result;
  }, [files]);

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (files.length === 0) return null;

  /** Render a single file row (used for both standalone files and PDF page rows). */
  const renderFileRow = (file: FileInfo, index: number, indent: boolean, showFamilyAssignment = false, isPdfPage = false, groupId?: string) => {
    const needsTranslation = canTranslateFile(file);
    const notesOpen = openNotesId === file.id;
    const hasNotes = !!file.userNotes;

    return (
      <div key={file.id} className={`${indent ? 'ml-6' : ''} space-y-1`}>
      <div
        className={`flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 ${indent ? 'border-dashed' : ''}`}
      >
        <div className="flex items-center space-x-3 flex-1 min-w-0">
          <File className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {file.pdfPageNumber ? `Page ${file.pdfPageNumber}` : file.name}
            </p>
            <div className="flex items-center space-x-2">
              <p className="text-xs text-muted-foreground">
                {formatFileSize(file.size)}
              </p>
              {file.analysis?.document_language && (
                <Badge variant="outline" className="text-[10px] px-1 py-0">
                  {file.analysis.document_language.toUpperCase()}
                </Badge>
              )}
              {file.analysis?.document_type && (
                <span className="text-[10px] text-muted-foreground">
                  {file.analysis.document_type}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {showFamilyAssignment && renderFamilyAssignment(file.id, file.familyMemberId)}
          {/* Language hint — only show for standalone (non-PDF) files;
              PDF pages inherit the hint from the group header. */}
          {!file.pdfSourceId && (
            <select
              className="h-7 text-xs border rounded px-1.5 bg-background text-foreground"
              value={file.languageHint ?? ''}
              onChange={e => onSetLanguage(index, e.target.value)}
              title="Document language (optional)"
            >
              {LANGUAGE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}

          {file.analysis && (
            <Badge variant="secondary" className="text-xs">
              <CheckCircle className="h-3 w-3 mr-1" />
              OCR
            </Badge>
          )}

          {file.translation && (
            <Badge
              variant="secondary"
              className="text-xs bg-blue-100 text-blue-800"
            >
              <Languages className="h-3 w-3 mr-1" />
              Translated
            </Badge>
          )}

          <Button variant="outline" size="sm" onClick={() => onView(index)}>
            <Eye className="h-4 w-4" />
          </Button>

          {canAnalyzeFile(file) && !file.analysis && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAnalyze(index)}
              disabled={isAnalyzing === index}
            >
              {isAnalyzing === index ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Brain className="h-4 w-4" />
              )}
            </Button>
          )}

          {needsTranslation && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onTranslate(index)}
              disabled={isTranslating === index}
            >
              {isTranslating === index ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Languages className="h-4 w-4" />
              )}
            </Button>
          )}

          {onUpdateFileNotes && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpenNotesId(notesOpen ? null : file.id)}
              title="Add notes for this document"
              className={hasNotes ? 'text-amber-600 border-amber-300 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-400' : ''}
            >
              <StickyNote className="h-4 w-4" />
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => onRemove(isPdfPage && groupId ? groupId : index)}
            title="Remove this file"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            ✕
          </Button>
        </div>
      </div>
      {notesOpen && onUpdateFileNotes && (
        <textarea
          value={file.userNotes ?? ''}
          onChange={e => onUpdateFileNotes(file.id, e.target.value)}
          rows={2}
          placeholder="Notes for this document (used to guide AI analysis)"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
      )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Files ({files.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {groups.map(group => {
            // Standalone file — render directly
            if (!group.isPdf) {
              const idx = group.indices[0];
              return renderFileRow(files[idx], idx, false, true, false);
            }

            // PDF group — collapsible header + child pages
            const expanded = expandedGroups.has(group.key);
            const pageFiles = group.indices.map(i => files[i]);
            const analyzedCount = pageFiles.filter(f => f.analysis).length;
            const translatedCount = pageFiles.filter(f => f.translation).length;
            const firstIdx = group.indices[0];

            return (
              <div key={group.key} className="space-y-1">
                {/* PDF group header */}
                <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                  <div className="flex items-center space-x-2 flex-1 min-w-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => toggleGroup(group.key)}
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </Button>
                    <FileText className="h-5 w-5 text-red-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {group.label}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {pageFiles.length} page
                        {pageFiles.length !== 1 ? 's' : ''}
                        {analyzedCount > 0 &&
                          ` · ${analyzedCount}/${pageFiles.length} analyzed`}
                        {translatedCount > 0 &&
                          ` · ${translatedCount} translated`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {renderFamilyAssignment(group.key, files[firstIdx]?.familyMemberId)}
                    {/* Shared language hint for all pages */}
                    <select
                      className="h-7 text-xs border rounded px-1.5 bg-background text-foreground"
                      value={files[firstIdx]?.languageHint ?? ''}
                      onChange={e => onSetLanguage(firstIdx, e.target.value)}
                      title="Document language (all pages)"
                    >
                      {LANGUAGE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>

                    {analyzedCount === pageFiles.length &&
                      pageFiles.length > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          All OCR&apos;d
                        </Badge>
                      )}

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onRemove(group.key)}
                      title="Remove entire PDF file"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      ✕
                    </Button>

                    {onUpdateFileNotes && (() => {
                      const groupHasNotes = !!files[firstIdx]?.userNotes;
                      const groupNotesOpen = openNotesId === group.key;
                      return (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setOpenNotesId(groupNotesOpen ? null : group.key)}
                          title="Add notes for this document"
                          className={groupHasNotes ? 'text-amber-600 border-amber-300 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-400' : ''}
                        >
                          <StickyNote className="h-4 w-4" />
                        </Button>
                      );
                    })()}
                  </div>
                </div>

                {/* Group-level notes textarea */}
                {openNotesId === group.key && onUpdateFileNotes && (
                  <textarea
                    value={files[firstIdx]?.userNotes ?? ''}
                    onChange={e => onUpdateFileNotes(files[firstIdx].id, e.target.value)}
                    rows={2}
                    placeholder="Notes for this document (used to guide AI analysis)"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                    autoFocus
                  />
                )}

                {/* Expanded page rows */}
                {expanded &&
                  group.indices.map(idx =>
                    renderFileRow(files[idx], idx, true, false, true, group.key)
                  )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
