import { Suspense, use } from 'react';
import { KeywordListDetail } from './list-detail';

export default function KeywordListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <KeywordListDetail id={id} />
    </Suspense>
  );
}
