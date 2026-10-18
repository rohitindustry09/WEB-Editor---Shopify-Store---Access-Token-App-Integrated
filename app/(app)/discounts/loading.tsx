import { ListSkeleton } from "@/components/ui/skeletons";

/** Shown instantly while this page loads — shaped like the page itself. */
export default function Loading() {
  return <ListSkeleton columns={5} rows={6} />;
}
