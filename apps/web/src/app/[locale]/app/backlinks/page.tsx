import { Suspense } from 'react';
import { BacklinksOverview } from './overview';

export default function BacklinksPage() {
  return (
    <Suspense>
      <BacklinksOverview />
    </Suspense>
  );
}
