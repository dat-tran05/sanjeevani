import { TOPO_SVG } from "@/lib/demo/topo-svg";

export function TopoBg() {
  return <div className="topo-bg" dangerouslySetInnerHTML={{ __html: TOPO_SVG }} />;
}
