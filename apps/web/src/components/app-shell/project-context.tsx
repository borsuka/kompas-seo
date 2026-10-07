'use client';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Project } from '@seo/shared';

interface ProjectContextValue {
  projects: Project[];
  current: Project | null;
  select: (id: string) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const storageKey = (orgId: string) => `kompas:project:${orgId}`;

/** Remembers the selected project per organization (per browser). */
export function ProjectProvider({
  orgId,
  projects,
  children,
}: {
  orgId: string;
  projects: Project[];
  children: ReactNode;
}) {
  // Mounted client-side only (after data loads) and keyed by org, so reading storage here is safe.
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(storageKey(orgId));
    } catch {
      return null;
    }
  });

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      try {
        localStorage.setItem(storageKey(orgId), id);
      } catch {
        // storage unavailable (private mode): selection lasts for this session only
      }
    },
    [orgId],
  );

  const value = useMemo(() => {
    const current = projects.find((p) => p.id === selectedId) ?? projects[0] ?? null;
    return { projects, current, select };
  }, [projects, selectedId, select]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useCurrentProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useCurrentProject must be used inside ProjectProvider');
  return ctx;
}
