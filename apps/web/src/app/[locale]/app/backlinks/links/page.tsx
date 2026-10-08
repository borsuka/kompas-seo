import { Suspense } from 'react';
import { BacklinkListView } from './backlink-list';

export default function Page() {
  return (
    <Suspense>
      <BacklinkListView />
    </Suspense>
  );
}
