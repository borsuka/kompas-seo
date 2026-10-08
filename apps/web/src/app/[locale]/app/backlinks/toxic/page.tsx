import { Suspense } from 'react';
import { ToxicView } from './toxic';

export default function Page() {
  return (
    <Suspense>
      <ToxicView />
    </Suspense>
  );
}
