'use client';
import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@seo/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@seo/ui/dialog';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Logo } from '@/components/logo';
import { ErrorState, PageSkeleton } from '@/components/states';
import { ThemeToggle } from '@/components/theme-toggle';
import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { useActivateOrganization, useMe, useProjects } from '@/lib/queries';
import { CreditsBadge } from './credits-badge';
import { GlobalSearch } from './global-search';
import { ProjectProvider } from './project-context';
import { SidebarNav } from './sidebar-nav';
import { OrgSwitcher, ProjectSwitcher } from './switchers';
import { UserMenu } from './user-menu';

const isUnauthenticated = (err: unknown) => err instanceof ApiError && err.status === 401;

/**
 * Authenticated application frame. Guarantees children an active organization and
 * at least one project (otherwise sends the user to onboarding).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const router = useRouter();
  const me = useMe();
  const activate = useActivateOrganization();
  const active = me.data?.activeOrganization ?? null;
  const projects = useProjects(!!active);
  const [mobileOpen, setMobileOpen] = useState(false);

  const firstOrgId = me.data?.organizations[0]?.id;
  const { mutate: activateOrg, isPending: activating } = activate;
  useEffect(() => {
    if (isUnauthenticated(me.error)) {
      window.location.assign(
        window.location.pathname.startsWith('/en') ? '/en/sign-in' : '/sign-in',
      );
      return;
    }
    if (!me.data || active) return;
    if (firstOrgId) {
      if (!activating) activateOrg(firstOrgId);
    } else {
      router.replace('/onboarding');
    }
  }, [me.data, me.error, active, firstOrgId, activating, activateOrg, router]);

  useEffect(() => {
    if (projects.data && projects.data.length === 0) router.replace('/onboarding');
  }, [projects.data, router]);

  const ready = !!(me.data && active && projects.data && projects.data.length > 0);

  let content: ReactNode;
  if (me.error && !isUnauthenticated(me.error)) {
    content = <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  } else if (projects.error) {
    content = <ErrorState error={projects.error} onRetry={() => projects.refetch()} />;
  } else {
    content = ready ? children : <PageSkeleton />;
  }

  const frame = (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="border-border bg-background/95 sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 backdrop-blur sm:px-4">
        <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label={t('nav.openMenu')}
            >
              <Menu aria-hidden />
            </Button>
          </DialogTrigger>
          <DialogContent side="left" closeLabel={t('common.close')} aria-describedby={undefined}>
            <DialogTitle className="sr-only">{t('nav.mainNavigation')}</DialogTitle>
            <div className="flex h-14 items-center px-4">
              <Logo href="/app" />
            </div>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </DialogContent>
        </Dialog>

        {ready && me.data && (
          <div className="hidden items-center gap-1 md:flex">
            <OrgSwitcher me={me.data} />
            <ProjectSwitcher />
          </div>
        )}
        <div className="flex flex-1 justify-center px-2">
          <GlobalSearch />
        </div>
        <div className="flex items-center gap-1">
          {active && <CreditsBadge balance={active.creditBalance} />}
          <Suspense>
            <LocaleSwitcher />
          </Suspense>
          <ThemeToggle />
          {me.data && <UserMenu me={me.data} />}
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {content}
      </main>
    </div>
  );

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="bg-background sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        {t('common.skipToContent')}
      </a>
      <aside className="border-border bg-sidebar sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r lg:flex">
        <div className="flex h-14 items-center px-4">
          <Logo href="/app" />
        </div>
        <SidebarNav />
      </aside>
      {ready && active && projects.data ? (
        <ProjectProvider key={active.id} orgId={active.id} projects={projects.data}>
          {frame}
        </ProjectProvider>
      ) : (
        frame
      )}
    </div>
  );
}
