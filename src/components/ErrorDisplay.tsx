'use client';

import { AlertCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorDisplayProps {
  error: string;
  onClear?: () => void;
}

export const ErrorDisplay = ({ error, onClear }: ErrorDisplayProps) => {
  if (!error) return null;

  return (
    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
      <div className="flex items-start space-x-3">
        <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
        <div className="flex-1">
          <p className="text-red-800 font-medium">Error</p>
          <p className="text-red-700 text-sm mt-1">{error}</p>
        </div>
        {onClear && (
          <Button
            onClick={onClear}
            variant="ghost"
            size="sm"
            className="text-red-600 hover:text-red-800"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
};
