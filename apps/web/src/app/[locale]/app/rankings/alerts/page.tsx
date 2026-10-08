import { Suspense } from 'react';
import { AlertsView } from './alerts';

export default function RankAlertsPage() {
  return (
    <Suspense>
      <AlertsView />
    </Suspense>
  );
}
