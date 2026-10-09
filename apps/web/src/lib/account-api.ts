'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiKey, BillingOverview, CreateApiKeyInput, CreatedApiKey } from '@seo/shared';
import { api, ApiError } from './api';

export const ak = {
  apiKeys: ['organization', 'api-keys'] as const,
  billing: ['billing'] as const,
  deletionCheck: ['me', 'deletion-check'] as const,
};

// ------------------------------------------------------------------ API keys

export function useApiKeys(enabled: boolean) {
  return useQuery({
    queryKey: ak.apiKeys,
    queryFn: () => api<ApiKey[]>('/organization/api-keys'),
    enabled,
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiKeyInput) =>
      api<CreatedApiKey>('/organization/api-keys', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ak.apiKeys }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/organization/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ak.apiKeys }),
  });
}

// ------------------------------------------------------------------- billing

export function useBilling() {
  return useQuery({ queryKey: ak.billing, queryFn: () => api<BillingOverview>('/billing') });
}

/** Both return a Stripe-hosted URL to send the browser to. */
export function useCheckout() {
  return useMutation({
    mutationFn: (plan: 'pro' | 'agency') =>
      api<{ url: string }>('/billing/checkout', { method: 'POST', body: { plan } }),
  });
}

export function usePortal() {
  return useMutation({
    mutationFn: () => api<{ url: string }>('/billing/portal', { method: 'POST', body: {} }),
  });
}

// ------------------------------------------------------------------- privacy

export const accountExportUrl = '/api/v1/me/export';
export const organizationExportUrl = '/api/v1/organization/export';

export function useDeletionCheck(enabled: boolean) {
  return useQuery({
    queryKey: ak.deletionCheck,
    queryFn: () =>
      api<{
        mustTransfer: { id: string; name: string }[];
        deletedWithAccount: { id: string; name: string }[];
      }>('/me/deletion-check'),
    enabled,
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: (confirmEmail: string) =>
      api<void>('/me/delete', { method: 'POST', body: { confirmEmail } }),
  });
}

export function useDeleteOrganization() {
  return useMutation({
    mutationFn: (confirmName: string) =>
      api<void>('/organization/delete', { method: 'POST', body: { confirmName } }),
  });
}

// ------------------------------------------------------------------- reports

export const domainReportUrl = (p: Record<string, string | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) q.set(k, v);
  return `/api/v1/reports/domain.pdf?${q.toString()}`;
};

/**
 * Downloads a generated file (reports can take a few seconds and may fail with an API error,
 * which a plain link would save as a JSON file).
 */
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      code?: ApiError['code'];
      message?: string;
      details?: unknown;
    } | null;
    throw new ApiError(res.status, body?.code ?? 'INTERNAL', body?.message ?? '', body?.details);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1];
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = href;
  a.download = name ?? fallbackName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
