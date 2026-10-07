import type { ReactNode } from 'react';
import './globals.css';

// The real root layout (<html>) is app/[locale]/layout.tsx.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
