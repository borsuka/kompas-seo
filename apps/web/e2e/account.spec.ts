import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { onboard, PASSWORD, signUpAndVerify } from './helpers';
import { uniqueEmail } from './mailpit';

test('onboarding checklist, PDF report, plans, data export and account deletion', async ({
  page,
}) => {
  const email = uniqueEmail('account');
  await signUpAndVerify(page, 'Петър Тестов', email);
  await onboard(page, 'Агенция Отчети', 'otcheti-e2e.bg');

  // Only the project step is done right after onboarding.
  await expect(page.getByRole('heading', { name: 'Първи стъпки' })).toBeVisible();
  await expect(page.getByText('Завършени 1 от 6 стъпки')).toBeVisible();

  // PDF report for the project's domain.
  await page.getByRole('link', { name: 'Отчети' }).click();
  await expect(page.getByRole('heading', { name: 'Отчет за домейн' })).toBeVisible();
  const reportDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Изтегли PDF' }).click();
  const report = await reportDownload;
  expect(report.suggestedFilename()).toMatch(/^seo-report-otcheti-e2e\.bg-.*\.pdf$/);
  const pdf = await readFile((await report.path())!);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

  // Plans: the free plan is current; without Stripe nothing can be bought.
  await page.goto('/app/settings?tab=billing');
  await expect(page.getByText('Онлайн плащанията не са включени')).toBeVisible();
  await expect(page.getByText('Вашият план')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Надгради' }).first()).toBeDisabled();

  // API keys need the Agency plan.
  await page.getByRole('tab', { name: 'API ключове' }).click();
  await expect(page.getByText('Публичното API е включено в плана Agency.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Създай ключ' })).toHaveCount(0);

  // GDPR export of the account.
  await page.getByRole('tab', { name: 'Поверителност' }).click();
  const exportDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Експорт на профила ми' }).click();
  const data = JSON.parse(await readFile((await (await exportDownload).path())!, 'utf8')) as {
    user: { email: string };
  };
  expect(data.user.email).toBe(email);

  // Deleting the account needs the email typed in; the solo organization goes with it.
  await page.getByRole('button', { name: 'Изтрий профила ми…' }).click();
  await expect(
    page.getByText('Тези организации също ще бъдат изтрити: Агенция Отчети.'),
  ).toBeVisible();
  const confirm = page.getByRole('button', { name: 'Изтрий профила ми окончателно' });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(`Въведете имейла си ${email} за потвърждение`).fill(email);
  await confirm.click();
  await expect(page).toHaveURL(/\/sign-in/);

  // The account is gone.
  const signIn = await page.request.post('/api/auth/sign-in/email', {
    data: { email, password: PASSWORD },
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(signIn.ok()).toBe(false);
});
