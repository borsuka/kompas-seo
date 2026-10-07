import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink, organization } from 'better-auth/plugins';
import { bootstrapOrganization, eq, schema, type Database } from '@seo/db';
import { UI_LOCALES, type UiLocale } from '@seo/shared';
import type { ApiEnv } from '../config/env.js';
import type { Mailer } from '../email/mailer.js';
import { emailTemplates } from '../email/templates.js';
import { ac, roles } from './access-control.js';

export const AUTH_BASE_PATH = '/api/auth';

function localeOf(user: object | null | undefined): UiLocale {
  const locale = (user as { locale?: unknown } | null | undefined)?.locale;
  return UI_LOCALES.includes(locale as UiLocale) ? (locale as UiLocale) : 'bg';
}

/** Path prefix for UI links: Bulgarian is the default locale and has no prefix. */
function localePath(locale: UiLocale) {
  return locale === 'bg' ? '' : `/${locale}`;
}

export interface AuthDeps {
  env: ApiEnv;
  db: Database;
  mailer: Mailer;
  onError?: (err: unknown, context: string) => void;
}

export function createAuth({ env, db, mailer, onError }: AuthDeps) {
  const send = (to: string, content: Parameters<Mailer['send']>[1], context: string) =>
    // Never block or fail the auth flow on SMTP problems; log instead.
    mailer.send(to, content).catch((err) => onError?.(err, context));

  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {};

  return betterAuth({
    appName: 'Kompas SEO',
    // Public origin: browsers reach the API through the web app's /api proxy.
    baseURL: env.APP_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    user: {
      additionalFields: {
        locale: { type: 'string', required: false, defaultValue: 'bg', input: true },
      },
      deleteUser: { enabled: true },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // No cookie cache: the active organization must update immediately after switching.
      cookieCache: { enabled: false },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      requireEmailVerification: env.AUTH_REQUIRE_EMAIL_VERIFICATION,
      sendResetPassword: async ({ user, url }) => {
        void send(user.email, emailTemplates.resetPassword(localeOf(user), url), 'reset-password');
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        void send(user.email, emailTemplates.verifyEmail(localeOf(user), url), 'verify-email');
      },
    },
    socialProviders: google,
    rateLimit: { enabled: env.NODE_ENV === 'production', window: 60, max: 100 },
    advanced: {
      useSecureCookies: env.APP_URL.startsWith('https://'),
      database: { generateId: () => crypto.randomUUID() },
    },
    plugins: [
      organization({
        ac,
        roles,
        creatorRole: 'owner',
        allowUserToCreateOrganization: true,
        invitationExpiresIn: 60 * 60 * 24 * 7,
        cancelPendingInvitationsOnReInvite: true,
        // An invitation proves nothing unless the invitee owns the address.
        requireEmailVerificationOnInvitation: true,
        sendInvitationEmail: async ({ id, email, role, organization: org, inviter }) => {
          const locale = localeOf(inviter.user);
          const url = `${env.APP_URL}${localePath(locale)}/invitations/${id}`;
          void send(
            email,
            emailTemplates.invitation(
              locale,
              url,
              org.name,
              inviter.user.name || inviter.user.email,
              role,
            ),
            'invitation',
          );
        },
        organizationHooks: {
          afterCreateOrganization: async ({ organization: org }) => {
            await bootstrapOrganization(db, org.id);
          },
        },
      }),
      magicLink({
        expiresIn: 60 * 15,
        sendMagicLink: async ({ email, url }) => {
          const [existing] = await db
            .select({ locale: schema.user.locale })
            .from(schema.user)
            .where(eq(schema.user.email, email.toLowerCase()));
          void send(email, emailTemplates.magicLink(localeOf(existing), url), 'magic-link');
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
