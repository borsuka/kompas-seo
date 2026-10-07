import { Suspense } from 'react';
import { SectionPlaceholder } from '@/components/section-placeholder';

export default function Page() {
  return (
    <Suspense>
      <SectionPlaceholder section="keywords" />
    </Suspense>
  );
}
