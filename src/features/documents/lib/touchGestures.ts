export function measureTouchDistance(
  firstTouch: Pick<Touch, "clientX" | "clientY">,
  secondTouch: Pick<Touch, "clientX" | "clientY">,
) {
  return Math.round(
    Math.hypot(
      secondTouch.clientX - firstTouch.clientX,
      secondTouch.clientY - firstTouch.clientY,
    ),
  );
}

export function getPinchZoomAction(
  previousDistance: number,
  nextDistance: number,
  threshold = 24,
) {
  const delta = nextDistance - previousDistance;
  if (Math.abs(delta) < threshold) {
    return null;
  }

  return delta > 0 ? "zoom-in" : "zoom-out";
}
