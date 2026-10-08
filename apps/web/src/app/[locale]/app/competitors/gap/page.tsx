import { Suspense } from 'react';
import { KeywordGapView } from './keyword-gap';

export default function KeywordGapPage() {
  return (
    <Suspense>
      <KeywordGapView />
    </Suspense>
  );
}
