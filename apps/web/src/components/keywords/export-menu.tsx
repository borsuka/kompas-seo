'use client';
import { Download } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@seo/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@seo/ui/dropdown-menu';
import { exportUrl } from '@/lib/keywords-api';

/** CSV/XLSX download of the current (filtered) table. */
export function ExportMenu({
  path,
  params,
}: {
  path: string;
  params: Record<string, string | undefined>;
}) {
  const t = useTranslations('keywords');
  const ui = useLocale();
  const href = (format: 'csv' | 'xlsx') =>
    exportUrl(path, { ...params, page: undefined, pageSize: undefined, format, ui });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Download aria-hidden /> {t('export')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={href('csv')} download>
            {t('exportCsv')}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={href('xlsx')} download>
            {t('exportXlsx')}
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
