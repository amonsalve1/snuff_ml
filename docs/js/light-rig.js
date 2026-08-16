// the sun and the fire over the island, one rig per daypart.
//
// adapted from the tomatte farm rig, with the cool end rewritten. dusk and
// night there are magenta and blue, which fought the ember palette, so here the
// light drops to the beach and turns orange instead: after sunset the only
// thing lighting the scene is the torches, which is the whole point of the show.
//
// x is a fraction of canvas width, y a multiple of canvas height (negative is
// above the band, so the light is off canvas where a sun actually is). z is the
// height the shadow projection divides by, so a low light rakes long shadows
// sideways and a high one drops them straight down.

export const RIGS = {
  dawn: {
    x: 0.84, y: -0.55, z: 110,
    color: [1.0, 0.78, 0.66],
    ambient: [0.26, 0.22, 0.21],
    intensity: 0.86,
    stretch: -2.4,
  },
  morning: {
    x: 0.84, y: -1.3, z: 210,
    color: [1.0, 0.95, 0.84],
    ambient: [0.30, 0.29, 0.27],
    intensity: 0.95,
    stretch: -1.15,
  },
  midday: {
    x: 0.8, y: -2.2, z: 320,
    color: [1.0, 0.99, 0.93],
    ambient: [0.32, 0.31, 0.30],
    intensity: 1.02,
    stretch: -0.35,
  },
  golden: {
    x: 0.86, y: -0.7, z: 130,
    color: [1.0, 0.82, 0.55],
    ambient: [0.27, 0.23, 0.21],
    intensity: 0.96,
    stretch: -2.1,
  },
  // sun is basically gone, the sky still holds a little heat
  dusk: {
    x: 0.9, y: -0.32, z: 88,
    color: [1.0, 0.68, 0.42],
    ambient: [0.22, 0.18, 0.16],
    intensity: 0.72,
    stretch: -3.1,
  },
  // the light source is now the torch line itself: low, warm and close, so
  // everything is lit from the fire rather than from above
  night: {
    x: 0.5, y: 0.72, z: 46,
    color: [1.0, 0.62, 0.28],
    ambient: [0.17, 0.13, 0.11],
    intensity: 0.58,
    stretch: -1.0,
  },
};

export function lightFor(part, w, h) {
  const rig = RIGS[part] || RIGS.midday;
  return {
    x: w * rig.x,
    y: h * rig.y,
    z: rig.z,
    // a sun barely falls off across a beach this size; the night rig is close
    // enough that it does, which is what makes the torches read as the source
    radius: part === "night" ? Math.max(420, w * 0.62) : Math.max(1400, w * 1.2),
    color: rig.color,
    ambient: rig.ambient,
    intensity: rig.intensity,
    stretch: rig.stretch,
    part,
  };
}
