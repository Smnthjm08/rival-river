import { Suspense } from "react";
import { TableScreen } from "@/components/rr/table/table-screen";
import { TableSkeleton } from "@/components/rr/table/table-stage";

// The table's address comes from the URL, which isn't known at build time:
// with Cache Components, the part that reads it must sit inside <Suspense>.
export default function TablePage() {
  return (
    <Suspense
      fallback={
        <>
          <div className="h-(--header-h) border-b" />
          <main className="mx-auto w-full max-w-360 px-2 sm:px-4">
            <TableSkeleton />
          </main>
        </>
      }
    >
      <TableScreen />
    </Suspense>
  );
}
