'use client';

import { useState, useEffect } from 'react';
import {
  FileText,
  HelpCircle,
  Moon,
  Sun,
  StickyNote,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useFiles } from '@/hooks/useFiles';
import { startTour, maybeAutoStartTour } from '@/lib/tour';
import {
  FileUpload,
  FileSummary,
  FileList,
  FileViewer,
  ErrorDisplay,
  ApplicationAnalyzer,
  ReportViewer,
  SettingsDialog,
} from '@/components';

export default function Home() {
  const {
    files,
    selectedIndex,
    isAnalyzing,
    isTranslating,
    isPdfExtracting,
    discrepancyCheck,
    report,
    isGeneratingReport,
    clientName,
    error,
    pipeline,
    uploadFiles,
    analyzeFile,
    analyzeAllFiles,
    runFullPipeline,
    translateFile,
    translateAllFiles,
    translateAllWithoutAnalysis,
    checkDiscrepancies,
    generateFullReport,
    generateFreshReport,
    stopProcessing,
    setClientName,
    setFileLanguage,
    selectFile,
    nextFile,
    prevFile,
    closeViewer,
    clearError,
    // Family mode
    familyModeEnabled,
    familyGraph,
    isInferringRelationships,
    toggleFamilyMode,
    addFamilyMember,
    removeFamilyMember,
    updateFamilyMember,
    assignDocumentToMember,
    addRelationship,
    removeRelationship,
    updateRelationship,
    inferRelationships,
    inferStatus,
    setInferStatus,
    // Analysis context
    analysisContext,
    setAnalysisContext,
    updateFileNotes,
    removeFile,
    resetForNewClient,
  } = useFiles();

  const [showReport, setShowReport] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [showNewClientConfirm, setShowNewClientConfirm] = useState(false);

  // Anything worth a confirmation prompt? An empty session resets silently.
  const hasSessionData =
    files.length > 0 || report !== null || analysisContext.trim() !== '';

  const startNewClient = () => {
    resetForNewClient();
    setShowReport(false);
    setShowNewClientConfirm(false);
  };

  useEffect(() => {
    const stored = localStorage.getItem('theme');
    if (
      stored === 'dark' ||
      (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)
    ) {
      setDarkMode(true);
      document.documentElement.classList.add('dark');
    }
  }, []);

  // First launch after install: walk the user through the UI once.
  useEffect(() => {
    maybeAutoStartTour();
  }, []);

  const toggleDarkMode = () => {
    setDarkMode(prev => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('theme', 'light');
      }
      return next;
    });
  };

  const selectedFile = selectedIndex >= 0 ? files[selectedIndex] : null;

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center space-x-3 relative">
            <div className="p-3 bg-primary/10 rounded-full">
              <FileText className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-4xl font-bold tracking-tight">BRC Assistant</h1>
            <div className="absolute right-0 top-0 flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  hasSessionData
                    ? setShowNewClientConfirm(true)
                    : startNewClient()
                }
                className="h-9 w-9 p-0"
                title="New client — clear all documents and results"
                data-tour="new-client"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => startTour()}
                className="h-9 w-9 p-0"
                title="Show guided tour"
              >
                <HelpCircle className="h-4 w-4" />
              </Button>
              <div data-tour="settings">
                <SettingsDialog />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={toggleDarkMode}
                className="h-9 w-9 p-0"
                title={
                  darkMode ? 'Switch to light mode' : 'Switch to dark mode'
                }
                data-tour="theme-toggle"
              >
                {darkMode ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Immigration document analysis with AI-powered OCR, translation, and
            reporting
          </p>
        </div>

        {/* Client Name Input */}
        {files.length > 0 && (
          <div
            className="flex items-center justify-center space-x-3"
            data-tour="client-name"
          >
            <label
              htmlFor="clientName"
              className="text-sm font-medium text-muted-foreground"
            >
              Client Name:
            </label>
            <input
              id="clientName"
              type="text"
              value={clientName}
              onChange={e => setClientName(e.target.value)}
              className="border rounded-md px-3 py-1.5 text-sm w-64 bg-background"
              placeholder="Enter client name"
            />
          </div>
        )}

        {/* File Upload */}
        <div data-tour="upload">
          <FileUpload onUpload={uploadFiles} isLoading={isPdfExtracting} />
        </div>

        {/* Error Display */}
        <ErrorDisplay error={error} onClear={clearError} />

        {/* File Summary */}
        <FileSummary files={files} />

        {/* File List (wrapper is a tour anchor; keep it out of the DOM when
            FileList renders nothing so it can't affect layout) */}
        {files.length > 0 && (
          <div data-tour="file-list">
            <FileList
              files={files}
              isAnalyzing={isAnalyzing}
              isTranslating={isTranslating}
              onView={selectFile}
              onAnalyze={analyzeFile}
              onTranslate={translateFile}
              onSetLanguage={setFileLanguage}
              onRemove={removeFile}
              familyModeEnabled={familyModeEnabled}
              familyMembers={familyGraph.members}
              onAssignMember={assignDocumentToMember}
              onUpdateFileNotes={updateFileNotes}
            />
          </div>
        )}

        {/* Analysis Context */}
        {files.length > 0 && (
          <div className="space-y-2" data-tour="analysis-context">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <StickyNote className="h-4 w-4" />
              <span>
                Analysis context <span className="font-normal">(optional)</span>
              </span>
            </div>
            <textarea
              value={analysisContext}
              onChange={e => setAnalysisContext(e.target.value)}
              rows={3}
              placeholder="Describe what you want checked — e.g. Verify that names and dates of birth are consistent across all documents. Flag any discrepancies in the father's name."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
            />
          </div>
        )}

        {/* Analysis Pipeline */}
        <ApplicationAnalyzer
          files={files}
          discrepancyCheck={discrepancyCheck}
          report={report}
          isGeneratingReport={isGeneratingReport}
          isAnalyzing={isAnalyzing}
          isTranslating={isTranslating}
          isPdfExtracting={isPdfExtracting}
          pipeline={pipeline}
          clientName={clientName}
          onRunFullPipeline={runFullPipeline}
          onAnalyzeAll={analyzeAllFiles}
          onTranslateAll={translateAllFiles}
          onTranslateAllWithoutAnalysis={translateAllWithoutAnalysis}
          onCheckDiscrepancies={checkDiscrepancies}
          onGenerateReport={generateFullReport}
          onGenerateFreshReport={generateFreshReport}
          onStopProcessing={stopProcessing}
          onViewReport={() => setShowReport(true)}
          familyMode={{
            familyModeEnabled,
            familyGraph,
            isInferringRelationships,
            inferStatus,
            onToggleFamilyMode: toggleFamilyMode,
            onAddMember: addFamilyMember,
            onRemoveMember: removeFamilyMember,
            onUpdateMember: updateFamilyMember,
            onAddRelationship: addRelationship,
            onRemoveRelationship: removeRelationship,
            onUpdateRelationship: updateRelationship,
            onInferRelationships: inferRelationships,
            onClearInferStatus: () => setInferStatus(null),
          }}
        />
      </div>

      {/* File Viewer */}
      <FileViewer
        show={selectedIndex >= 0}
        file={selectedFile}
        isAnalyzing={isAnalyzing === selectedIndex}
        isTranslating={isTranslating === selectedIndex}
        onClose={closeViewer}
        onNext={nextFile}
        onPrev={prevFile}
        onAnalyze={() => selectedIndex >= 0 && analyzeFile(selectedIndex)}
        onTranslate={() => selectedIndex >= 0 && translateFile(selectedIndex)}
        hasNext={selectedIndex < files.length - 1}
        hasPrev={selectedIndex > 0}
      />

      {/* New client confirmation */}
      <Dialog
        open={showNewClientConfirm}
        onOpenChange={setShowNewClientConfirm}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start a new client?</DialogTitle>
            <DialogDescription>
              This clears everything in the current session — uploaded
              documents, analysis results, the report, family members, and the
              analysis context. Download the report first if you still need it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowNewClientConfirm(false)}
            >
              Cancel
            </Button>
            <Button onClick={startNewClient}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Start new client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Report Viewer */}
      {showReport && report && (
        <ReportViewer
          report={report}
          clientName={clientName}
          onClose={() => setShowReport(false)}
          onViewSource={documentName => {
            // Resolve a finding's document name to a file and open the viewer.
            const idx = files.findIndex(
              f =>
                (f.pdfSourceName ?? f.name) === documentName ||
                f.name === documentName
            );
            if (idx >= 0) selectFile(idx);
          }}
        />
      )}
    </div>
  );
}
