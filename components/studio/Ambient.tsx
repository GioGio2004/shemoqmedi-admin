"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ikUrl, isVideoUrl } from "./media";

// The background behind the glass: the posts' own artwork, blurred far out of
// focus and drifting slowly, under a wash and a film grain. Screens hand their
// pictures up with useAmbient(urls); with none, a soft neutral light.

const SetAmbient = createContext<(images: string[]) => void>(() => {});

/** Up to four picture URLs for the background, while the calling screen is mounted. */
export function useAmbient(images: readonly (string | null | undefined)[] | null | undefined) {
  const set = useContext(SetAmbient);
  const key = (images ?? [])
    .filter((u): u is string => typeof u === "string" && u.length > 0 && !isVideoUrl(u))
    .slice(0, 4)
    .join("\n");
  useEffect(() => {
    set(key ? key.split("\n") : []);
    return () => set([]);
  }, [key, set]);
}

/** Holds the screens' pictures and draws the ambient layer once, behind everything. */
export function AmbientProvider({ children }: { children: ReactNode }) {
  const [images, setImages] = useState<string[]>([]);
  return (
    <SetAmbient.Provider value={setImages}>
      <Ambient images={images} />
      {children}
    </SetAmbient.Provider>
  );
}

/** A 64px, heavily blurred copy (ImageKit); other hosts fall back to the plain small picture. */
function blurred(url: string) {
  const small = ikUrl(url, 64);
  return small === url ? url : `${small},bl-10`;
}

function Ambient({ images }: { images: string[] }) {
  // Four blobs; fewer pictures repeat.
  // Tiny and already blurred by ImageKit, scaled up by the browser: the same soft glow as
  // a CSS blur(90px), without four huge filtered layers for every glass pane to sample.
  const urls = images.length ? [0, 1, 2, 3].map((i) => blurred(images[i % images.length])) : null;
  return (
    <>
      <div className="st-ambient" aria-hidden="true">
        <div key={urls ? urls.join("|") : "neutral"} className={`st-ambient-set${urls ? "" : " is-neutral"}`}>
          {["b1", "b2", "b3", "b4"].map((b, i) => (
            <i key={b} className={`st-blob ${b}`} style={urls ? { backgroundImage: `url("${urls[i]}")` } : undefined} />
          ))}
        </div>
      </div>
      <div className="st-grain" aria-hidden="true" />
    </>
  );
}
