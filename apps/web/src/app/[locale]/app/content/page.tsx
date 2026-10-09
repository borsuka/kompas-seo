import { Suspense } from 'react';
import { BriefsList } from './briefs-list';

export default function ContentPage() {
  return (
    <Suspense>
      <BriefsList />
    </Suspense>
  );
}
