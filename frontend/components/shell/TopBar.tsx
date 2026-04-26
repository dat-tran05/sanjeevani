"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "./BrandMark";
import { StatePill } from "./StatePill";

const TABS = [
  { href: "/", label: "Home" },
  { href: "/explorer", label: "Explorer" },
  { href: "/atlas", label: "Crisis Map" },
  { href: "/methodology", label: "Methodology" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export function TopBar() {
  const pathname = usePathname();
  return (
    <div className="topbar">
      <BrandMark />
      <div className="topbar-tabs">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={"tab" + (isActive(pathname, t.href) ? " active" : "")}
          >
            {t.label}
          </Link>
        ))}
      </div>
      <div className="topbar-end">
        <StatePill />
      </div>
    </div>
  );
}
