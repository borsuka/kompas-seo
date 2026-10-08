import { Suspense } from 'react';
import { TopPagesView } from './top-pages';

export default function TopPagesPage() {
  return (
    <Suspense>
      <TopPagesView />
    </Suspense>
  );
}
