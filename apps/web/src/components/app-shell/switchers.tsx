'use client';
import { Building2, ChevronsUpDown, FolderGit2, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Me } from '@seo/shared';
import { Button } from '@seo/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@seo/ui/dropdown-menu';
import { useRouter } from '@/i18n/navigation';
import { useActivateOrganization, useCan } from '@/lib/queries';
import { useCurrentProject } from './project-context';

export function OrgSwitcher({ me }: { me: Me }) {
  const t = useTranslations('shell');
  const router = useRouter();
  const activate = useActivateOrganization();
  const active = me.activeOrganization;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="max-w-56 justify-between gap-2 px-2"
          aria-label={t('switchOrganization')}
        >
          <Building2 className="text-muted-foreground" aria-hidden />
          <span className="truncate">{active?.name}</span>
          <ChevronsUpDown className="text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{t('organization')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={active?.id}
          onValueChange={(id) => activate.mutate(id, { onSuccess: () => router.refresh() })}
        >
          {me.organizations.map((o) => (
            <DropdownMenuRadioItem key={o.id} value={o.id}>
              <span className="truncate">{o.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/app/settings?tab=organization')}>
          <Plus aria-hidden /> {t('newOrganization')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectSwitcher() {
  const t = useTranslations('shell');
  const router = useRouter();
  const can = useCan();
  const { projects, current, select } = useCurrentProject();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="max-w-56 justify-between gap-2 px-2"
          aria-label={t('project')}
        >
          <FolderGit2 className="text-muted-foreground" aria-hidden />
          <span className="truncate">{current?.domain ?? t('noProject')}</span>
          <ChevronsUpDown className="text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{t('project')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current?.id} onValueChange={select}>
          {projects.map((p) => (
            <DropdownMenuRadioItem key={p.id} value={p.id}>
              <span className="truncate">{p.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {can('project:create') && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push('/app/settings?tab=project&new=1')}>
              <Plus aria-hidden /> {t('newProject')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
