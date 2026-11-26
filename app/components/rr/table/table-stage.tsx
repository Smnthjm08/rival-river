import { Skeleton } from "@/components/ui/skeleton";

/**
 * The table's first screen: the felt takes whatever height is left, and the
 * dock (turn controls or the hand's status) sits under it, never on top of it.
 * On a screen too short for both, the page scrolls instead.
 */
export function TableStage({ toolbar, felt, dock }: { toolbar?: React.ReactNode; felt: React.ReactNode; dock: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100dvh-var(--header-h))] flex-col gap-2 py-2 md:gap-3 md:py-3">
      {toolbar}
      <section aria-label="Table" className="flex min-h-100 flex-1 basis-0 flex-col justify-center md:min-h-108">
        {felt}
      </section>
      {/* A steady minimum height, so the felt doesn't resize from turn to turn. */}
      <div className="grid min-h-29 md:min-h-30">{dock}</div>
    </div>
  );
}

/** Loading: the shape of the felt and the dock that are coming. */
export function TableSkeleton() {
  return (
    <TableStage
      felt={<Skeleton className="max-h-184 min-h-0 w-full flex-1 rounded-4xl lg:rounded-[50%]" />}
      dock={<Skeleton className="size-full rounded-2xl" />}
    />
  );
}
