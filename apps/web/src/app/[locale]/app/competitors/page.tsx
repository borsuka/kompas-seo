import { Suspense } from 'react';
import { DomainOverviewView } from './overview';

export default function CompetitorsPage() {
  return (
    <Suspense>
      <DomainOverviewView />
    </Suspense>
  );
}
