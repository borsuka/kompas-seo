import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/** Locale-aware Link/redirect/router. Always use these instead of next/link & next/navigation. */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
