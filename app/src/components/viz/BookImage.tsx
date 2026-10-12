"use client";

/**
 * `book_image` — THE BOOK'S OWN PICTURE, standing in for a figure no native
 * kind can draw yet (Samuel's answer 37d, 2026-10-01; `lib/question-figures.ts`).
 *
 * A static image under the app's own `/book-figures/` folder, never an
 * external address: `bookImageOf` refuses anything else, and a refused spec
 * throws `VizError`, which the registry's boundary turns into its quiet
 * "spec error" chip — never a broken image, never a request to another host.
 *
 * The book draws its diagrams as dark strokes on a transparent page, so the
 * picture sits on the card surface token; the frame around it is Visual's.
 * Nothing here tells the student it is a stand-in: that is an operator fact,
 * kept in the console's backlog ("needs native figure").
 */

import { bookImageOf } from "@/lib/question-figures";
import { VizError } from "./core";

export function BookImage({ spec }: { spec: Record<string, unknown>; animOn: boolean }) {
  const img = bookImageOf(spec);
  if (!img) throw new VizError("the book's picture has no valid address or description");
  return (
    // A static file the app serves itself, sized by its card: next/image's
    // optimiser would add nothing here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={img.src}
      alt={img.alt}
      loading="lazy"
      decoding="async"
      className="mx-auto block h-auto max-w-full bg-card"
    />
  );
}
