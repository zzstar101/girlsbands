// Share images embed the announcement's own picture. satori cannot fetch URLs, so the bytes go into
// the card as a data URL — fetched through the same guarded, cached pipeline as the site's own images
// (see media/images.ts), never straight off the wire. A picture that cannot be had is not an error:
// the card falls back to the text-only layout it had before.
import type { CoverView } from "@girlsbands/contracts/site";
import { produceImage } from "@girlsbands/backend/media/images";
import { proxySource } from "@girlsbands/backend/media/imgproxy";
import type { OgImage } from "./render.ts";

/**
 * How long a card waits for its picture. The fetch itself may take longer (20 s) and keeps running into
 * the disk cache; the card just renders without it rather than holding a share crawler open.
 */
const IMAGE_WAIT_MS = 5000;
/** Data URLs go into the ETag input and into satori's tree, so stay far below the 15 MB fetch cap. */
const MAX_BYTES = 4 * 1024 * 1024;

export async function ogImage(cover: CoverView | null | undefined, size: { width: number; height: number }): Promise<OgImage | null> {
  const source = proxySource(cover?.url ?? null);
  if (!source) return null;
  const job = produceImage(source, "image-720");
  // The loser of the race below still settles later; without this it would be an unhandled rejection.
  job.catch(() => {});
  try {
    const image = await Promise.race([job, new Promise<null>((resolve) => { setTimeout(() => resolve(null), IMAGE_WAIT_MS).unref(); })]);
    if (!image || image.body.length === 0 || image.body.length > MAX_BYTES) return null;
    return { data: `data:${image.type};base64,${image.body.toString("base64")}`, ...size };
  } catch {
    return null;
  }
}
