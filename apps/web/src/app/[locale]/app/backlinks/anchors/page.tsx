import { Suspense } from 'react';
import { AnchorsView } from './anchors';

export default function Page() {
  return (
    <Suspense>
      <AnchorsView />
    </Suspense>
  );
}
