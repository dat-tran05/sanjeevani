// Topographic background SVG — port of india-svg.js TOPO_SVG.
// Generated once at module load (the IIFE produces a deterministic string).

const buildTopoSvg = (): string => {
  const lines: string[] = [];
  for (let i = 0; i < 14; i++) {
    const cx = 800 + Math.sin(i * 0.7) * 80;
    const cy = 500 + Math.cos(i * 0.7) * 60;
    const rx = 420 - i * 18;
    const ry = 320 - i * 14;
    lines.push(
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke-opacity="${0.16 - i * 0.008}"/>`
    );
  }
  for (let i = 0; i < 8; i++) {
    const cx = 200 + i * 30;
    const cy = 200 + i * 20;
    const rx = 180 - i * 10;
    const ry = 140 - i * 8;
    lines.push(
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="rgba(43,182,115,0.06)" stroke-opacity="${0.10 - i * 0.01}"/>`
    );
  }
  for (let i = 0; i < 8; i++) {
    const cx = 1300 - i * 24;
    const cy = 800 - i * 18;
    const rx = 200 - i * 12;
    const ry = 150 - i * 10;
    lines.push(
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="rgba(43,182,115,0.05)" stroke-opacity="${0.10 - i * 0.01}"/>`
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" fill="none" stroke="rgba(212,166,97,0.10)" stroke-width="0.6">${lines.join("")}</svg>`;
};

export const TOPO_SVG = buildTopoSvg();
