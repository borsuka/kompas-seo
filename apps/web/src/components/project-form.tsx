'use client';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import {
  createProjectSchema,
  findLocation,
  LANGUAGES,
  LOCATIONS,
  normalizeDomain,
  type CreateProjectInput,
  type Device,
  type LanguageCode,
} from '@seo/shared';
import { Button } from '@seo/ui/button';
import { Input } from '@seo/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@seo/ui/select';
import { FormField } from '@/components/auth/auth-card';

export interface ProjectFormValues {
  name: string;
  domain: string;
  locationCode: number;
  languageCode: string;
  device: Device;
}

/** Create/edit form for a project (domain + default country, language and device). */
export function ProjectForm({
  initial,
  submitLabel,
  pending,
  disabled,
  onSubmit,
}: {
  initial?: Partial<ProjectFormValues>;
  submitLabel: string;
  pending?: boolean;
  disabled?: boolean;
  onSubmit: (values: CreateProjectInput) => void;
}) {
  const t = useTranslations();
  const [values, setValues] = useState<ProjectFormValues>({
    name: initial?.name ?? '',
    domain: initial?.domain ?? '',
    locationCode: initial?.locationCode ?? 2100,
    languageCode: initial?.languageCode ?? 'bg',
    device: initial?.device ?? 'desktop',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof ProjectFormValues>(key: K, value: ProjectFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = createProjectSchema.safeParse(values);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues)
        next[String(issue.path[0])] = t('errors.VALIDATION_FAILED');
      setErrors(next);
      return;
    }
    setErrors({});
    onSubmit(values as CreateProjectInput);
  }

  const normalized = values.domain ? normalizeDomain(values.domain) : null;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <fieldset disabled={disabled} className="space-y-4">
        <FormField id="project-domain" label={t('onboarding.domain')} error={errors.domain}>
          <Input
            id="project-domain"
            inputMode="url"
            autoComplete="url"
            placeholder={t('onboarding.domainPlaceholder')}
            value={values.domain}
            aria-invalid={!!errors.domain}
            onChange={(e) => {
              set('domain', e.target.value);
              if (!values.name || values.name === normalizeDomain(values.domain)) {
                set('name', normalizeDomain(e.target.value) ?? '');
              }
            }}
          />
        </FormField>
        {normalized && normalized !== values.domain.trim().toLowerCase() && (
          <p className="text-muted-foreground tabular -mt-2 text-xs">{normalized}</p>
        )}
        <FormField id="project-name" label={t('onboarding.projectName')} error={errors.name}>
          <Input
            id="project-name"
            value={values.name}
            aria-invalid={!!errors.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField id="project-country" label={t('onboarding.country')}>
            <Select
              value={String(values.locationCode)}
              onValueChange={(v) => {
                const loc = findLocation(Number(v));
                set('locationCode', Number(v));
                if (loc) set('languageCode', loc.defaultLanguage);
              }}
            >
              <SelectTrigger id="project-country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCATIONS.map((l) => (
                  <SelectItem key={l.code} value={String(l.code)}>
                    {t(`countries.${l.iso}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="project-language" label={t('onboarding.language')}>
            <Select
              value={values.languageCode}
              onValueChange={(v) => set('languageCode', v as LanguageCode)}
            >
              <SelectTrigger id="project-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {t(`languages.${l}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="project-device" label={t('onboarding.device')}>
            <Select value={values.device} onValueChange={(v) => set('device', v as Device)}>
              <SelectTrigger id="project-device">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desktop">{t('devices.desktop')}</SelectItem>
                <SelectItem value="mobile">{t('devices.mobile')}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? t('common.saving') : submitLabel}
        </Button>
      </fieldset>
    </form>
  );
}
