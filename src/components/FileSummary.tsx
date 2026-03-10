'use client';

import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { File, Brain, CheckCircle, FileText } from 'lucide-react';
import { FileInfo } from '@/types';
import { formatFileSize } from '@/lib/utils';

interface FileSummaryProps {
  files: FileInfo[];
}

export const FileSummary = ({ files }: FileSummaryProps) => {
  const stats = useMemo(() => {
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const analyzedCount = files.filter(file => file.analysis).length;
    const imageCount = files.filter(file =>
      file.type.startsWith('image/')
    ).length;
    // Count distinct documents: each pdfSourceId is one document; each non-PDF file is one document
    const pdfIds = new Set<string>();
    let standaloneCount = 0;
    for (const f of files) {
      if (f.pdfSourceId) pdfIds.add(f.pdfSourceId);
      else standaloneCount++;
    }
    const documentCount = pdfIds.size + standaloneCount;
    return {
      totalSize,
      analyzedCount,
      imageCount,
      documentCount,
      pdfCount: pdfIds.size,
    };
  }, [files]);

  if (files.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div className="space-y-1">
            <div className="flex justify-center">
              <File className="h-6 w-6 text-blue-600" />
            </div>
            <p className="text-2xl font-bold">{stats.documentCount}</p>
            <p className="text-sm text-muted-foreground">
              Document{stats.documentCount !== 1 ? 's' : ''}
              {stats.pdfCount > 0 && (
                <span className="block text-[10px]">
                  ({files.length} pages total)
                </span>
              )}
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex justify-center">
              {stats.pdfCount > 0 ? (
                <FileText className="h-6 w-6 text-red-500" />
              ) : (
                <Brain className="h-6 w-6 text-green-600" />
              )}
            </div>
            <p className="text-2xl font-bold">{stats.imageCount}</p>
            <p className="text-sm text-muted-foreground">
              Pages
              {stats.pdfCount > 0 &&
                ` (${stats.pdfCount} PDF${stats.pdfCount !== 1 ? 's' : ''})`}
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex justify-center">
              <CheckCircle className="h-6 w-6 text-purple-600" />
            </div>
            <p className="text-2xl font-bold">{stats.analyzedCount}</p>
            <p className="text-sm text-muted-foreground">Analyzed</p>
          </div>

          <div className="space-y-1">
            <Badge variant="outline" className="text-lg px-3 py-1">
              {formatFileSize(stats.totalSize)}
            </Badge>
            <p className="text-sm text-muted-foreground">Total Size</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
