import { Skeleton } from "@/components/ui/skeleton";

export default function AccountLoading() {
  return (
    <div role="status" aria-label="Loading your account">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="mt-3 h-5 w-72 max-w-full" />
      <div className="mt-8 flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-card" />
        ))}
      </div>
    </div>
  );
}
