'use client';

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

export const FileList = ({
  files,
  isAnalyzing,
  isTranslating,
  onView,
  onAnalyze,
  onTranslate,
  onSetLanguage,
}: FileListProps) => {
  if (files.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Files ({files.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {files.map((file, index) => {
            const needsTranslation =
              file.analysis &&
              file.analysis.document_language !== 'en' &&
              !file.translation;

            return (
              <div
                key={file.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
              >
                <div className="flex items-center space-x-3 flex-1 min-w-0">
                  <File className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <div className="flex items-center space-x-2">
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(file.size)}
                      </p>
                      {file.analysis?.document_language && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1 py-0"
                        >
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
                  {/* Language hint dropdown */}
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

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onView(index)}
                  >
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
          })}
        </div>
      </CardContent>
    </Card>
  );
};
