"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

export interface UseDrawerReturn {
  facilityId: string | null;
  citationId: string | null;
  isOpen: boolean;
  openDrawer: (facilityId: string, citationId?: string) => void;
  closeDrawer: () => void;
}

export function useDrawer(): UseDrawerReturn {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const facilityId = searchParams.get("facility");
  const citationId = searchParams.get("citation");

  const openDrawer = useCallback(
    (facilityId: string, citationId?: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("facility", facilityId);
      if (citationId) params.set("citation", citationId);
      else params.delete("citation");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const closeDrawer = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("facility");
    params.delete("citation");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  return {
    facilityId,
    citationId,
    isOpen: !!facilityId,
    openDrawer,
    closeDrawer,
  };
}
