'use client';
import { useEffect, useState } from 'react';
import type { JobEvent } from '@seo/shared';
import { api } from './api';
import type { Job } from '@seo/shared';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/**
 * Live progress of a background job: Server-Sent Events with a polling fallback
 * (e.g. when a proxy buffers the event stream).
 */
export function useJobProgress(jobId: string | null) {
  const [event, setEvent] = useState<JobEvent | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let closed = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (closed) return;
      try {
        const job = await api<Job>(`/jobs/${jobId}`);
        setEvent({
          jobId,
          status: job.status,
          progress: job.progress,
          message: job.message ?? undefined,
          error: job.error ?? undefined,
        });
        if (TERMINAL.has(job.status)) return;
      } catch {
        // keep polling
      }
      pollTimer = setTimeout(poll, 1500);
    };

    const source = new EventSource(`/api/v1/jobs/${jobId}/events`);
    source.onmessage = (msg) => {
      const data = JSON.parse(msg.data as string) as JobEvent;
      setEvent(data);
      if (TERMINAL.has(data.status)) source.close();
    };
    source.onerror = () => {
      source.close();
      void poll();
    };

    return () => {
      closed = true;
      source.close();
      clearTimeout(pollTimer);
    };
  }, [jobId]);

  return event;
}
