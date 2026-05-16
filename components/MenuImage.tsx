import { Image } from "@imagekit/next";
import type { IKImageProps } from "@imagekit/next";

// ─── Types ────────────────────────────────────────────────────────────────────

/** All IKImageProps are supported; width/height default to 1200×1200. */
export type MenuImageProps = Omit<IKImageProps, "urlEndpoint"> & {
  /** Path relative to your ImageKit account root, e.g. "/menu-items/cafe-slug-item-slug-tbilisi.webp" */
  src: string;
  alt: string;
  width?: number;
  height?: number;
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * `MenuImage` is a thin wrapper around the ImageKit `<Image />` component
 * pre-configured for menu item photos:
 *
 * - Serves images via NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT
 * - Defaults to 1200 × 1200 px (override as needed)
 * - Sets `loading="lazy"` to defer off-screen images and protect Core Web Vitals
 */
export function MenuImage({
  src,
  alt,
  width = 1200,
  height = 1200,
  ...rest
}: MenuImageProps) {
  const urlEndpoint = process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT;

  if (!urlEndpoint) {
    console.warn(
      "[MenuImage] NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT is not defined. Image will not render."
    );
    return null;
  }

  return (
    <Image
      urlEndpoint={urlEndpoint}
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      {...rest}
    />
  );
}
