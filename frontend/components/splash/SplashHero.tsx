import Link from "next/link";

export function SplashHero() {
  return (
    <div className="splash-text">
      <div className="splash-eyebrow">
        <span className="line"></span>
        <span>Hack-Nation × World Bank · 2026 · Challenge 03</span>
      </div>
      <h1 className="splash-headline">
        Find help.<br />
        <em>Save lives.</em>
      </h1>
      <p className="splash-tag">
        A reasoning layer over 10,053 Indian healthcare facilities — ranked, cited,
        <span className="green" style={{ color: "var(--green)" }}> verified</span> by three independent AI judges.
      </p>
      <div className="splash-cta-row">
        <Link href="/explorer" className="btn btn-primary">
          Run the demo query
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M3 7h8M7 3l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
        <Link href="/atlas" className="btn">
          Explore the atlas
        </Link>
        <Link href="/methodology" className="btn-ghost btn">
          How it works
        </Link>
      </div>
      <div className="splash-stats">
        <div>
          <div className="splash-stat-num">10,053</div>
          <div className="splash-stat-label">Facilities indexed</div>
        </div>
        <div>
          <div className="splash-stat-num">28</div>
          <div className="splash-stat-label">States / UTs covered</div>
        </div>
        <div>
          <div className="splash-stat-num">3</div>
          <div className="splash-stat-label">Independent judges</div>
        </div>
        <div>
          <div className="splash-stat-num">41</div>
          <div className="splash-stat-label">Capability dimensions</div>
        </div>
      </div>
    </div>
  );
}
