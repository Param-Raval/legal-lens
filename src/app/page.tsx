'use client';

import { useState, useEffect } from 'react';
import { FileText, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFiles } from '@/hooks/useFiles';
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
    checkDiscrepancies,
    generateFullReport,
    stopProcessing,
    setClientName,
    setFileLanguage,
    selectFile,
    nextFile,
    prevFile,
    closeViewer,
    clearError,
  } = useFiles();

  const [showReport, setShowReport] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

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
              <SettingsDialog />
              <Button
                variant="outline"
                size="sm"
                onClick={toggleDarkMode}
                className="h-9 w-9 p-0"
                title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
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
          <div className="flex items-center justify-center space-x-3">
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
        <FileUpload onUpload={uploadFiles} isLoading={isPdfExtracting} />

        {/* Error Display */}
        <ErrorDisplay error={error} onClear={clearError} />

        {/* File Summary */}
        <FileSummary files={files} />

        {/* File List */}
        <FileList
          files={files}
          isAnalyzing={isAnalyzing}
          isTranslating={isTranslating}
          onView={selectFile}
          onAnalyze={analyzeFile}
          onTranslate={translateFile}
          onSetLanguage={setFileLanguage}
        />

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
          onRunFullPipeline={runFullPipeline}
          onAnalyzeAll={analyzeAllFiles}
          onTranslateAll={translateAllFiles}
          onCheckDiscrepancies={checkDiscrepancies}
          onGenerateReport={generateFullReport}
          onStopProcessing={stopProcessing}
          onViewReport={() => setShowReport(true)}
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

      {/* Report Viewer */}
      {showReport && report && (
        <ReportViewer
          report={report}
          clientName={clientName}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
