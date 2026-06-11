/** Skeleton shown instantly while a section's data streams in. */
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="h-9 w-52 rounded-md bg-surface-2" />
        <div className="h-11 w-40 rounded-pill bg-surface-2" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="h-28 rounded-lg border border-line bg-surface-1" />
        <div className="h-28 rounded-lg border border-line bg-surface-1" />
        <div className="h-28 rounded-lg border border-line bg-surface-1" />
      </div>
      <div className="h-72 rounded-lg border border-line bg-surface-1" />
    </div>
  );
}
