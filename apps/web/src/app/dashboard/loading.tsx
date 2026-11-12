import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div role="status" aria-label="Loading">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="mt-3 h-5 w-64 max-w-full" />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-28 rounded-card" />
        ))}
      </div>
      <Skeleton className="mt-10 h-40 w-full rounded-card" />
    </div>
  );
}
