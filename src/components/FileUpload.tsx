'use client';

import { useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Upload, Folder, File } from 'lucide-react';
import { DOCX_MIME_TYPE } from '@/lib/utils';

const ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'application/pdf',
  DOCX_MIME_TYPE,
];

function isAcceptedFile(file: File): boolean {
  if (ACCEPTED_TYPES.includes(file.type)) return true;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return [
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'bmp',
    'tiff',
    'tif',
    'pdf',
    'docx',
  ].includes(ext);
}

interface FileUploadProps {
  onUpload: (files: Array<{ file: File; folderPath?: string }>) => void;
  isLoading?: boolean;
}

export const FileUpload = ({ onUpload, isLoading }: FileUploadProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  /** Collect accepted files from a FileList (folders expose all nested files via webkitRelativePath) */
  const collectFiles = useCallback(
    (fileList: FileList) => {
      const entries = Array.from(fileList)
        .filter(isAcceptedFile)
        .map(f => ({ file: f, folderPath: f.webkitRelativePath || undefined }));
      if (entries.length > 0) onUpload(entries);
    },
    [onUpload]
  );

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) collectFiles(files);
    // Reset so the same selection can be re-picked
    event.target.value = '';
  };

  // ── Drag & Drop ────────────────────────────────────────────────────

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      /** Recursively read entries from a DataTransferItem (supports folders);
       *  carries entry.fullPath so the caller can infer which subfolder each file came from. */
      const readEntries = async (entry: FileSystemEntry): Promise<Array<{ file: File; folderPath: string }>> => {
        if (entry.isFile) {
          return new Promise<Array<{ file: File; folderPath: string }>>((resolve, reject) => {
            (entry as FileSystemFileEntry).file(
              f => isAcceptedFile(f)
                ? resolve([{ file: f, folderPath: entry.fullPath }])
                : resolve([]),
              reject
            );
          });
        }
        if (entry.isDirectory) {
          const dirReader = (entry as FileSystemDirectoryEntry).createReader();
          const entries = await new Promise<FileSystemEntry[]>(
            (resolve, reject) => {
              const all: FileSystemEntry[] = [];
              const readBatch = () => {
                dirReader.readEntries(batch => {
                  if (batch.length === 0) {
                    resolve(all);
                  } else {
                    all.push(...batch);
                    readBatch();
                  }
                }, reject);
              };
              readBatch();
            }
          );
          const nested = await Promise.all(entries.map(readEntries));
          return nested.flat();
        }
        return [];
      };

      const items = e.dataTransfer.items;
      if (!items || items.length === 0) return;

      const allEntries: Array<{ file: File; folderPath?: string }> = [];

      // Try the modern webkitGetAsEntry path (supports folders)
      const entryPromises: Promise<Array<{ file: File; folderPath: string }>>[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) {
          entryPromises.push(readEntries(entry));
        }
      }

      if (entryPromises.length > 0) {
        const results = await Promise.all(entryPromises);
        allEntries.push(...results.flat());
      } else {
        // Fallback: plain file drop (no folder path info)
        const dt = e.dataTransfer.files;
        for (let i = 0; i < dt.length; i++) {
          if (isAcceptedFile(dt[i])) allEntries.push({ file: dt[i] });
        }
      }

      if (allEntries.length > 0) onUpload(allEntries);
    },
    [onUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  return (
    <Card>
      <CardContent className="p-8">
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`text-center space-y-4 rounded-lg border-2 border-dashed p-8 transition-colors ${
            isDragOver ? 'border-primary bg-primary/5' : 'border-transparent'
          }`}
        >
          <div className="flex justify-center">
            <div className="p-4 bg-primary/10 rounded-full">
              <Upload className="h-8 w-8 text-primary" />
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-semibold">Upload Files</h3>
            <p className="text-sm text-muted-foreground">
              Drag & drop files or folders here, or use the buttons below
            </p>
            <p className="text-xs text-muted-foreground">
              Supported formats: Images (PNG, JPG, GIF, WebP, BMP, TIFF), PDF, Word (.docx)
            </p>
          </div>

          <div className="flex items-center justify-center gap-3">
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              variant="outline"
            >
              <File className="h-4 w-4 mr-2" />
              {isLoading ? 'Processing...' : 'Choose Files'}
            </Button>

            <Button
              onClick={() => folderInputRef.current?.click()}
              disabled={isLoading}
            >
              <Folder className="h-4 w-4 mr-2" />
              {isLoading ? 'Processing...' : 'Choose Folder'}
            </Button>
          </div>

          {/* File picker (individual files) */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            className="hidden"
            accept={`image/*,.pdf,.docx,${DOCX_MIME_TYPE}`}
          />

          {/* Folder picker */}
          <input
            ref={folderInputRef}
            type="file"
            // @ts-expect-error webkitdirectory is a non-standard attribute
            webkitdirectory=""
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      </CardContent>
    </Card>
  );
};
