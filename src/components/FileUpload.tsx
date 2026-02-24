'use client';

import { useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Upload, Folder, File } from 'lucide-react';

const ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'application/pdf',
  'text/plain',
  'text/markdown',
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
    'txt',
    'md',
  ].includes(ext);
}

interface FileUploadProps {
  onUpload: (files: File[]) => void;
  isLoading?: boolean;
}

export const FileUpload = ({ onUpload, isLoading }: FileUploadProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  /** Collect accepted files from a FileList (folders expose all nested files) */
  const collectFiles = useCallback(
    (fileList: FileList) => {
      const accepted = Array.from(fileList).filter(isAcceptedFile);
      if (accepted.length > 0) onUpload(accepted);
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

      /** Recursively read entries from a DataTransferItem (supports folders) */
      const readEntries = async (entry: FileSystemEntry): Promise<File[]> => {
        if (entry.isFile) {
          return new Promise<File[]>((resolve, reject) => {
            (entry as FileSystemFileEntry).file(
              f => (isAcceptedFile(f) ? resolve([f]) : resolve([])),
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

      const allFiles: File[] = [];

      // Try the modern webkitGetAsEntry path (supports folders)
      const entryPromises: Promise<File[]>[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) {
          entryPromises.push(readEntries(entry));
        }
      }

      if (entryPromises.length > 0) {
        const results = await Promise.all(entryPromises);
        allFiles.push(...results.flat());
      } else {
        // Fallback: plain file drop
        const dt = e.dataTransfer.files;
        for (let i = 0; i < dt.length; i++) {
          if (isAcceptedFile(dt[i])) allFiles.push(dt[i]);
        }
      }

      if (allFiles.length > 0) onUpload(allFiles);
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
            accept="image/*,.pdf,.txt,.md"
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
