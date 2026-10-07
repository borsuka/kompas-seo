import { getSessionCookie } from 'better-auth/cookies';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const intl = createMiddleware(routing);

/** Routes that need a signed-in user (checked again server-side by the API). */
const PROTECTED = /^\/(?:en\/)?(app|onboarding)(\/|$)/;

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PROTECTED.test(pathname) && !getSessionCookie(request)) {
    const isEn = pathname.startsWith('/en/') || pathname === '/en';
    const url = new URL(isEn ? '/en/sign-in' : '/sign-in', request.url);
    url.searchParams.set('next', pathname + search);
    return NextResponse.redirect(url);
  }
  return intl(request);
}

export const config = {
  // Everything except API proxying, Next internals and static files.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
