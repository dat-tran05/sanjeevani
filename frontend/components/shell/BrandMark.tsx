import Link from "next/link";
import { LeafGlyph } from "./LeafGlyph";

export function BrandMark() {
  return (
    <Link href="/" className="brand">
      <LeafGlyph className="leaf" size={22} />
      <span>Sanjeevani</span>
      <span className="brand-sub">Demo · India · 10,053 facilities</span>
    </Link>
  );
}
