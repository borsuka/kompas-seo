'use client';
import { createAuthClient } from 'better-auth/react';
import {
  inferAdditionalFields,
  magicLinkClient,
  organizationClient,
} from 'better-auth/client/plugins';

/** Better Auth client. Requests go to /api/auth/* on this origin (proxied to the API). */
export const authClient = createAuthClient({
  plugins: [
    organizationClient(),
    magicLinkClient(),
    // Mirrors the API's user.additionalFields (preferred email language).
    inferAdditionalFields({ user: { locale: { type: 'string', required: false } } }),
  ],
});

export const { useSession, signIn, signUp, signOut } = authClient;
