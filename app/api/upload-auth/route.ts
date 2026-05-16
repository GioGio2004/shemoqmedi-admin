import { getUploadAuthParams } from "@imagekit/next/server";
import { NextResponse } from "next/server";

/**
 * GET /api/upload-auth
 *
 * Returns short-lived ImageKit upload credentials to the client-side
 * uploader. Never expose IMAGEKIT_PRIVATE_KEY to the browser.
 */
export async function GET() {
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
  const publicKey = process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY;

  if (!privateKey || !publicKey) {
    return NextResponse.json(
      { error: "ImageKit credentials are not configured." },
      { status: 500 }
    );
  }

  // Tokens expire in 30 minutes (SDK default). Generate fresh params on each request.
  const authParams = getUploadAuthParams({ privateKey, publicKey });

  return NextResponse.json({
    token: authParams.token,
    signature: authParams.signature,
    expire: authParams.expire,
    publicKey,
  });
}
