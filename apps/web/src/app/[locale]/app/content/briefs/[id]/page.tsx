import { Suspense, use } from 'react';
import { BriefDetail } from './brief-detail';

export default function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <BriefDetail id={id} />
    </Suspense>
  );
}
