'use client';
import { ListPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
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
import { useAddItems, useCreateList, useKeywordLists } from '@/lib/keywords-api';
import { useErrorMessage } from '@/lib/use-error-message';

/** Adds the selected keywords to an existing list or a new one (one click from any table). */
export function AddToListDialog({
  keywords,
  locationCode,
  languageCode,
  onDone,
}: {
  keywords: string[];
  locationCode: number;
  languageCode: string;
  onDone?: () => void;
}) {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [listId, setListId] = useState('');
  const [newName, setNewName] = useState('');
  const lists = useKeywordLists();
  const create = useCreateList();
  const add = useAddItems();
  // Lists are tied to a location: only offer compatible ones.
  const compatible = (lists.data ?? []).filter(
    (l) => l.locationCode === locationCode && l.languageCode === languageCode,
  );

  async function submit() {
    try {
      let target = listId;
      if (!target) {
        const created = await create.mutateAsync({
          name: newName.trim(),
          locationCode: locationCode as 2100,
          languageCode: languageCode as 'bg',
        });
        target = created.id;
      }
      const res = await add.mutateAsync({ listId: target, keywords });
      toast.success(t('keywords.lists.added', { added: res.added, skipped: res.skipped }));
      setOpen(false);
      setNewName('');
      onDone?.();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const pending = create.isPending || add.isPending;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={!keywords.length}>
          <ListPlus aria-hidden /> {t('keywords.addToList')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('keywords.addToList')}</DialogTitle>
          <DialogDescription>
            {t('keywords.selected', { count: keywords.length })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {compatible.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('keywords.lists.chooseList')}</legend>
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {compatible.map((l) => (
                  <label
                    key={l.id}
                    className="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                  >
                    <input
                      type="radio"
                      name="list"
                      className="accent-[var(--color-primary)]"
                      checked={listId === l.id}
                      onChange={() => setListId(l.id)}
                    />
                    <span className="flex-1 truncate">{l.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {t('keywords.lists.items', { count: l.itemCount })}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className="block space-y-1.5 text-sm font-medium">
            {compatible.length > 0 ? t('keywords.lists.orCreate') : t('keywords.lists.name')}
            <Input
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (e.target.value) setListId('');
              }}
              placeholder={t('keywords.lists.name')}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={pending || (!listId && !newName.trim())}>
            {t('keywords.lists.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
