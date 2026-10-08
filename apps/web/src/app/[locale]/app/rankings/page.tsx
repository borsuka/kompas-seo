import { Suspense } from 'react';
import { RankingsOverview } from './overview';

export default function RankingsPage() {
  return (
    <Suspense>
      <RankingsOverview />
    </Suspense>
  );
}
