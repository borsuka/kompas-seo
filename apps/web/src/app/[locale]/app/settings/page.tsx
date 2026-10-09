'use client';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@seo/ui/tabs';
import { PageHeader } from '@/components/page-header';
import { usePathname, useRouter } from '@/i18n/navigation';
import { ApiKeysSettings } from './api-keys-settings';
import { BillingSettings } from './billing-settings';
import { CreditsSettings } from './credits-settings';
import { MembersSettings } from './members-settings';
import { OrganizationSettings } from './organization-settings';
import { PrivacySettings } from './privacy-settings';
import { ProjectSettings } from './project-settings';

const TABS = [
  'project',
  'members',
  'credits',
  'billing',
  'apiKeys',
  'organization',
  'privacy',
] as const;
type Tab = (typeof TABS)[number];

function Settings() {
  const t = useTranslations('settings');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : 'project';

  return (
    <>
      <PageHeader title={t('title')} />
      <Tabs
        value={tab}
        // Keep the tab in the URL so it can be linked and survives reloads.
        onValueChange={(v) => router.replace(`${pathname}?tab=${v}`)}
      >
        <TabsList className="max-w-full overflow-x-auto">
          {TABS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {t(`tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="project">
          <ProjectSettings showNew={params.get('new') === '1'} />
        </TabsContent>
        <TabsContent value="members">
          <MembersSettings />
        </TabsContent>
        <TabsContent value="credits">
          <CreditsSettings />
        </TabsContent>
        <TabsContent value="billing">
          <BillingSettings />
        </TabsContent>
        <TabsContent value="apiKeys">
          <ApiKeysSettings />
        </TabsContent>
        <TabsContent value="organization">
          <OrganizationSettings />
        </TabsContent>
        <TabsContent value="privacy">
          <PrivacySettings />
        </TabsContent>
      </Tabs>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <Settings />
    </Suspense>
  );
}
