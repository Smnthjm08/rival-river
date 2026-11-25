import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { TableScreen } from "@/components/rr/table/table-screen";

// The table's address comes from the URL, which isn't known at build time:
// with Cache Components, the part that reads it must sit inside <Suspense>.
export default function TablePage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-8">
          <Skeleton className="aspect-[16/10] w-full rounded-[2.5rem] md:rounded-[50%]" />
        </main>
      }
    >
      <TableScreen />
    </Suspense>
  );
}
