'use client';

import { useState } from 'react';
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
  Info,
  RefreshCw,
} from 'lucide-react';
import { DiscrepancyCheck, AnalysisReport, FileInfo, FamilyMember, FamilyGraph, FamilyRelationship } from '@/types';
import type { PipelineProgress } from '@/hooks/useFiles';
import { FamilyMemberPanel } from '@/components/FamilyMemberPanel';
import { canAnalyzeFile } from '@/lib/utils';
import {
  exportAllOcrAsText,
  exportAllOcrAsDocx,
  exportAllTranslationsAsText,
  exportAllTranslationsAsJson,
  exportAllTranslationsAsDocx,
} from '@/lib/translation-export';

interface FamilyModeProps {
  familyModeEnabled: boolean;
  familyGraph: FamilyGraph;
  isInferringRelationships: boolean;
  inferStatus: { type: 'error' | 'success'; message: string } | null;
  onToggleFamilyMode: () => void;
  onAddMember: (name: string, role?: string) => void;
  onRemoveMember: (id: string) => void;
  onUpdateMember: (id: string, updates: Partial<Pick<FamilyMember, 'name' | 'role'>>) => void;
  onAddRelationship: (fromId: string, toId: string, type: string) => void;
  onRemoveRelationship: (fromId: string, toId: string, confidence: FamilyRelationship['confidence']) => void;
  onUpdateRelationship: (
    fromId: string,
    toId: string,
    currentConfidence: FamilyRelationship['confidence'],
    updates: Partial<Pick<FamilyRelationship, 'relationshipType' | 'confidence'>>
  ) => void;
  onInferRelationships: () => void;
  onClearInferStatus: () => void;
}

interface ApplicationAnalyzerProps {
  files: FileInfo[];
  discrepancyCheck: DiscrepancyCheck;
  report: AnalysisReport | null;
  isGeneratingReport: boolean;
  isAnalyzing: number | null;
  isTranslating: number | null;
  isPdfExtracting: boolean;
  pipeline: PipelineProgress;
  clientName: string;
  onRunFullPipeline: () => void;
  onAnalyzeAll: () => void;
  onTranslateAll: () => void;
  onTranslateAllWithoutAnalysis: () => void;
  onCheckDiscrepancies: () => void;
  onGenerateReport: () => void;
  onGenerateFreshReport: () => void;
  onStopProcessing: () => void;
  onViewReport: () => void;
  familyMode?: FamilyModeProps;
}

export const ApplicationAnalyzer = ({
  files,
  discrepancyCheck,
  report,
  isGeneratingReport,
  isAnalyzing,
  isTranslating,
  isPdfExtracting,
  pipeline,
  clientName,
  onRunFullPipeline,
  onAnalyzeAll,
  onTranslateAll,
  onTranslateAllWithoutAnalysis,
  onCheckDiscrepancies,
  onGenerateReport,
  onGenerateFreshReport,
  onStopProcessing,
  onViewReport,
  familyMode,
}: ApplicationAnalyzerProps) => {
  const [showOcrExportMenu, setShowOcrExportMenu] = useState(false);
  const [showTranslationExportMenu, setShowTranslationExportMenu] =
    useState(false);
  if (files.length === 0) return null;

  const familyPanel = familyMode ? (
    <FamilyMemberPanel
      files={files}
      familyModeEnabled={familyMode.familyModeEnabled}
      familyGraph={familyMode.familyGraph}
      isInferringRelationships={familyMode.isInferringRelationships}
      onToggleFamilyMode={familyMode.onToggleFamilyMode}
      onAddMember={familyMode.onAddMember}
      onRemoveMember={familyMode.onRemoveMember}
      onUpdateMember={familyMode.onUpdateMember}
      onAddRelationship={familyMode.onAddRelationship}
      onRemoveRelationship={familyMode.onRemoveRelationship}
      onUpdateRelationship={familyMode.onUpdateRelationship}
      onInferRelationships={familyMode.onInferRelationships}
      inferStatus={familyMode.inferStatus}
      onClearInferStatus={familyMode.onClearInferStatus}
    />
  ) : null;

  const totalFiles = files.length;
  const imageFiles = files.filter(f => f.type.startsWith('image/'));
  const analyzedCount = files.filter(f => f.analysis).length;
  const nonEnglishAnalyzed = files.filter(
    f =>
      f.analysis &&
      (f.analysis.document_language !== 'en' ||
        (f.languageHint && f.languageHint !== 'en'))
  );
  const translatedCount = files.filter(f => f.translation).length;
  const needsTranslation = nonEnglishAnalyzed.filter(
    f => !f.translation
  ).length;
  const untranslatedFiles = imageFiles.filter(f => !f.translation);
  const illegibleCount = files.filter(
    f => f.analysis?.illegibility?.detected
  ).length;
  /** Documents uploaded after the last analysis run — not yet OCR'd, so a
   *  plain "Generate Report" would silently leave them out. Same filter the
   *  pipeline uses to pick files to analyze. */
  const unanalyzedCount = files.filter(
    f => canAnalyzeFile(f) && !f.analysis
  ).length;

  const canAnalyze =
    imageFiles.length > analyzedCount &&
    isAnalyzing === null &&
    !isPdfExtracting;
  const canTranslate =
    needsTranslation > 0 && isTranslating === null && !isPdfExtracting;
  const canTranslateWithoutAnalysis =
    untranslatedFiles.length > 0 && isTranslating === null && !isPdfExtracting;
  const canCheckDiscrepancies =
    analyzedCount >= 2 && !discrepancyCheck.isChecking && !isPdfExtracting;
  const canGenerateReport =
    analyzedCount >= 1 && !isGeneratingReport && !isPdfExtracting;
  const hasOcrResults = analyzedCount > 0;
  const hasTranslations = translatedCount > 0;

  const isBusy =
    isPdfExtracting ||
    isAnalyzing !== null ||
    isTranslating !== null ||
    isGeneratingReport ||
    discrepancyCheck.isChecking ||
    (pipeline.stage !== 'idle' && pipeline.stage !== 'complete');

  return (
    <>
      {familyPanel && <div data-tour="family-panel">{familyPanel}</div>}
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

        {/* Illegibility warning */}
        {illegibleCount > 0 && (
          <div className="flex items-center space-x-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              <strong>{illegibleCount}</strong> document
              {illegibleCount > 1 ? 's' : ''} flagged as illegible. Low-confidence documents will be excluded from the report and listed as action items.
            </span>
          </div>
        )}

        {/* Progress Bar */}
        {pipeline.stage !== 'idle' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-medium">
                {pipeline.message}
              </span>
              <div className="flex items-center gap-2">
                {isBusy && (
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

        {/* Workflow actions */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={onRunFullPipeline}
              disabled={
                isPdfExtracting ||
                (pipeline.stage !== 'idle' && pipeline.stage !== 'complete')
              }
              size="sm"
              data-tour="analyze-all"
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

            <Button
              onClick={onGenerateReport}
              disabled={!canGenerateReport}
              size="sm"
              data-tour="generate-report"
            >
              {isGeneratingReport ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating Report...
                </>
              ) : report ? (
                <>
                  <FileText className="h-4 w-4 mr-2" />
                  Re-generate Report
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 mr-2" />
                  Generate Report
                </>
              )}
            </Button>

            {unanalyzedCount > 0 && analyzedCount > 0 && (
              <Button
                onClick={onGenerateFreshReport}
                disabled={isBusy}
                size="sm"
                data-tour="fresh-report"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Fresh Report (+{unanalyzedCount} new)
              </Button>
            )}

            {report && (
              <Button onClick={onViewReport} variant="secondary" size="sm">
                <Download className="h-4 w-4 mr-2" />
                View & Download
              </Button>
            )}

          </div>

          {unanalyzedCount > 0 && analyzedCount > 0 && (
            <div className="flex items-start gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded p-2">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                <strong>{unanalyzedCount}</strong> newly added document
                {unanalyzedCount > 1 ? 's have' : ' has'} not been analyzed yet
                and would be left out of a report generated now. Click{' '}
                <strong>Fresh Report</strong> to analyze the new upload
                {unanalyzedCount > 1 ? 's' : ''} and rebuild the report with
                every document included.
              </span>
            </div>
          )}

          <div className="h-px bg-border" />

          <div className="flex flex-wrap items-center gap-2">
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

            {analyzedCount === 0 && canTranslateWithoutAnalysis && (
              <Button
                onClick={onTranslateAllWithoutAnalysis}
                disabled={!canTranslateWithoutAnalysis}
                variant="outline"
                size="sm"
                title="Translate files without OCR analysis"
              >
                {isTranslating !== null ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Translating...
                  </>
                ) : (
                  <>
                    <Languages className="h-4 w-4 mr-2" />
                    Translate Only
                  </>
                )}
              </Button>
            )}

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

            {hasTranslations && (
              <div className="relative">
                <Button
                  onClick={() => {
                    setShowTranslationExportMenu(!showTranslationExportMenu);
                    setShowOcrExportMenu(false);
                  }}
                  variant="outline"
                  size="sm"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download Translations
                </Button>
                {showTranslationExportMenu && (
                  <div className="absolute top-full left-0 mt-2 bg-background border border-border rounded-lg shadow-lg z-10 whitespace-nowrap">
                    <button
                      onClick={() => {
                        exportAllTranslationsAsText(files, clientName);
                        setShowTranslationExportMenu(false);
                      }}
                      className="block w-full text-left px-4 py-2 hover:bg-muted/50"
                    >
                      Export as TXT
                    </button>
                    <button
                      onClick={() => {
                        exportAllTranslationsAsDocx(files, clientName);
                        setShowTranslationExportMenu(false);
                      }}
                      className="block w-full text-left px-4 py-2 hover:bg-muted/50 border-t border-border"
                    >
                      Export as DOCX
                    </button>
                    <button
                      onClick={() => {
                        exportAllTranslationsAsJson(files, clientName);
                        setShowTranslationExportMenu(false);
                      }}
                      className="block w-full text-left px-4 py-2 hover:bg-muted/50 border-t border-border"
                    >
                      Export as JSON
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Family mode workflow hint */}
          {familyMode?.familyModeEnabled && analyzedCount > 0 && (
            <div className="flex items-start gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded p-2">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                <strong>Family mode tip:</strong> &ldquo;Analyze All&rdquo; runs OCR, translation, auto-inference, and report in one step.
                After reviewing inferred relationships in the panel above, correct or promote them, then click{' '}
                <strong>Re-generate Report</strong> to apply your changes.
              </span>
            </div>
          )}
        </div>

        {/* Report summary preview */}
        {report && (
          <div className="space-y-2">
            <h4 className="font-medium text-sm">Report Summary:</h4>
            <div className="p-3 bg-muted/10 rounded-lg space-y-2">
              {report.cross_document_discrepancies?.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {report.cross_document_discrepancies.length} discrepancy(ies)
                  found cross-document &middot;{' '}
                  {report.per_document_discrepancies?.filter(d => d.discrepancies.length > 0).length || 0}{' '}
                  document(s) with per-document issues
                </p>
              )}
              {(!report.cross_document_discrepancies || report.cross_document_discrepancies.length === 0) && (
                <p className="text-xs text-muted-foreground">
                  {report.per_document_discrepancies?.filter(d => d.discrepancies.length > 0).length || 0}{' '}
                  document(s) with per-document issues
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
    </>
  );
};
