'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  can,
  type Competitor,
  type CreateProjectInput,
  type CreditLedgerEntry,
  type CreditsOverview,
  type Invitation,
  type Job,
  type Me,
  type Member,
  type Paginated,
  type Permission,
  type Project,
  type Role,
  type UpdateProjectInput,
} from '@seo/shared';
import { api } from './api';

export const qk = {
  me: ['me'] as const,
  projects: ['projects'] as const,
  competitors: (projectId: string) => ['projects', projectId, 'competitors'] as const,
  members: ['organization', 'members'] as const,
  invitations: ['organization', 'invitations'] as const,
  credits: ['credits'] as const,
  ledger: (page: number) => ['credits', 'ledger', page] as const,
  job: (id: string) => ['jobs', id] as const,
};

export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: () => api<Me>('/me'), staleTime: 30_000 });
}

/** Permission check against the active organization role (mirrors the API's rules). */
export function useCan() {
  const { data } = useMe();
  const role = data?.activeOrganization?.role as Role | undefined;
  return (permission: Permission) => can(role, permission);
}

export function useProjects(enabled = true) {
  return useQuery({ queryKey: qk.projects, queryFn: () => api<Project[]>('/projects'), enabled });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      api<Project>('/projects', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects }),
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProjectInput) =>
      api<Project>(`/projects/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects }),
  });
}

export function useCompetitors(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.competitors(projectId ?? ''),
    queryFn: () => api<Competitor[]>(`/projects/${projectId}/competitors`),
    enabled: !!projectId,
  });
}

export function useAddCompetitor(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (domain: string) =>
      api<Competitor>(`/projects/${projectId}/competitors`, { method: 'POST', body: { domain } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.competitors(projectId) }),
  });
}

export function useRemoveCompetitor(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (competitorId: string) =>
      api<void>(`/projects/${projectId}/competitors/${competitorId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.competitors(projectId) }),
  });
}

export function useMembers() {
  return useQuery({ queryKey: qk.members, queryFn: () => api<Member[]>('/organization/members') });
}

export function useInvitations(enabled: boolean) {
  return useQuery({
    queryKey: qk.invitations,
    queryFn: () => api<Invitation[]>('/organization/invitations'),
    enabled,
  });
}

export function useInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: Exclude<Role, 'owner'> }) =>
      api<Invitation>('/organization/invitations', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invitations }),
  });
}

export function useCancelInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/organization/invitations/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invitations }),
  });
}

export function useUpdateMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: Exclude<Role, 'owner'> }) =>
      api<void>(`/organization/members/${memberId}`, { method: 'PATCH', body: { role } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.members }),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) =>
      api<void>(`/organization/members/${memberId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.members }),
  });
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api<{ id: string; name: string; slug: string }>('/organizations', {
        method: 'POST',
        body: { name },
      }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useActivateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/organizations/${id}/activate`, { method: 'POST' }),
    // Everything is org-scoped: drop all cached data.
    onSuccess: () => qc.resetQueries(),
  });
}

export function useCredits() {
  return useQuery({ queryKey: qk.credits, queryFn: () => api<CreditsOverview>('/credits') });
}

export function useCreditLedger(page: number) {
  return useQuery({
    queryKey: qk.ledger(page),
    queryFn: () => api<Paginated<CreditLedgerEntry>>(`/credits/ledger?page=${page}&pageSize=20`),
  });
}

export function useStartDemoJob() {
  return useMutation({
    mutationFn: () => api<Job>('/jobs/demo', { method: 'POST', body: { steps: 10, delayMs: 300 } }),
  });
}
