import { Suspense } from 'react';
import { ReferringDomainsView } from './referring-domains';

export default function Page() {
  return (
    <Suspense>
      <ReferringDomainsView />
    </Suspense>
  );
}
