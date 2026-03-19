'use client';

import { useCallback, useEffect, useState } from 'react';
import { Settings, Check, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';

type Provider = 'openai' | 'ollama';

interface FormState {
  AI_PROVIDER: Provider;
  GPT4O_ENDPOINT: string;
  GPT4O_API_KEY: string;
  GPT4O_DEPLOYMENT: string;
  OLLAMA_BASE_URL: string;
  OLLAMA_MODEL: string;
}

const DEFAULTS: FormState = {
  AI_PROVIDER: 'openai',
  GPT4O_ENDPOINT: '',
  GPT4O_API_KEY: '',
  GPT4O_DEPLOYMENT: 'gpt-4o',
  OLLAMA_BASE_URL: 'http://localhost:11434',
  OLLAMA_MODEL: 'qwen2.5vl',
};

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('Failed to load settings');
      const { settings } = await res.json();
      setForm({
        AI_PROVIDER: (settings.AI_PROVIDER || 'openai') as Provider,
        GPT4O_ENDPOINT: settings.GPT4O_ENDPOINT || '',
        GPT4O_API_KEY: settings.GPT4O_API_KEY || '',
        GPT4O_DEPLOYMENT: settings.GPT4O_DEPLOYMENT || 'gpt-4o',
        OLLAMA_BASE_URL: settings.OLLAMA_BASE_URL || 'http://localhost:11434',
        OLLAMA_MODEL: settings.OLLAMA_MODEL || 'qwen2.5vl',
      });
    } catch {
      setError('Could not load settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed to save');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof FormState, value: string) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const inputCls =
    'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';
  const labelCls = 'block text-sm font-medium text-foreground mb-1';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 w-9 p-0"
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure your AI provider and API keys.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Provider selector */}
            <div>
              <label className={labelCls}>AI Provider</label>
              <select
                value={form.AI_PROVIDER}
                onChange={e => update('AI_PROVIDER', e.target.value)}
                className={inputCls}
              >
                <option value="openai">Azure OpenAI (GPT-4o)</option>
                <option value="ollama">Ollama (Local)</option>
              </select>
            </div>

            {/* OpenAI fields */}
            {form.AI_PROVIDER === 'openai' && (
              <fieldset className="space-y-3 rounded-md border border-border p-4">
                <legend className="text-sm font-semibold px-1">
                  Azure OpenAI
                </legend>

                <div>
                  <label className={labelCls}>Endpoint URL</label>
                  <input
                    type="url"
                    value={form.GPT4O_ENDPOINT}
                    onChange={e => update('GPT4O_ENDPOINT', e.target.value)}
                    placeholder="https://your-resource.cognitiveservices.azure.com/openai/v1/"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>API Key</label>
                  <input
                    type="password"
                    value={form.GPT4O_API_KEY}
                    onChange={e => update('GPT4O_API_KEY', e.target.value)}
                    placeholder="Enter your Azure OpenAI API key"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Deployment Name</label>
                  <input
                    type="text"
                    value={form.GPT4O_DEPLOYMENT}
                    onChange={e => update('GPT4O_DEPLOYMENT', e.target.value)}
                    placeholder="gpt-4o"
                    className={inputCls}
                  />
                </div>
              </fieldset>
            )}

            {/* Ollama fields */}
            {form.AI_PROVIDER === 'ollama' && (
              <fieldset className="space-y-3 rounded-md border border-border p-4">
                <legend className="text-sm font-semibold px-1">Ollama</legend>

                <div>
                  <label className={labelCls}>Base URL</label>
                  <input
                    type="url"
                    value={form.OLLAMA_BASE_URL}
                    onChange={e => update('OLLAMA_BASE_URL', e.target.value)}
                    placeholder="http://localhost:11434"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Vision Model</label>
                  <input
                    type="text"
                    value={form.OLLAMA_MODEL}
                    onChange={e => update('OLLAMA_MODEL', e.target.value)}
                    placeholder="qwen2.5vl"
                    className={inputCls}
                  />
                </div>
              </fieldset>
            )}

            {/* Error / success */}
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : saved ? (
              <Check className="h-4 w-4 mr-2" />
            ) : null}
            {saved ? 'Saved' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
