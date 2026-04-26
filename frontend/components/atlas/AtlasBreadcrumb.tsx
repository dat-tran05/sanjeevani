import { STATES_GEO } from "@/lib/demo/states-geo";

interface AtlasBreadcrumbProps {
  stateId: string;
  onReset: () => void;
}

export function AtlasBreadcrumb({ stateId, onReset }: AtlasBreadcrumbProps) {
  const stateName = STATES_GEO.find((s) => s.id === stateId)?.name;

  return (
    <div className="atlas-breadcrumb">
      <span className="root" onClick={onReset}>
        India
      </span>
      <span className="sep">›</span>
      <span className="leaf">{stateName}</span>
      <button className="clear" onClick={onReset}>
        reset
      </button>
    </div>
  );
}
