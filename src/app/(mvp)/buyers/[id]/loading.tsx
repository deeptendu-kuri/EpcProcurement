import { SkeletonRows } from "@/components/mvp/skeleton";

export default function Loading() {
  return <SkeletonRows rows={5} label="Loading buyer" />;
}
