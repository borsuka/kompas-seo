import { expect, type Page } from '@playwright/test';
import { waitForEmailLink } from './mailpit';

export const PASSWORD = 'correct-horse-battery';

export async function signUpAndVerify(page: Page, name: string, email: string) {
  await page.goto('/sign-up');
  await page.getByLabel('Име', { exact: true }).fill(name);
  await page.getByLabel('Имейл', { exact: true }).fill(email);
  await page.getByLabel('Парола', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Регистрация' }).click();

  // Email verification is required: follow the link from the email.
  await expect(page.getByRole('heading', { name: 'Потвърдете имейла си' })).toBeVisible();
  const link = await waitForEmailLink(email, '/api/auth/verify-email');
  await page.goto(link);
}

/** Onboarding after the first sign-in: organization, then the first project. */
export async function onboard(page: Page, organization: string, domain: string) {
  await expect(
    page.getByRole('heading', { name: 'Как се казва вашата организация?' }),
  ).toBeVisible();
  await page.getByLabel('Име на организацията', { exact: true }).fill(organization);
  await page.getByRole('button', { name: 'Създай' }).click();

  await expect(page.getByRole('heading', { name: 'Добавете своя сайт' })).toBeVisible();
  await page.getByLabel('Домейн', { exact: true }).fill(domain);
  await page.getByRole('button', { name: 'Към таблото' }).click();
  await expect(page.getByRole('heading', { name: 'Табло' })).toBeVisible();
}
