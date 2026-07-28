import type { SavedImage } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Default maximum-detail prompt template
// Used when promptTemplate is absent or empty.
// ─────────────────────────────────────────────────────────────────────────────
export const defaultMaximumDetailTemplate =
  'You have {imageCount} image(s). Examine each image carefully and provide a detailed description including objects, text, scene composition, colors, and any notable features. Answer in the same language as the user request: {userText}';

// ─────────────────────────────────────────────────────────────────────────────
// renderTemplate — substitute {imageCount} and {userText} placeholders
// If template is empty, returns the defaultMaximumDetailTemplate.
// ─────────────────────────────────────────────────────────────────────────────
export function renderTemplate(
  template: string,
  images: SavedImage[],
  userText: string,
): string {
  const resolved = template || defaultMaximumDetailTemplate;
  const imageCount = images.length;

  return resolved
    .replace(/\{imageCount\}/g, String(imageCount))
    .replace(/\{userText\}/g, userText);
}
