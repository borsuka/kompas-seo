import { Suspense } from 'react';
import { KeywordExplorer } from './explorer';

export default function KeywordsPage() {
  return (
    <Suspense>
      <KeywordExplorer />
    </Suspense>
  );
}
