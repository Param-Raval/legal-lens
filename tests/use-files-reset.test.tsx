// @vitest-environment jsdom
/**
 * resetForNewClient() lets staff move to the next client without restarting
 * the app. Pinned: every piece of per-client state is cleared, and the two
 * deliberate survivors — the Family Mode preference and the client-side result
 * cache — are NOT touched (the cache is content-addressed, so a new client's
 * documents can never collide with an old client's entries).
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFiles } from '@/hooks/useFiles';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

function setup() {
  return renderHook(() => useFiles());
}

describe('resetForNewClient', () => {
  it('clears client name, context, error, and family data', () => {
    const { result } = setup();

    act(() => {
      result.current.setClientName('Jane Doe');
      result.current.setAnalysisContext('Compare parents across documents');
      result.current.addFamilyMember('John Smith', 'father');
    });
    expect(result.current.clientName).toBe('Jane Doe');
    expect(result.current.familyGraph.members).toHaveLength(1);

    act(() => {
      result.current.resetForNewClient();
    });

    expect(result.current.clientName).toBe('Client');
    expect(result.current.analysisContext).toBe('');
    expect(result.current.familyGraph.members).toHaveLength(0);
    expect(result.current.familyGraph.relationships).toHaveLength(0);
    expect(result.current.files).toHaveLength(0);
    expect(result.current.report).toBeNull();
    expect(result.current.error).toBe('');
    expect(result.current.selectedIndex).toBe(-1);
  });

  it('returns the pipeline to idle and clears busy flags', () => {
    const { result } = setup();
    act(() => {
      result.current.resetForNewClient();
    });
    expect(result.current.pipeline).toEqual({
      stage: 'idle',
      percent: 0,
      message: '',
    });
    expect(result.current.isAnalyzing).toBeNull();
    expect(result.current.isTranslating).toBeNull();
    expect(result.current.isGeneratingReport).toBe(false);
    expect(result.current.isPdfExtracting).toBe(false);
    expect(result.current.discrepancyCheck.isChecking).toBe(false);
  });

  it('preserves the Family Mode toggle — a preference, not client data', () => {
    const { result } = setup();
    act(() => {
      result.current.toggleFamilyMode();
    });
    expect(result.current.familyModeEnabled).toBe(true);

    act(() => {
      result.current.resetForNewClient();
    });
    expect(result.current.familyModeEnabled).toBe(true);
  });

  it('is idempotent — resetting an already-clean session is a no-op', () => {
    const { result } = setup();
    act(() => {
      result.current.resetForNewClient();
      result.current.resetForNewClient();
    });
    expect(result.current.files).toHaveLength(0);
    expect(result.current.clientName).toBe('Client');
  });
});
