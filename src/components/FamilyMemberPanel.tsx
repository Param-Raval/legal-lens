'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Users,
  UserPlus,
  X,
  Plus,
  Loader2,
  ChevronDown,
  ChevronRight,
  GitBranch,
  CheckCircle2,
  Pencil,
  ShieldCheck,
} from 'lucide-react';
import type { FamilyMember, FamilyGraph, FamilyRelationship, FileInfo } from '@/types';
import { getMemberColorClasses } from '@/lib/utils';

interface FamilyMemberPanelProps {
  files: FileInfo[];
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

const RELATIONSHIP_TYPES = [
  'spouse of',
  'parent of',
  'child of',
  'sibling of',
  'guardian of',
  'dependent of',
  'other',
];

export const FamilyMemberPanel = ({
  files,
  familyModeEnabled,
  familyGraph,
  isInferringRelationships,
  inferStatus,
  onToggleFamilyMode,
  onAddMember,
  onRemoveMember,
  onRemoveRelationship,
  onUpdateRelationship,
  onAddRelationship,
  onInferRelationships,
  onClearInferStatus,
}: FamilyMemberPanelProps) => {
  const [showMembers, setShowMembers] = useState(true);
  const [showRelationships, setShowRelationships] = useState(true);

  // Add member form
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('');
  const [showAddMember, setShowAddMember] = useState(false);

  // Add relationship form
  const [relFromId, setRelFromId] = useState('');
  const [relToId, setRelToId] = useState('');
  const [relType, setRelType] = useState(RELATIONSHIP_TYPES[0]);
  const [relTypeCustom, setRelTypeCustom] = useState('');

  // Inline edit state for an existing relationship
  const [editingRelIdx, setEditingRelIdx] = useState<number | null>(null);
  const [editRelType, setEditRelType] = useState('');

  const members = familyGraph.members;
  const relationships = familyGraph.relationships;

  // Count documents (PDFs counted once) assigned per member
  const docCountByMember = new Map<string, number>();
  for (const f of files) {
    if (!f.familyMemberId) continue;
    if (f.pdfPageNumber !== undefined && f.pdfPageNumber > 1) continue;
    docCountByMember.set(f.familyMemberId, (docCountByMember.get(f.familyMemberId) ?? 0) + 1);
  }

  const analyzedCount = files.filter(f => f.analysis).length;

  const getMemberName = (id: string) => members.find(m => m.id === id)?.name ?? id;

  // â”€â”€ Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const handleAddMember = () => {
    const name = newMemberName.trim();
    if (!name) return;
    onAddMember(name, newMemberRole.trim() || undefined);
    setNewMemberName('');
    setNewMemberRole('');
    setShowAddMember(false);
  };

  const handleAddRelationship = () => {
    if (!relFromId || !relToId || relFromId === relToId) return;
    const type = relType === 'other' ? relTypeCustom.trim() : relType;
    if (!type) return;
    onAddRelationship(relFromId, relToId, type);
    setRelFromId('');
    setRelToId('');
    setRelType(RELATIONSHIP_TYPES[0]);
    setRelTypeCustom('');
  };

  const startEditRelationship = (idx: number) => {
    setEditingRelIdx(idx);
    setEditRelType(relationships[idx].relationshipType);
  };

  const commitEditRelationship = (r: FamilyRelationship, idx: number) => {
    const newType = editRelType.trim();
    if (newType && newType !== r.relationshipType) {
      onUpdateRelationship(r.fromId, r.toId, r.confidence, { relationshipType: newType });
    }
    setEditingRelIdx(null);
  };

  const promoteRelationship = (r: FamilyRelationship) => {
    onUpdateRelationship(r.fromId, r.toId, r.confidence, { confidence: 'declared' });
  };

  // â”€â”€ Confidence badge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const confidenceBadge = (r: FamilyRelationship, compact = false) => {
    if (r.confidence === 'declared') {
      return compact ? null : (
        <Badge variant="outline" className="text-[10px] px-1 py-0 bg-green-100 text-green-700 border-green-200">
          Declared
        </Badge>
      );
    }
    const cls =
      r.confidence === 'inferred'
        ? 'bg-blue-100 text-blue-700 border-blue-200'
        : 'bg-amber-100 text-amber-700 border-amber-200';
    return (
      <Badge variant="outline" className={`text-[10px] px-1 py-0 ${cls}`}>
        {r.confidence === 'inferred' ? 'Inferred' : 'Unsure'}
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center space-x-2">
            <Users className="h-5 w-5" />
            <span>Family Mode</span>
            {familyModeEnabled && members.length > 0 && (
              <Badge variant="outline" className="ml-1 text-xs bg-purple-100 text-purple-800 border-purple-200">
                {members.length} member{members.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </CardTitle>
          {/* Toggle switch */}
          <button
            onClick={onToggleFamilyMode}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              familyModeEnabled ? 'bg-primary' : 'bg-muted-foreground/30'
            }`}
            role="switch"
            aria-checked={familyModeEnabled}
            title={familyModeEnabled ? 'Disable family mode' : 'Enable family mode'}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                familyModeEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {!familyModeEnabled && (
          <p className="text-xs text-muted-foreground mt-1">
            Enable to assign documents to family members and detect cross-person shared-field inconsistencies.
          </p>
        )}
      </CardHeader>

      {familyModeEnabled && (
        <CardContent className="space-y-4 pt-0">

          {/* â”€â”€ Members â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          <div>
            <button
              onClick={() => setShowMembers(p => !p)}
              className="flex items-center space-x-1 text-sm font-medium w-full text-left py-1 hover:text-primary transition-colors"
            >
              {showMembers ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <span>Family Members</span>
              <span className="text-muted-foreground font-normal ml-1">({members.length})</span>
            </button>

            {showMembers && (
              <div className="mt-2 space-y-1">
                {members.length === 0 && (
                  <p className="text-xs text-muted-foreground pl-4 italic">
                    No members added yet. Add members below to assign documents.
                  </p>
                )}
                {members.map(m => {
                  const colors = getMemberColorClasses(m.color);
                  const docCount = docCountByMember.get(m.id) ?? 0;
                  return (
                    <div
                      key={m.id}
                      className="flex items-center justify-between pl-4 pr-1 py-1.5 rounded-md hover:bg-muted/30"
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${colors.dot}`} />
                        <span className="text-sm font-medium truncate">{m.name}</span>
                        {m.role && (
                          <span className="text-xs text-muted-foreground truncate">Â· {m.role}</span>
                        )}
                        {docCount > 0 && (
                          <Badge variant="outline" className={`text-[10px] px-1 py-0 shrink-0 ${colors.bg} ${colors.text} ${colors.border}`}>
                            {docCount} doc{docCount !== 1 ? 's' : ''}
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => onRemoveMember(m.id)}
                        title={`Remove ${m.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}

                {/* Add member form */}
                {showAddMember ? (
                  <div className="mt-2 pl-4 space-y-2">
                    <input
                      autoFocus
                      type="text"
                      placeholder="Full name *"
                      value={newMemberName}
                      onChange={e => setNewMemberName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddMember()}
                      className="w-full border rounded px-2 py-1 text-sm bg-background"
                    />
                    <input
                      type="text"
                      placeholder="Role (e.g. Principal Applicant, Spouse)"
                      value={newMemberRole}
                      onChange={e => setNewMemberRole(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddMember()}
                      className="w-full border rounded px-2 py-1 text-sm bg-background"
                    />
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={handleAddMember} className="h-7 px-3 text-xs">Add</Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setShowAddMember(false); setNewMemberName(''); setNewMemberRole(''); }}
                        className="h-7 px-3 text-xs"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddMember(true)}
                    className="mt-1 ml-4 h-7 px-3 text-xs"
                  >
                    <UserPlus className="h-3.5 w-3.5 mr-1" />
                    Add Member
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* â”€â”€ Relationships â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          {members.length >= 2 && (
            <div>
              <button
                onClick={() => setShowRelationships(p => !p)}
                className="flex items-center space-x-1 text-sm font-medium w-full text-left py-1 hover:text-primary transition-colors"
              >
                {showRelationships ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <span>Relationships</span>
                <span className="text-muted-foreground font-normal ml-1">({relationships.length})</span>
              </button>

              {showRelationships && (
                <div className="mt-2 space-y-2 pl-4">

                  {relationships.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">
                      No relationships yet â€” add them manually or use &ldquo;Infer&rdquo; below.
                    </p>
                  )}

                  {/* Relationship rows */}
                  {relationships.map((r, i) => (
                    <div key={i} className="rounded-md border px-2 py-1.5 text-xs bg-muted/20 space-y-1">
                      <div className="flex items-start justify-between gap-1">
                        <div className="flex items-center flex-wrap gap-1 flex-1 min-w-0">
                          <span className="font-medium">{getMemberName(r.fromId)}</span>
                          <span className="text-muted-foreground">is</span>

                          {/* Editable type */}
                          {editingRelIdx === i ? (
                            <input
                              autoFocus
                              type="text"
                              value={editRelType}
                              onChange={e => setEditRelType(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') commitEditRelationship(r, i);
                                if (e.key === 'Escape') setEditingRelIdx(null);
                              }}
                              onBlur={() => commitEditRelationship(r, i)}
                              className="border rounded px-1 py-0 text-xs bg-background w-28"
                            />
                          ) : (
                            <span className="font-medium">{r.relationshipType}</span>
                          )}

                          <span className="text-muted-foreground">of</span>
                          <span className="font-medium">{getMemberName(r.toId)}</span>
                          {confidenceBadge(r)}
                        </div>

                        {/* Row actions */}
                        <div className="flex items-center gap-0.5 shrink-0">
                          {editingRelIdx !== i && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0 text-muted-foreground hover:text-primary"
                              onClick={() => startEditRelationship(i)}
                              title="Edit relationship type"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          )}
                          {r.confidence !== 'declared' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0 text-muted-foreground hover:text-green-700"
                              onClick={() => promoteRelationship(r)}
                              title="Promote to Declared (confirm this relationship)"
                            >
                              <ShieldCheck className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => onRemoveRelationship(r.fromId, r.toId, r.confidence)}
                            title="Remove"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      {/* Reasoning from AI (if any) */}
                      {r.reasoning && r.confidence !== 'declared' && (
                        <p className="text-[10px] text-muted-foreground italic pl-0.5 border-l-2 border-muted ml-1 pl-2">
                          {r.reasoning}
                        </p>
                      )}
                    </div>
                  ))}

                  {/* Add relationship form */}
                  <div className="pt-2 space-y-2 border-t mt-1">
                    <p className="text-xs text-muted-foreground font-medium">Add manually:</p>
                    <div className="flex flex-wrap items-center gap-1">
                      <select
                        value={relFromId}
                        onChange={e => setRelFromId(e.target.value)}
                        className="border rounded px-1.5 py-1 bg-background text-xs"
                      >
                        <option value="">Person A</option>
                        {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                      <span className="text-muted-foreground text-xs">is</span>
                      <select
                        value={relType}
                        onChange={e => setRelType(e.target.value)}
                        className="border rounded px-1.5 py-1 bg-background text-xs"
                      >
                        {RELATIONSHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      {relType === 'other' && (
                        <input
                          type="text"
                          placeholder="typeâ€¦"
                          value={relTypeCustom}
                          onChange={e => setRelTypeCustom(e.target.value)}
                          className="border rounded px-1.5 py-1 bg-background text-xs w-24"
                        />
                      )}
                      <span className="text-muted-foreground text-xs">of</span>
                      <select
                        value={relToId}
                        onChange={e => setRelToId(e.target.value)}
                        className="border rounded px-1.5 py-1 bg-background text-xs"
                      >
                        <option value="">Person B</option>
                        {members.filter(m => m.id !== relFromId).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                      <Button
                        size="sm"
                        onClick={handleAddRelationship}
                        disabled={!relFromId || !relToId || relFromId === relToId}
                        className="h-7 px-2 text-xs"
                        title="Add declared relationship"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* â”€â”€ Infer from Documents â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
                  <div className="pt-2 border-t mt-1 space-y-2">
                    {/* Prerequisites hint */}
                    {analyzedCount === 0 && (
                      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                        Run OCR on at least one document first, then the AI can infer relationships from the text.
                      </p>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { onClearInferStatus(); onInferRelationships(); }}
                      disabled={isInferringRelationships || analyzedCount === 0}
                      className="h-7 px-3 text-xs w-full"
                    >
                      {isInferringRelationships ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                          Inferring from documentsâ€¦
                        </>
                      ) : (
                        <>
                          <GitBranch className="h-3.5 w-3.5 mr-1.5" />
                          Infer Relationships from Documents
                        </>
                      )}
                    </Button>

                    {/* Inline status (success or error) */}
                    {inferStatus && (
                      <div
                        className={`flex items-start gap-1.5 text-[11px] rounded px-2 py-1.5 border ${
                          inferStatus.type === 'success'
                            ? 'bg-green-50 text-green-800 border-green-200'
                            : 'bg-red-50 text-red-800 border-red-200'
                        }`}
                      >
                        {inferStatus.type === 'success' ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-px" />
                        ) : (
                          <X className="h-3.5 w-3.5 shrink-0 mt-px" />
                        )}
                        <span className="flex-1">{inferStatus.message}</span>
                        <button
                          onClick={onClearInferStatus}
                          className="shrink-0 opacity-60 hover:opacity-100"
                          title="Dismiss"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )}

                    {relationships.some(r => r.confidence !== 'declared') && (
                      <p className="text-[11px] text-muted-foreground italic">
                        Click <ShieldCheck className="inline h-3 w-3" /> on any inferred relationship to confirm it as declared.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Unassigned warning */}
          {members.length > 0 && (() => {
            const unassignedGroups = new Set<string>();
            for (const f of files) {
              if (!f.familyMemberId) unassignedGroups.add(f.pdfSourceId ?? f.id);
            }
            if (unassignedGroups.size === 0) return null;
            return (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                <strong>{unassignedGroups.size}</strong> document{unassignedGroups.size !== 1 ? 's are' : ' is'} not assigned to any family member. Use the dropdowns in the Files list above to assign them.
              </p>
            );
          })()}
        </CardContent>
      )}
    </Card>
  );
};
