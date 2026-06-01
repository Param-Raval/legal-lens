'use client';

import type { FamilyMember, FamilyRelationship } from '@/types';
import { getMemberColorClasses } from '@/lib/utils';

interface FamilyTreeProps {
  members: FamilyMember[];
  relationships: FamilyRelationship[];
}

function getMemberInitials(name: string): string {
  return name
    .split(' ')
    .map(w => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function getRelLabel(rel: FamilyRelationship, perspectiveMemberId: string): string {
  // Guard against a missing/non-string relationshipType from unvalidated data.
  const relType = rel.relationshipType ?? 'related to';
  if (rel.fromId === perspectiveMemberId) return relType;
  // Reverse the relationship label when the member is the "to" side
  const rt = relType.toLowerCase();
  if (rt.includes('parent of')) return 'child of';
  if (rt.includes('child of')) return 'parent of';
  if (rt.includes('spouse of')) return 'spouse of';
  if (rt.includes('sibling of')) return 'sibling of';
  return relType;
}

/**
 * Visual CSS family tree showing members as colour-coded cards with
 * relationship badges. Declared relationships have solid styling;
 * inferred/unsure use a dashed border.
 */
export function FamilyTree({ members, relationships }: FamilyTreeProps) {
  if (members.length === 0) return null;

  const memberById = new Map(members.map(m => [m.id, m]));
  const relKey = (r: FamilyRelationship) => {
    const a = String(r.fromId ?? '');
    const b = String(r.toId ?? '');
    const dir = a < b ? `${a}|${b}` : `${b}|${a}`;
    return `${dir}|${String(r.relationshipType ?? '').trim().toLowerCase()}`;
  };

  return (
    <div className="w-full">
      <div className="flex flex-wrap gap-4 justify-center items-start py-2">
        {members.map((m, i) => {
          const colors = getMemberColorClasses(m.color);
          const memberRels = relationships
            .filter(r => r.fromId === m.id || r.toId === m.id)
            .filter((r, idx, arr) =>
              arr.findIndex(x => relKey(x) === relKey(r)) === idx
            )
            .filter((r, idx, arr) => {
              const otherId = r.fromId === m.id ? r.toId : r.fromId;
              const label = getRelLabel(r, m.id).toLowerCase().trim();
              const dedupeKey = `${otherId}|${label}`;
              return (
                arr.findIndex(x => {
                  const xOtherId = x.fromId === m.id ? x.toId : x.fromId;
                  const xLabel = getRelLabel(x, m.id).toLowerCase().trim();
                  return `${xOtherId}|${xLabel}` === dedupeKey;
                }) === idx
              );
            });

          return (
            <div
              key={m.id ?? m.name ?? i}
              className={`relative min-w-[130px] max-w-[160px] rounded-xl border-2 p-3 text-center shadow-sm transition-shadow hover:shadow-md ${colors.bg} ${colors.text} ${colors.border}`}
            >
              {/* Avatar */}
              <div
                className={`w-10 h-10 rounded-full mx-auto mb-2 flex items-center justify-center text-sm font-bold text-white ${colors.dot}`}
              >
                {getMemberInitials(m.name)}
              </div>

              {/* Name & role */}
              <p className="font-semibold text-sm leading-tight">{m.name}</p>
              {m.role && (
                <p className="text-[11px] opacity-70 mt-0.5">{m.role}</p>
              )}

              {/* Relationship badges */}
              {memberRels.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {memberRels.map((r, i) => {
                    const otherId = r.fromId === m.id ? r.toId : r.fromId;
                    const other = memberById.get(otherId);
                    if (!other) return null;
                    const label = getRelLabel(r, m.id);
                    const isDeclared = r.confidence === 'declared';
                    return (
                      <span
                        key={i}
                        className={`text-[10px] px-1.5 py-0.5 rounded-full border leading-tight ${
                          isDeclared
                            ? 'bg-white/50 border-current'
                            : 'bg-white/20 border-dashed border-current'
                        }`}
                        title={r.reasoning ?? undefined}
                      >
                        {label}{' '}
                        <strong>{other.name.split(' ')[0]}</strong>
                        {!isDeclared && (
                          <span className="opacity-60"> ({r.confidence})</span>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
