import { TopoBg } from "@/components/shell/TopoBg";

const pipelineSteps = [
  {
    num: "01",
    h: "Parse & extract",
    d: "Llama 3.3 reads facility free text → structured fields.",
  },
  {
    num: "02",
    h: "Contradiction rules",
    d: "Eight deterministic checks flag self-inconsistent listings.",
  },
  {
    num: "03",
    h: "Three-judge jury",
    d: "Sonnet, Llama, Qwen verdict each capability claim independently.",
  },
  {
    num: "04",
    h: "Trust score · 4-dim",
    d: "Existence · Coherence · Recency · Specificity. Never collapsed to one number.",
  },
];

export default function MethodologyPage() {
  return (
    <div className="about">
      <TopoBg />
      <div className="about-inner">
        <h1>Methodology</h1>
        <p className="lede">
          Sanjeevani is a reasoning layer over 10,053 Indian healthcare facilities. Every claim
          it surfaces is cited, trust-scored across four dimensions, and verdicted by three
          independent AI judges.
        </p>
        <h2>The thesis</h2>
        <p>
          India has 10,000+ medical facilities, but the discovery and coordination problem
          dominates. Which facility actually has surgical capability? Which actually runs a 24/7
          emergency? The data exists, but it&apos;s messy, sparse, and self-reported.
        </p>
        <p className="pull">
          When there is no answer key, we use disagreement between heterogeneous models as our
          calibration signal.
        </p>
        <h2>The pipeline</h2>
        <div className="about-pipeline">
          {pipelineSteps.map((s) => (
            <div key={s.num} className="pipe-step">
              <div className="step-num">{s.num}</div>
              <div className="step-h">{s.h}</div>
              <div className="step-desc">{s.d}</div>
            </div>
          ))}
        </div>
        <h2>The judges</h2>
        <p>
          Three heterogeneous models, three different vendors. Disagreement is calibration, not
          noise.
        </p>
        <div className="judges-grid">
          <div className="judge-card">
            <div className="vendor">Anthropic · Bedrock</div>
            <div className="judge-name">Claude Sonnet 4.6</div>
            <div className="judge-role">
              Aggregator + tiebreaker (extended thinking) + validator (fresh context).
            </div>
          </div>
          <div className="judge-card">
            <div className="vendor">Meta · Databricks</div>
            <div className="judge-name">Llama 3.3 70B</div>
            <div className="judge-role">
              Open-weights judge. Tends to dissent when equipment specificity is low.
            </div>
          </div>
          <div className="judge-card">
            <div className="vendor">Databricks · DBRX</div>
            <div className="judge-name">Qwen 3 80B</div>
            <div className="judge-role">
              Architecturally distinct from the other two — a true heterogeneity signal.
            </div>
          </div>
        </div>
        <h2>The dataset</h2>
        <p>
          10,053 rows × 41 columns. 100% lat/long coverage. 79.5% have free-text descriptions
          over 20 chars — the richest signal. Bed counts, doctor counts, equipment fields are
          sparse (1–16% coverage). Sparsity is the dominant design driver.
        </p>
        <h2>What we don&apos;t claim</h2>
        <p>
          Sanjeevani does not say a facility &quot;is good&quot; or &quot;is the right
          choice.&quot; It says: of the claims this facility makes, three judges agree this one
          is supported by its own description text, with high recency and specificity.
          Verification is not endorsement. NGO planners are the decision-makers.
        </p>
        <div
          style={{
            marginTop: 60,
            paddingTop: 24,
            borderTop: "1px solid var(--line)",
            fontSize: 12,
            color: "var(--fg-mute)",
            fontFamily: "var(--mono)",
            letterSpacing: "0.05em",
          }}
        >
          Built for Hack-Nation × World Bank Global AI Hackathon 2026 · Challenge 03 (Databricks)
        </div>
      </div>
    </div>
  );
}
