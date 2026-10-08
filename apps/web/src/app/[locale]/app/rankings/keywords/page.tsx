import { Suspense } from 'react';
import { TrackedKeywordsView } from './tracked-keywords';

export default function TrackedKeywordsPage() {
  return (
    <Suspense>
      <TrackedKeywordsView />
    </Suspense>
  );
}
