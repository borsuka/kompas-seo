import { Suspense } from 'react';
import { ReportsPage } from './reports-page';

export default function Page() {
  return (
    <Suspense>
      <ReportsPage />
    </Suspense>
  );
}
