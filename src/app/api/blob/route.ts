import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Vercel Blob client-upload token handler.
 *
 * The browser calls this route to obtain a short-lived upload token so it can
 * PUT the file directly to the private Blob store without routing the bytes
 * through this server.  The raw document data therefore never touches Vercel
 * Function memory on the way in.
 */

const ALLOWED_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'application/pdf',
  'text/plain',
  'text/markdown',
];

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        // Restrict what the client is allowed to upload.
        // No user-auth check is needed here because this app has no accounts;
        // access is already limited by network / Vercel project.
        return {
          access: 'private' as const,
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          // We embed a UUID in the pathname from the client side, so no extra
          // random suffix is necessary.
          addRandomSuffix: false,
        };
      },
      onUploadCompleted: async () => {
        // Nothing to do on upload completion – the API routes fetch and delete
        // the blob on demand when processing starts.
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
