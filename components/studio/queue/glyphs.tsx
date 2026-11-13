// The queue's own small glyphs: the four networks, and the bits of the
// Instagram / Facebook chrome the previews draw. Same 24px grid as icons.tsx.

import type { Network } from "@/lib/studio/captions";

type P = { size?: number; className?: string };

function Svg({ size = 22, className, stroke = 1.8, children }: P & { stroke?: number; children: React.ReactNode }) {
  return (
    <svg aria-hidden="true" focusable="false" className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export const InstagramGlyph = (p: P) => (
  <Svg {...p}>
    <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
);
export const FacebookGlyph = (p: P) => (
  <Svg {...p}>
    <path d="M13.6 20.5v-7.3h2.5l.4-2.9h-2.9V8.5c0-.8.3-1.4 1.5-1.4h1.5V4.6c-.3 0-1.1-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2h-2.5v2.9h2.5v7.3z" fill="currentColor" stroke="none" />
  </Svg>
);
export const ThreadsGlyph = (p: P) => (
  <Svg {...p}>
    <path d="M16.2 11.2c-.4-2.3-1.9-3.6-4.2-3.6-2.6 0-4.4 1.9-4.4 4.6 0 2.6 1.7 4.4 4.1 4.4 1.9 0 3.2-1.1 3.2-2.6 0-1.6-1.4-2.4-3.4-2.4-1.3 0-2.2.6-2.2 1.5 0 .8.7 1.3 1.6 1.3" />
    <path d="M19.5 12c0 4.6-3 7.5-7.4 7.5S4.5 16.6 4.5 12 7.6 4.5 12.1 4.5c3.3 0 5.6 1.5 6.7 4.2" />
  </Svg>
);
export const LinkedInGlyph = (p: P) => (
  <Svg {...p}>
    <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3.5" />
    <path d="M8 10.6V16M8 7.9v.1M11.6 16v-5.4M11.6 13.1c0-1.6.9-2.6 2.2-2.6s2.2.9 2.2 2.6V16" />
  </Svg>
);

const NET: Record<Network, (p: P) => React.ReactElement> = { instagram: InstagramGlyph, facebook: FacebookGlyph, threads: ThreadsGlyph, linkedin: LinkedInGlyph };

/** A network's glyph. */
export function NetGlyph({ network, ...p }: P & { network: Network }) {
  const G = NET[network];
  return <G {...p} />;
}

export const HeartGlyph = (p: P) => (
  <Svg {...p}>
    <path d="M12 19.5s-7.5-4.4-7.5-9.6A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 2.3c0 5.2-7.5 9.6-7.5 9.6z" />
  </Svg>
);
export const CommentGlyph = (p: P) => (
  <Svg {...p}>
    <path d="M20 11.6a8 8 0 0 1-11.6 7.1L4 20l1.3-4.2A8 8 0 1 1 20 11.6z" />
  </Svg>
);
export const SendGlyph = (p: P) => (
  <Svg {...p}>
    <path d="M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4z" />
  </Svg>
);
export const SaveGlyph = (p: P) => (
  <Svg {...p}>
    <path d="M6.5 4h11v16.5L12 16.6 6.5 20.5z" />
  </Svg>
);
export const MoreGlyph = (p: P) => (
  <Svg {...p}>
    <circle cx="5.5" cy="12" r="1.3" fill="currentColor" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    <circle cx="18.5" cy="12" r="1.3" fill="currentColor" />
  </Svg>
);
export const LikeGlyph = (p: P) => (
  <Svg {...p}>
    <path d="M7.5 10.5V20H4.5v-9.5zM7.5 10.5l3.6-6.3a1.8 1.8 0 0 1 3.3 1.3l-.9 3.9h5a1.8 1.8 0 0 1 1.8 2.1l-1.2 6.6a2.3 2.3 0 0 1-2.3 1.9H7.5" />
  </Svg>
);
export const ShareGlyph = (p: P) => (
  <Svg {...p}>
    <path d="M13.5 5.5 20 11.5l-6.5 6v-3.3c-4.6 0-7.4 1.3-9.5 4.8.6-5 3.3-8.6 9.5-9.3z" />
  </Svg>
);
export const GlobeGlyph = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.4 2.6 3.4 5.4 3.4 8.5s-1 5.9-3.4 8.5c-2.4-2.6-3.4-5.4-3.4-8.5s1-5.9 3.4-8.5z" />
  </Svg>
);
export const PlayGlyph = (p: P) => (
  <Svg {...p}>
    <path d="M8.5 6.5v11l9-5.5z" fill="currentColor" stroke="none" />
  </Svg>
);
