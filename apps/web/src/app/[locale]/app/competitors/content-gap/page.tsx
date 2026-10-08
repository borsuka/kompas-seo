import { Suspense } from 'react';
import { ContentGapView } from './content-gap';

export default function ContentGapPage() {
  return (
    <Suspense>
      <ContentGapView />
    </Suspense>
  );
}
