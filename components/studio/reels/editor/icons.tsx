// The reel editor's own line icons (same grid and stroke as components/studio/icons.tsx).

type IconProps = { size?: number; className?: string };

function Svg({ size = 22, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg aria-hidden="true" className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
  </Svg>
);
export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 5.5v13M16 5.5v13" strokeWidth="2.6" />
  </Svg>
);
export const UndoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 7 4.5 11.5 9 16" />
    <path d="M5 11.5h9.5a5 5 0 0 1 0 10H12" />
  </Svg>
);
export const RedoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m15 7 4.5 4.5L15 16" />
    <path d="M19 11.5H9.5a5 5 0 0 0 0 10H12" />
  </Svg>
);
export const DuplicateIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="8" y="8" width="12" height="12" rx="3" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </Svg>
);
export const MoveLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 6 8.5 12l6 6" />
  </Svg>
);
export const MoveRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9.5 6 6 6-6 6" />
  </Svg>
);
export const AddClipIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="3" />
    <path d="M12 9v6M9 12h6" />
  </Svg>
);
export const AudioIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 18V6l10-2v12" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="16.5" cy="16" r="2.5" />
  </Svg>
);
export const CaptionsIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M7 15h4M13 15h4M7 11.5h10" />
  </Svg>
);
export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Svg>
);
export const EditIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 19.5 5.5 15 15.5 5a2.1 2.1 0 0 1 3 3l-10 10z" />
    <path d="m13.5 7 3 3" />
  </Svg>
);
export const MicIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="3.5" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
  </Svg>
);
export const UploadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9" />
    <path d="M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
  </Svg>
);
export const RenderIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.6 2.6M15.4 15.4 18 18M6 18l2.6-2.6M15.4 8.6 18 6" />
  </Svg>
);
export const TransitionIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h11l-3-3M20 17H9l3 3" />
  </Svg>
);
