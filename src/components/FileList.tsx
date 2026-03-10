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
} from 'lucide-react';
import { FileInfo } from '@/types';
import { formatFileSize, canAnalyzeFile } from '@/lib/utils';

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
}: FileListProps) => {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

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
  const renderFileRow = (file: FileInfo, index: number, indent: boolean) => {
    const needsTranslation =
      file.analysis &&
      file.analysis.document_language !== 'en' &&
      !file.translation;

    return (
      <div
        key={file.id}
        className={`flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 ${indent ? 'ml-6 border-dashed' : ''}`}
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
        </div>
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
              return renderFileRow(files[idx], idx, false);
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
                  </div>
                </div>

                {/* Expanded page rows */}
                {expanded &&
                  group.indices.map(idx =>
                    renderFileRow(files[idx], idx, true)
                  )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
