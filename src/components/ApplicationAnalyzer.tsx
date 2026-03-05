'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  CheckCircle,
  Search,
  Loader2,
  Brain,
  Languages,
  FileText,
  Download,
  Play,
  Square,
} from 'lucide-react';
import { DiscrepancyCheck, AnalysisReport, FileInfo } from '@/types';
import type { PipelineProgress } from '@/hooks/useFiles';

interface ApplicationAnalyzerProps {
  files: FileInfo[];
  discrepancyCheck: DiscrepancyCheck;
  report: AnalysisReport | null;
  isGeneratingReport: boolean;
  isAnalyzing: number | null;
  isTranslating: number | null;
  pipeline: PipelineProgress;
  onRunFullPipeline: () => void;
  onAnalyzeAll: () => void;
  onTranslateAll: () => void;
  onCheckDiscrepancies: () => void;
  onGenerateReport: () => void;
  onStopProcessing: () => void;
  onViewReport: () => void;
}

export const ApplicationAnalyzer = ({
  files,
  discrepancyCheck,
  report,
  isGeneratingReport,
  isAnalyzing,
  isTranslating,
  pipeline,
  onRunFullPipeline,
  onAnalyzeAll,
  onTranslateAll,
  onCheckDiscrepancies,
  onGenerateReport,
  onStopProcessing,
  onViewReport,
}: ApplicationAnalyzerProps) => {
  if (files.length === 0) return null;

  const totalFiles = files.length;
  const imageFiles = files.filter(f => f.type.startsWith('image/'));
  const analyzedCount = files.filter(f => f.analysis).length;
  const nonEnglishAnalyzed = files.filter(
    f => f.analysis && f.analysis.document_language !== 'en'
  );
  const translatedCount = files.filter(f => f.translation).length;
  const needsTranslation = nonEnglishAnalyzed.filter(
    f => !f.translation
  ).length;

  const canAnalyze = imageFiles.length > analyzedCount && isAnalyzing === null;
  const canTranslate = needsTranslation > 0 && isTranslating === null;
  const canCheckDiscrepancies =
    analyzedCount >= 2 && !discrepancyCheck.isChecking;
  const canGenerateReport = analyzedCount >= 1 && !isGeneratingReport;

  const isBusy =
    isAnalyzing !== null ||
    isTranslating !== null ||
    isGeneratingReport ||
    discrepancyCheck.isChecking ||
    (pipeline.stage !== 'idle' && pipeline.stage !== 'complete');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center space-x-2">
          <Search className="h-5 w-5" />
          <span>Analysis Pipeline</span>
          {report && (
            <Badge
              variant="default"
              className="ml-2 bg-blue-100 text-blue-800 border-blue-200"
            >
              <FileText className="h-3 w-3 mr-1" />
              Report Ready
            </Badge>
          )}
          {discrepancyCheck.hasDiscrepancies && !report && (
            <Badge variant="destructive" className="ml-2">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Discrepancies Found
            </Badge>
          )}
          {!discrepancyCheck.hasDiscrepancies &&
            discrepancyCheck.summary &&
            !report && (
              <Badge
                variant="default"
                className="ml-2 bg-green-100 text-green-800 border-green-200"
              >
                <CheckCircle className="h-3 w-3 mr-1" />
                No Discrepancies
              </Badge>
            )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="p-2 border rounded text-center">
            <p className="text-muted-foreground text-xs">Files</p>
            <p className="font-semibold">{totalFiles}</p>
          </div>
          <div className="p-2 border rounded text-center">
            <p className="text-muted-foreground text-xs">Analyzed</p>
            <p className="font-semibold">
              {analyzedCount}/{imageFiles.length}
            </p>
          </div>
          <div className="p-2 border rounded text-center">
            <p className="text-muted-foreground text-xs">Translated</p>
            <p className="font-semibold">
              {translatedCount}/{nonEnglishAnalyzed.length || '0'}
            </p>
          </div>
          <div className="p-2 border rounded text-center">
            <p className="text-muted-foreground text-xs">Report</p>
            <p className="font-semibold">{report ? 'Ready' : 'Pending'}</p>
          </div>
        </div>

        {/* Progress Bar */}
        {pipeline.stage !== 'idle' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-medium">
                {pipeline.message}
              </span>
              <div className="flex items-center gap-2">
                {isBusy && pipeline.stage !== 'uploading' && (
                  <Button
                    onClick={onStopProcessing}
                    variant="destructive"
                    size="sm"
                    className="h-6 px-2 text-xs"
                  >
                    <Square className="h-3 w-3 mr-1" />
                    Stop
                  </Button>
                )}
                <span className="font-semibold">{pipeline.percent}%</span>
              </div>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
                style={{ width: `${pipeline.percent}%` }}
              />
            </div>
          </div>
        )}

        {/* Workflow buttons */}
        <div className="flex flex-wrap gap-2">
          {/* Run Full Pipeline */}
          <Button
            onClick={onRunFullPipeline}
            disabled={
              pipeline.stage !== 'idle' && pipeline.stage !== 'complete'
            }
            size="sm"
          >
            {pipeline.stage !== 'idle' && pipeline.stage !== 'complete' ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Running Pipeline...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Analyze All
              </>
            )}
          </Button>

          <div className="w-px h-8 bg-border mx-1" />

          {/* Individual Steps */}

          {/* Step 1: Analyze All (OCR only) */}
          <Button
            onClick={onAnalyzeAll}
            disabled={!canAnalyze}
            variant="outline"
            size="sm"
          >
            {isAnalyzing !== null ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                OCR...
              </>
            ) : (
              <>
                <Brain className="h-4 w-4 mr-2" />
                OCR Only
              </>
            )}
          </Button>

          {/* Step 2: Translate All */}
          <Button
            onClick={onTranslateAll}
            disabled={!canTranslate}
            variant="outline"
            size="sm"
          >
            {isTranslating !== null ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Translating...
              </>
            ) : (
              <>
                <Languages className="h-4 w-4 mr-2" />
                Translate All
              </>
            )}
          </Button>

          {/* Step 3: Discrepancy Check */}
          <Button
            onClick={onCheckDiscrepancies}
            disabled={!canCheckDiscrepancies}
            variant="outline"
            size="sm"
          >
            {discrepancyCheck.isChecking ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <Search className="h-4 w-4 mr-2" />
                Quick Check
              </>
            )}
          </Button>

          {/* Step 4: Generate Full Report */}
          <Button
            onClick={onGenerateReport}
            disabled={!canGenerateReport}
            size="sm"
          >
            {isGeneratingReport ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating Report...
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 mr-2" />
                Generate Report
              </>
            )}
          </Button>

          {/* View / Download Report */}
          {report && (
            <Button onClick={onViewReport} variant="secondary" size="sm">
              <Download className="h-4 w-4 mr-2" />
              View & Download
            </Button>
          )}
        </div>

        {/* Discrepancy summary (quick check) */}
        {discrepancyCheck.summary && !report && (
          <div className="space-y-2">
            <h4 className="font-medium text-sm">Quick Check Results:</h4>
            <div className="p-3 bg-muted/10 rounded-lg">
              <p className="text-sm whitespace-pre-wrap">
                {discrepancyCheck.summary}
              </p>
            </div>
          </div>
        )}

        {/* Report summary preview */}
        {report && (
          <div className="space-y-2">
            <h4 className="font-medium text-sm">Report Summary:</h4>
            <div className="p-3 bg-muted/10 rounded-lg space-y-2">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium">Assessment:</span>
                <Badge
                  variant="outline"
                  className={
                    report.executive_summary.overall_assessment === 'CLEAR'
                      ? 'bg-green-100 text-green-800 border-green-200'
                      : report.executive_summary.overall_assessment ===
                          'MINOR CONCERNS'
                        ? 'bg-yellow-100 text-yellow-800 border-yellow-200'
                        : 'bg-red-100 text-red-800 border-red-200'
                  }
                >
                  {report.executive_summary.overall_assessment}
                </Badge>
              </div>
              <p className="text-sm">{report.executive_summary.overview}</p>
              {report.cross_document_discrepancies?.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {report.cross_document_discrepancies.length} discrepancy(ies)
                  found &middot; {report.action_items?.length || 0} action
                  item(s)
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
