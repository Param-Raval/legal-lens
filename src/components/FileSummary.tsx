'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { File, Brain, CheckCircle } from 'lucide-react';
import { FileInfo } from '@/types';
import { formatFileSize } from '@/lib/utils';

interface FileSummaryProps {
  files: FileInfo[];
}

export const FileSummary = ({ files }: FileSummaryProps) => {
  if (files.length === 0) return null;

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const analyzedCount = files.filter(file => file.analysis).length;
  const imageCount = files.filter(file =>
    file.type.startsWith('image/')
  ).length;

  return (
    <Card>
      <CardContent className="p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div className="space-y-1">
            <div className="flex justify-center">
              <File className="h-6 w-6 text-blue-600" />
            </div>
            <p className="text-2xl font-bold">{files.length}</p>
            <p className="text-sm text-muted-foreground">Total Files</p>
          </div>

          <div className="space-y-1">
            <div className="flex justify-center">
              <Brain className="h-6 w-6 text-green-600" />
            </div>
            <p className="text-2xl font-bold">{imageCount}</p>
            <p className="text-sm text-muted-foreground">Images</p>
          </div>

          <div className="space-y-1">
            <div className="flex justify-center">
              <CheckCircle className="h-6 w-6 text-purple-600" />
            </div>
            <p className="text-2xl font-bold">{analyzedCount}</p>
            <p className="text-sm text-muted-foreground">Analyzed</p>
          </div>

          <div className="space-y-1">
            <Badge variant="outline" className="text-lg px-3 py-1">
              {formatFileSize(totalSize)}
            </Badge>
            <p className="text-sm text-muted-foreground">Total Size</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
