import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { FileInfo, MemberColorKey } from '@/types';

export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const isDocxFile = (file: Pick<FileInfo, 'name' | 'type'>): boolean => {
  return (
    file.type === DOCX_MIME_TYPE || file.name.toLowerCase().endsWith('.docx')
  );
};

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const canAnalyzeFile = (file: FileInfo): boolean => {
  return file.type.startsWith('image/') || isDocxFile(file);
};

export const canTranslateFile = (file: FileInfo): boolean => {
  if (!file.analysis || file.translation) return false;
  return (
    isDocxFile(file) ||
    file.analysis.document_language !== 'en' ||
    file.languageHint !== 'en'
  );
};

/** All available member colour keys in rotation order. */
export const MEMBER_COLOR_KEYS: MemberColorKey[] = [
  'blue', 'purple', 'green', 'amber', 'pink', 'teal', 'orange', 'indigo',
];

/**
 * Returns Tailwind class strings for a given member colour key.
 * All class names are hardcoded so Tailwind's static analysis can find them.
 */
export function getMemberColorClasses(color: MemberColorKey | string): {
  bg: string;
  text: string;
  border: string;
  dot: string;
} {
  const map: Record<string, { bg: string; text: string; border: string; dot: string }> = {
    blue:   { bg: 'bg-blue-100',   text: 'text-blue-800',   border: 'border-blue-200',   dot: 'bg-blue-500' },
    purple: { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-200', dot: 'bg-purple-500' },
    green:  { bg: 'bg-green-100',  text: 'text-green-800',  border: 'border-green-200',  dot: 'bg-green-500' },
    amber:  { bg: 'bg-amber-100',  text: 'text-amber-800',  border: 'border-amber-200',  dot: 'bg-amber-500' },
    pink:   { bg: 'bg-pink-100',   text: 'text-pink-800',   border: 'border-pink-200',   dot: 'bg-pink-500' },
    teal:   { bg: 'bg-teal-100',   text: 'text-teal-800',   border: 'border-teal-200',   dot: 'bg-teal-500' },
    orange: { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-200', dot: 'bg-orange-500' },
    indigo: { bg: 'bg-indigo-100', text: 'text-indigo-800', border: 'border-indigo-200', dot: 'bg-indigo-500' },
  };
  return map[color] ?? map.blue;
}
