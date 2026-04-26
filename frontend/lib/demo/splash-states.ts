// Stylized state silhouettes for the Splash visual (SVG path + centroid).
// NOT geographically accurate — used only for the splash hero animation.
// Source: india-svg.js SANJ.STATES.

export interface SplashState {
  id: string;
  name: string;
  path: string;
  cx: number;
  cy: number;
}

export const SPLASH_STATES: SplashState[] = [
  { id: "JK", name: "Jammu & Kashmir", path: "M 280,80 L 340,72 L 380,90 L 410,108 L 380,150 L 340,160 L 305,140 L 290,115 Z", cx: 335, cy: 115 },
  { id: "LA", name: "Ladakh", path: "M 380,90 L 412,108 L 440,98 L 478,118 L 460,148 L 425,148 L 410,108 Z", cx: 432, cy: 120 },
  { id: "HP", name: "Himachal Pradesh", path: "M 340,160 L 380,150 L 410,148 L 410,180 L 372,195 L 345,188 Z", cx: 378, cy: 175 },
  { id: "PB", name: "Punjab", path: "M 305,140 L 340,160 L 345,188 L 322,210 L 290,200 L 282,170 Z", cx: 315, cy: 180 },
  { id: "HR", name: "Haryana", path: "M 322,210 L 345,188 L 372,195 L 380,225 L 358,245 L 332,238 Z", cx: 355, cy: 220 },
  { id: "DL", name: "Delhi NCR", path: "M 358,232 L 380,225 L 388,242 L 380,255 L 362,250 Z", cx: 374, cy: 240 },
  { id: "RJ", name: "Rajasthan", path: "M 220,200 L 290,200 L 322,210 L 332,238 L 332,278 L 305,310 L 268,318 L 232,290 L 210,255 L 215,225 Z", cx: 268, cy: 260 },
  { id: "UP", name: "Uttar Pradesh", path: "M 372,195 L 410,180 L 460,180 L 510,200 L 555,220 L 580,250 L 555,278 L 510,288 L 470,278 L 432,275 L 405,265 L 388,242 L 380,225 Z", cx: 470, cy: 235 },
  { id: "UK", name: "Uttarakhand", path: "M 380,150 L 410,148 L 460,148 L 460,180 L 410,180 Z", cx: 425, cy: 165 },
  { id: "BR", name: "Bihar", path: "M 580,250 L 625,250 L 670,260 L 715,268 L 720,302 L 695,322 L 660,330 L 615,322 L 588,295 L 580,272 Z", cx: 645, cy: 290 },
  { id: "JH", name: "Jharkhand", path: "M 615,322 L 660,330 L 695,322 L 720,342 L 715,375 L 685,388 L 645,392 L 612,378 L 600,348 Z", cx: 660, cy: 358 },
  { id: "WB", name: "West Bengal", path: "M 695,322 L 720,302 L 750,310 L 770,340 L 768,395 L 748,425 L 725,415 L 715,375 L 720,342 Z", cx: 738, cy: 365 },
  { id: "SK", name: "Sikkim", path: "M 720,278 L 745,275 L 752,295 L 730,300 Z", cx: 736, cy: 287 },
  { id: "AS", name: "Assam", path: "M 770,275 L 820,272 L 870,278 L 880,308 L 850,318 L 800,312 L 770,302 Z", cx: 825, cy: 295 },
  { id: "AR", name: "Arunachal", path: "M 820,235 L 880,232 L 920,250 L 905,280 L 870,278 L 820,272 Z", cx: 870, cy: 258 },
  { id: "ML", name: "Meghalaya", path: "M 800,312 L 850,318 L 855,335 L 815,338 Z", cx: 830, cy: 325 },
  { id: "NL", name: "Nagaland", path: "M 880,308 L 905,310 L 905,340 L 885,338 Z", cx: 893, cy: 325 },
  { id: "MN", name: "Manipur", path: "M 885,338 L 905,340 L 902,365 L 880,365 Z", cx: 893, cy: 352 },
  { id: "MZ", name: "Mizoram", path: "M 870,365 L 895,365 L 890,395 L 870,395 Z", cx: 880, cy: 380 },
  { id: "TR", name: "Tripura", path: "M 845,355 L 870,358 L 868,388 L 845,385 Z", cx: 856, cy: 370 },
  { id: "OD", name: "Odisha", path: "M 612,378 L 645,392 L 685,388 L 715,405 L 705,455 L 670,478 L 632,475 L 605,448 L 595,410 Z", cx: 655, cy: 432 },
  { id: "CG", name: "Chhattisgarh", path: "M 510,288 L 555,278 L 580,272 L 600,348 L 595,410 L 565,435 L 530,430 L 510,395 L 502,348 Z", cx: 548, cy: 358 },
  { id: "MP", name: "Madhya Pradesh", path: "M 305,310 L 332,278 L 388,295 L 432,275 L 470,278 L 510,288 L 502,348 L 470,360 L 425,358 L 385,355 L 350,348 L 315,332 Z", cx: 405, cy: 320 },
  { id: "GJ", name: "Gujarat", path: "M 130,310 L 200,295 L 232,290 L 268,318 L 268,358 L 232,388 L 195,395 L 165,378 L 145,355 L 132,335 Z", cx: 200, cy: 345 },
  { id: "MH", name: "Maharashtra", path: "M 232,388 L 268,358 L 305,348 L 350,348 L 385,355 L 395,400 L 380,440 L 348,462 L 308,475 L 268,470 L 240,440 L 222,415 Z", cx: 305, cy: 415 },
  { id: "TG", name: "Telangana", path: "M 385,400 L 425,395 L 470,398 L 510,425 L 495,470 L 458,485 L 420,478 L 395,455 Z", cx: 445, cy: 438 },
  { id: "AP", name: "Andhra Pradesh", path: "M 458,485 L 495,470 L 530,475 L 565,495 L 580,540 L 555,575 L 525,580 L 495,560 L 478,525 Z", cx: 520, cy: 528 },
  { id: "KA", name: "Karnataka", path: "M 308,475 L 348,462 L 395,455 L 420,478 L 458,485 L 478,525 L 458,565 L 422,580 L 388,572 L 360,548 L 332,520 L 318,495 Z", cx: 388, cy: 520 },
  { id: "GA", name: "Goa", path: "M 305,495 L 322,492 L 322,512 L 305,512 Z", cx: 314, cy: 502 },
  { id: "TN", name: "Tamil Nadu", path: "M 422,580 L 458,565 L 495,560 L 525,580 L 510,625 L 492,668 L 462,695 L 432,690 L 415,650 L 410,615 Z", cx: 460, cy: 628 },
  { id: "KL", name: "Kerala", path: "M 388,572 L 422,580 L 410,615 L 415,650 L 405,695 L 388,718 L 372,710 L 365,680 L 372,635 L 380,600 Z", cx: 392, cy: 658 },
  { id: "PY", name: "Puducherry", path: "M 482,612 L 495,610 L 495,624 L 482,624 Z", cx: 488, cy: 618 }
];
