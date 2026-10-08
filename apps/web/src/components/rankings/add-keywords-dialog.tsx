'use client';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Device, Job } from '@seo/shared';
import { Button } from '@seo/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@seo/ui/dialog';
import { Input } from '@seo/ui/input';
import { toast } from '@seo/ui/sonner';
import { useAddTracked } from '@/lib/rankings-api';
import { useErrorMessage } from '@/lib/use-error-message';

const parse = (text: string, sep: RegExp) => [
  ...new Set(
    text
      .split(sep)
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];

export function AddKeywordsDialog({
  projectId,
  limit,
  defaultOpen = false,
  onStarted,
}: {
  projectId: string;
  limit: { used: number; max: number };
  defaultOpen?: boolean;
  /** Called with the first-check job of the new keywords. */
  onStarted?: (job: Job) => void;
}) {
  const t = useTranslations('rankings.add');
  const errorMessage = useErrorMessage();
  const add = useAddTracked(projectId);
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState('');
  const [devices, setDevices] = useState<Set<Device>>(new Set(['desktop']));
  const [tags, setTags] = useState('');

  const keywords = parse(text, /\n/);
  const rows = keywords.length * devices.size;
  const left = Math.max(0, limit.max - limit.used);

  const toggle = (d: Device) =>
    setDevices((s) => {
      const next = new Set(s);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  async function submit() {
    try {
      const res = await add.mutateAsync({
        keywords,
        devices: [...devices],
        tags: parse(tags, /,/),
      });
      toast.success(t('added', { added: res.added, skipped: res.skipped }));
      if (res.job) onStarted?.(res.job);
      setText('');
      setOpen(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden /> {t('open')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { left, max: limit.max })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block space-y-1.5 text-sm font-medium">
            {t('keywords')}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('keywordsPlaceholder')}
              rows={6}
              className="border-input bg-background focus-visible:ring-ring/40 w-full rounded-md border px-3 py-2 text-sm font-normal outline-none focus-visible:ring-2"
            />
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('devices')}</legend>
            <div className="flex gap-4">
              {(['desktop', 'mobile'] as const).map((d) => (
                <label key={d} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-primary)]"
                    checked={devices.has(d)}
                    onChange={() => toggle(d)}
                  />
                  {t(`device.${d}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block space-y-1.5 text-sm font-medium">
            {t('tags')}
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t('tagsPlaceholder')}
            />
          </label>
          <p className="text-muted-foreground text-xs" aria-live="polite">
            {rows > left ? t('overLimit', { rows, left }) : t('cost', { rows })}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={submit} disabled={add.isPending || rows === 0 || rows > left}>
            {t('submit', { count: rows })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
