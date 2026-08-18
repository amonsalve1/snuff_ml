// the sun and the fire over the island, one rig per daypart.
//
// rigs are defined by an ELEVATION and an AZIMUTH, not by a position, because
// the sun is a parallel light and the whole point of a daypart is the angle it
// comes in at. the old rigs parked a point light a few thousand pixels off the
// top of the frame, which sounds like a sun but is not: normalised, that put
// every daypart within 5 degrees of the horizon, so a front facing pixel got
// the same n.l of 0.08 at noon as at dusk and the art rendered at about a third
// of its authored brightness all day. elevation here is the real thing.
//
// az is where the light comes FROM, measured across the frame: 0 is hard right,
// 180 is hard left. so the sun rises on the left at dawn and sets on the right,
// and the shadows and the sun path on the water follow it for free.

const DEG = Math.PI / 180;

const SUNS = {
  //        elevation, azimuth
  dawn:    { el: 10, az: 162, color: [1.0, 0.76, 0.62], ambient: [0.23, 0.20, 0.21], intensity: 0.92 },
  morning: { el: 40, az: 140, color: [1.0, 0.94, 0.82], ambient: [0.25, 0.25, 0.24], intensity: 0.88 },
  midday:  { el: 72, az: 62,  color: [1.0, 0.99, 0.94], ambient: [0.26, 0.26, 0.25], intensity: 0.85 },
  golden:  { el: 15, az: 20,  color: [1.0, 0.80, 0.50], ambient: [0.24, 0.20, 0.19], intensity: 1.00 },
  dusk:    { el: 7,  az: 8,   color: [1.0, 0.62, 0.36], ambient: [0.20, 0.16, 0.16], intensity: 0.86 },
};

// after dark the sun is gone and the torch line is the only source, so night
// stays a POSITIONAL light: it has to fall off, or the far end of the beach
// would be as lit as the fire itself.
const NIGHT = {
  x: 0.5, y: 0.62, z: 60,
  color: [1.0, 0.62, 0.28],
  ambient: [0.15, 0.11, 0.10],
  intensity: 1.35,
  stretch: -1.0,
};

function dirFor(el, az) {
  const e = el * DEG;
  const a = az * DEG;
  const ce = Math.cos(e);
  // points from the ground toward the light. canvas y grows downward, so a
  // light above the frame is negative y.
  return [ce * Math.cos(a), -ce * Math.sin(a), Math.sin(e)];
}

export const RIGS = SUNS;

export function lightFor(part, w, h) {
  if (part === "night") {
    return {
      x: w * NIGHT.x,
      y: h * NIGHT.y,
      z: NIGHT.z,
      radius: Math.max(420, w * 0.62),
      color: NIGHT.color,
      ambient: NIGHT.ambient,
      intensity: NIGHT.intensity,
      stretch: NIGHT.stretch,
      part,
      key: "night",
    };
  }
  const rig = SUNS[part] || SUNS.midday;
  const dir = dirFor(rig.el, rig.az);
  // shadows lie opposite the light and stretch as 1/tan(elevation), so a low
  // sun rakes them across the sand and a high one drops them at its feet. that
  // also drives the sun path on the water, which reads lowness off the stretch.
  const stretch = -dir[0] / Math.max(0.08, dir[2]);
  return {
    // the sun sits on the side it lights from, which is what the specular path
    // on the water aims at
    x: w * (0.5 + 0.46 * dir[0]),
    y: -h * 0.6,
    z: h,
    radius: Math.max(1400, w * 1.2),
    dir,
    color: rig.color,
    ambient: rig.ambient,
    intensity: rig.intensity,
    stretch,
    part,
    key: part,
  };
}
