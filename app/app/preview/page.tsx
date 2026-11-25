import { Suspense } from "react";
import { TablePreview } from "@/components/rr/table/table-preview";

export const metadata = { title: "Table preview · Rival River" };

/** Design preview: the live table with sample data, no wallet or chain needed. */
export default function PreviewPage() {
  // Sample deadlines come from the clock, so render it at request time.
  return (
    <Suspense>
      <TablePreview />
    </Suspense>
  );
}
