import { expect, test, type Page } from '@playwright/test';
import { uniqueEmail, waitForEmailLink } from './mailpit';

const PASSWORD = 'correct-horse-battery';

async function signUpAndVerify(page: Page, name: string, email: string) {
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

test('acceptance 3.1: sign up, create org and project, invite a read-only viewer', async ({
  browser,
}) => {
  const ownerEmail = uniqueEmail('owner');
  const viewerEmail = uniqueEmail('viewer');

  // --- Owner: sign up → onboarding → organization → project
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await signUpAndVerify(owner, 'Иван Собственик', ownerEmail);

  await expect(
    owner.getByRole('heading', { name: 'Как се казва вашата организация?' }),
  ).toBeVisible();
  await owner.getByLabel('Име на организацията', { exact: true }).fill('Агенция Е2Е');
  await owner.getByRole('button', { name: 'Създай' }).click();

  await expect(owner.getByRole('heading', { name: 'Добавете своя сайт' })).toBeVisible();
  await owner.getByLabel('Домейн', { exact: true }).fill('https://www.primer-e2e.bg/');
  await owner.getByRole('button', { name: 'Към таблото' }).click();

  await expect(owner.getByRole('heading', { name: 'Табло' })).toBeVisible();
  await expect(owner.getByText('primer-e2e.bg').first()).toBeVisible();

  // --- Owner invites a viewer
  await owner.goto('/app/settings?tab=members');
  await owner.getByPlaceholder('Имейл').fill(viewerEmail);
  await owner.getByRole('combobox', { name: 'Членове' }).click();
  await owner.getByRole('option', { name: 'Наблюдател' }).click();
  await owner.getByRole('button', { name: 'Покани' }).click();
  await expect(owner.getByRole('listitem').filter({ hasText: viewerEmail })).toBeVisible();

  // --- Viewer: sign up from the invitation email and accept
  const inviteLink = await waitForEmailLink(viewerEmail, '/invitations/');
  const viewerCtx = await browser.newContext();
  const viewer = await viewerCtx.newPage();
  await signUpAndVerify(viewer, 'Мария Наблюдател', viewerEmail);
  await viewer.goto(inviteLink);
  await viewer.getByRole('button', { name: 'Приеми поканата' }).click();
  await expect(viewer.getByRole('heading', { name: 'Табло' })).toBeVisible();

  // --- Viewer sees the project but cannot edit
  await viewer.goto('/app/settings?tab=project');
  await expect(viewer.getByText('Имате права само за преглед')).toBeVisible();
  await expect(viewer.getByLabel('Име на проекта', { exact: true })).toBeDisabled();
  await expect(viewer.getByRole('button', { name: 'Запази' })).toBeDisabled();
  await expect(viewer.getByRole('button', { name: 'Изтрий проекта' })).toHaveCount(0);

  // The API refuses too (the UI is only a mirror of the server-side rules).
  const res = await viewer.request.patch('/api/v1/projects/00000000-0000-4000-8000-000000000000', {
    data: { name: 'x' },
    headers: { Origin: new URL(viewer.url()).origin },
  });
  expect(res.status()).toBe(403);

  await ownerCtx.close();
  await viewerCtx.close();
});

test('English UI lives under /en and Bulgarian is the default', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'bg');
  await page.goto('/en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('link', { name: 'Start for free' })).toBeVisible();
});

test('protected routes redirect to sign-in', async ({ page }) => {
  await page.goto('/app/settings');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp%2Fsettings/);
});
