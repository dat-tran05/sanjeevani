import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const replaceMock = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => "/explorer",
}));

import { useDrawer } from "@/lib/hooks/use-drawer";

describe("useDrawer", () => {
  it("returns null facilityId when no param present", () => {
    const { result } = renderHook(() => useDrawer());
    expect(result.current.facilityId).toBeNull();
    expect(result.current.isOpen).toBe(false);
  });

  it("openDrawer pushes facility + citation params to URL", () => {
    const { result } = renderHook(() => useDrawer());
    act(() => {
      result.current.openDrawer("F-MZN-0214", "c1");
    });
    expect(replaceMock).toHaveBeenCalledWith(
      expect.stringContaining("facility=F-MZN-0214"),
      expect.objectContaining({ scroll: false })
    );
    expect(replaceMock).toHaveBeenCalledWith(
      expect.stringContaining("citation=c1"),
      expect.any(Object)
    );
  });
});
