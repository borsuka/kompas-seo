import { Suspense } from 'react';
import { DomainKeywordsView } from './domain-keywords';

export default function DomainKeywordsPage() {
  return (
    <Suspense>
      <DomainKeywordsView />
    </Suspense>
  );
}
