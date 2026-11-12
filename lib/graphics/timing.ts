// Render timings, logged in development only (one line per render):
//   graphics award/ig_portrait/glass 412 ms  fetch 31 · backdrop 88 · satori 190 · encode 61
// Production stays quiet; the numbers are for tuning, not monitoring.

export type Timer = {
  /** Time since the previous mark (or the start) is booked under `stage`. */
  mark: (stage: string) => void;
  /** Logs the line (dev only) and returns the total in ms. */
  done: () => number;
};

const enabled = () => process.env.NODE_ENV === "development" || process.env.GRAPHICS_TIMING === "1";

export function timer(label: string): Timer {
  const start = performance.now();
  let last = start;
  const stages: [string, number][] = [];
  return {
    mark(stage) {
      const now = performance.now();
      stages.push([stage, now - last]);
      last = now;
    },
    done() {
      const total = performance.now() - start;
      if (enabled()) {
        const parts = stages.map(([s, ms]) => `${s} ${Math.round(ms)}`).join(" · ");
        console.info(`graphics ${label} ${Math.round(total)} ms${parts ? `  ${parts}` : ""}`);
      }
      return total;
    },
  };
}
