import { Suspense } from 'react';
import { KeywordOverviewView } from './overview';

export default function KeywordOverviewPage() {
  return (
    <Suspense>
      <KeywordOverviewView />
    </Suspense>
  );
}
