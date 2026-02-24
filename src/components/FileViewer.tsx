// components/FileViewer.tsx
'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  File,
  Eye,
  Brain,
  ChevronLeft,
  ChevronRight,
  X,
  Languages,
  Loader2,
} from 'lucide-react';
import { FileInfo } from '@/types';
import { canAnalyzeFile } from '@/lib/utils';

interface FileViewerProps {
  show: boolean;
  file: FileInfo | null;
  isAnalyzing: boolean;
  isTranslating: boolean;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  onAnalyze: () => void;
  onTranslate: () => void;
  hasNext: boolean;
  hasPrev: boolean;
}

export const FileViewer = ({
  show,
  file,
  isAnalyzing,
  isTranslating,
  onClose,
  onNext,
  onPrev,
  onAnalyze,
  onTranslate,
  hasNext,
  hasPrev,
}: FileViewerProps) => {
  const fileUrl = file?.file ? URL.createObjectURL(file.file) : '';

  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [fileUrl]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!show) return;

      switch (event.key) {
        case 'ArrowLeft':
          if (hasPrev) {
            event.preventDefault();
            onPrev();
          }
          break;
        case 'ArrowRight':
          if (hasNext) {
            event.preventDefault();
            onNext();
          }
          break;
        case 'Escape':
          event.preventDefault();
          onClose();
          break;
      }
    };

    if (show) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [show, hasNext, hasPrev, onNext, onPrev, onClose]);

  if (!show || !file) return null;

  const needsTranslation =
    file.analysis &&
    file.analysis.document_language !== 'en' &&
    !file.translation;

  return (
    <Dialog open={show} onOpenChange={onClose}>
      <DialogContent
        className="!w-[80vw] !max-w-[80vw] !h-[85vh] !max-h-[85vh] p-0 flex flex-col"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">
          {file.name} — Document Viewer
        </DialogTitle>
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center space-x-2 flex-1 min-w-0">
            <File className="h-4 w-4 flex-shrink-0" />
            <span className="truncate font-semibold">{file.name}</span>
            {file.analysis?.document_language && (
              <Badge variant="outline" className="text-xs shrink-0">
                {file.analysis.document_language.toUpperCase()}
              </Badge>
            )}
          </div>

          <div className="flex items-center space-x-1">
            <Button
              onClick={onPrev}
              disabled={!hasPrev}
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <Button
              onClick={onNext}
              disabled={!hasNext}
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>

            <Button
              onClick={onClose}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 ml-2"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 p-4 overflow-hidden min-h-0">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full min-h-0">
            {/* File Preview */}
            <Card className="flex flex-col h-full min-h-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center space-x-2">
                  <Eye className="h-4 w-4" />
                  <span>Preview</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 overflow-auto">
                <div className="h-full p-2">
                  {file.type.startsWith('image/') ? (
                    <img
                      src={fileUrl}
                      alt={file.name}
                      className="w-full h-full object-contain rounded"
                    />
                  ) : file.type.includes('pdf') ? (
                    <iframe
                      src={fileUrl}
                      className="w-full h-full border-0 rounded"
                      title={file.name}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full bg-muted/10 rounded">
                      <div className="text-center">
                        <File className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          Preview not available
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Analysis & Translation */}
            <Card className="flex flex-col h-full min-h-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Brain className="h-4 w-4" />
                    <span>Analysis</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    {canAnalyzeFile(file) && (
                      <Button
                        onClick={onAnalyze}
                        disabled={isAnalyzing}
                        size="sm"
                        variant="outline"
                        title="Run OCR"
                      >
                        {isAnalyzing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Brain className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    {needsTranslation && (
                      <Button
                        onClick={onTranslate}
                        disabled={isTranslating}
                        size="sm"
                        variant="outline"
                        title="Translate"
                      >
                        {isTranslating ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Languages className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 overflow-auto">
                {file.analysis ? (
                  <div className="space-y-3">
                    {/* Document info */}
                    <div className="p-2 bg-muted/20 rounded space-y-1">
                      <p className="text-sm font-medium">
                        Type: {file.analysis.document_type}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Language: {file.analysis.document_language}
                      </p>
                    </div>

                    {/* Structured fields */}
                    {file.analysis.structured_data?.fields?.length > 0 && (
                      <div className="space-y-1">
                        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          Extracted Fields
                        </h4>
                        <div className="space-y-1">
                          {file.analysis.structured_data.fields.map(
                            (field, i) => (
                              <div
                                key={i}
                                className="flex justify-between text-xs p-1.5 bg-muted/10 rounded"
                              >
                                <span className="font-medium text-muted-foreground">
                                  {field.key}
                                </span>
                                <span className="text-right max-w-[60%] break-words">
                                  {field.value}
                                </span>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}

                    {/* Extracted text */}
                    {file.analysis.text && (
                      <div className="space-y-1">
                        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          OCR Text
                        </h4>
                        <pre className="text-xs whitespace-pre-wrap bg-muted/10 p-2 rounded max-h-32 overflow-auto">
                          {file.analysis.text}
                        </pre>
                      </div>
                    )}

                    {/* Translation */}
                    {file.translation && (
                      <div className="space-y-1 border-t pt-3">
                        <h4 className="text-xs font-medium text-blue-600 uppercase tracking-wide flex items-center space-x-1">
                          <Languages className="h-3 w-3" />
                          <span>Translation</span>
                        </h4>
                        <pre className="text-xs whitespace-pre-wrap bg-blue-50 p-2 rounded max-h-32 overflow-auto">
                          {file.translation.translated_text}
                        </pre>
                        {file.translation.notes && (
                          <p className="text-xs italic text-muted-foreground">
                            Notes: {file.translation.notes}
                          </p>
                        )}
                        {(file.translation.structured_data?.translated_fields
                          ?.length ?? 0) > 0 && (
                          <div className="space-y-1">
                            <h5 className="text-xs font-medium text-muted-foreground">
                              Translated Fields
                            </h5>
                            {file.translation.structured_data!.translated_fields.map(
                              (field, i) => (
                                <div
                                  key={i}
                                  className="flex justify-between text-xs p-1.5 bg-blue-50 rounded"
                                >
                                  <span className="font-medium text-muted-foreground">
                                    {field.key}
                                  </span>
                                  <span className="text-right max-w-[60%] break-words">
                                    {field.value}
                                  </span>
                                </div>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <p className="text-sm">
                      Click the analyze button to extract text and data
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
