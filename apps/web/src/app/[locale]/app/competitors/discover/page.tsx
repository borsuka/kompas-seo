import { Suspense } from 'react';
import { DiscoverView } from './discover';

export default function DiscoverPage() {
  return (
    <Suspense>
      <DiscoverView />
    </Suspense>
  );
}
