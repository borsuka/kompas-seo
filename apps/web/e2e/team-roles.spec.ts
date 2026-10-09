import { expect, test } from '@playwright/test';
import { onboard, signUpAndVerify } from './helpers';
import { uniqueEmail, waitForEmailLink } from './mailpit';

test('acceptance 3.1: sign up, create org and project, invite a read-only viewer', async ({
  browser,
}) => {
  const ownerEmail = uniqueEmail('owner');
  const viewerEmail = uniqueEmail('viewer');

  // --- Owner: sign up → onboarding → organization → project
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await signUpAndVerify(owner, 'Иван Собственик', ownerEmail);

  await onboard(owner, 'Агенция Е2Е', 'https://www.primer-e2e.bg/');
  await expect(owner.getByText('primer-e2e.bg').first()).toBeVisible();

  // --- Owner invites a viewer
  await owner.goto('/app/settings?tab=members');
  await owner.getByPlaceholder('Имейл').fill(viewerEmail);
  await owner.getByRole('combobox', { name: 'Членове' }).click();
  await owner.getByRole('option', { name: 'Наблюдател' }).click();
  await owner.getByRole('button', { name: 'Покани' }).click();
  // The pending invitation row (the success toast mentions the email too).
  await expect(
    owner.getByRole('listitem').filter({ hasText: viewerEmail }).filter({ hasText: 'Наблюдател' }),
  ).toBeVisible();

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
