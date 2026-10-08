import { Suspense } from 'react';
import { LinkGapView } from './link-gap';

export default function Page() {
  return (
    <Suspense>
      <LinkGapView />
    </Suspense>
  );
}
