'use client';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button } from '@seo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@seo/ui/card';
import { Input } from '@seo/ui/input';
import { FormField, FormMessage } from '@/components/auth/auth-card';
import { useRouter } from '@/i18n/navigation';
import { useCreateOrganization } from '@/lib/queries';
import { useErrorMessage } from '@/lib/use-error-message';

export function OrganizationSettings() {
  const t = useTranslations();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const create = useCreateOrganization();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync(name.trim());
      // The new organization is active and has no project yet.
      router.push('/onboarding');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('settings.organization.title')}</h2>
        </CardTitle>
        <CardDescription>{t('settings.organization.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="max-w-md space-y-4">
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <FormField id="new-org" label={t('onboarding.orgName')}>
            <Input id="new-org" value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            {t('settings.organization.create')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
