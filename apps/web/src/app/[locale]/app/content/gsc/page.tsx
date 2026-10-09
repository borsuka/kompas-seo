import { Suspense } from 'react';
import { SearchConsoleView } from './search-console';

export default function SearchConsolePage() {
  return (
    <Suspense>
      <SearchConsoleView />
    </Suspense>
  );
}
