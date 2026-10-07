import { Compass } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export function Logo({ href = '/' }: { href?: string }) {
  const t = useTranslations('common');
  return (
    <Link href={href} className="flex items-center gap-2 rounded-md font-semibold tracking-tight">
      <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md">
        <Compass className="size-4" aria-hidden />
      </span>
      <span>{t('appName')}</span>
    </Link>
  );
}
