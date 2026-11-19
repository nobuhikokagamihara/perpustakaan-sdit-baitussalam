export const EASE_EDITORIAL = [0.16, 1, 0.3, 1] as const;

export const MOTION_DURATION = {
  fast: 0.14,
  normal: 0.22,
  panel: 0.24,
  spread: 0.28,
} as const;

export function getStaggerDelay(index: number, step = 0.04, maxDelay = 0.24): number {
  if (!Number.isFinite(index) || index <= 0) return 0;
  return Math.min(index * step, maxDelay);
}

export const PAGE_ENTER_VARIANTS = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
} as const;

export const MODAL_OVERLAY_VARIANTS = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
} as const;

export const MODAL_PANEL_VARIANTS = {
  initial: { opacity: 0, scale: 0.96, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97, y: 6 },
} as const;
