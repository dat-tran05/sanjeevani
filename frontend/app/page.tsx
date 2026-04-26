import { Suspense } from "react";
import { TopoBg } from "@/components/shell/TopoBg";
import { SplashHero } from "@/components/splash/SplashHero";
import { SplashVisual } from "@/components/splash/SplashVisual";

export default function HomePage() {
  return (
    <div className="splash">
      <TopoBg />
      <div className="splash-canvas">
        <SplashHero />
        <Suspense fallback={<div className="splash-visual" />}>
          <SplashVisual />
        </Suspense>
      </div>
    </div>
  );
}
