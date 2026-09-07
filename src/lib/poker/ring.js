// Seat positions on the shared arena ellipse (percent of the arena box).
//   ring      — seat numbers to place, in seat order.
//   mySeatNo  — anchors the rotation so my seat is bottom centre (null → first seat).
//   hasTop    — when the House occupies the top, spread seats over the lower 300°.
export function ringPositions(ring, mySeatNo = null, hasTop = false, flat = false) {
  const n = ring.length;
  if (!n) return [];
  const anchorIdx = mySeatNo != null && ring.includes(mySeatNo) ? ring.indexOf(mySeatNo) : 0;
  const a = 43, b = flat ? 34 : 38;
  const cy = hasTop ? 54 : 50;
  const out = [];
  for (let i = 0; i < n; i++) {
    const dIdx = (i - anchorIdx + n) % n;
    const t = dIdx / n;                       // 0 = bottom centre, increasing clockwise
    let deg = 90 + t * 360;
    if (hasTop) {
      // Keep a 60° wedge around the top (270°) free for the House: squeeze the
      // ring into 90°→240° and 300°→450°.
      deg = 90 + t * 300 + (t >= 0.5 ? 60 : 0);
    }
    const theta = (deg * Math.PI) / 180;
    out.push({ seatNo: ring[i], x: 50 + a * Math.cos(theta), y: cy + b * Math.sin(theta), bottom: dIdx === 0 });
  }
  return out;
}
