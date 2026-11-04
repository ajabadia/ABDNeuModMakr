// ─────────────────────────────────────────────────────────
// Model Configuration — metadata tag field helpers.
// The placeholder/description lookup used to be duplicated in
// two near-identical modal methods; it lives here once.
// ─────────────────────────────────────────────────────────

import { STANDARD_SOUNDFONT_TAGS } from '../../core/soundfontMetadata';

const CUSTOM_TAG_DESCRIPTION =
  'Custom user tag: stored alongside model metadata and preserved during export.';

/** Placeholder for the value input of the currently selected tag attribute. */
export function activeTagPlaceholder(selectedKey: string): string {
  if (selectedKey === 'custom') return 'Enter custom attribute value...';
  const def = STANDARD_SOUNDFONT_TAGS.find((t) => t.key === selectedKey);
  return def ? def.placeholder : 'Enter value...';
}

/** Helper text explaining what the currently selected tag attribute means. */
export function activeTagDescription(selectedKey: string): string {
  if (selectedKey === 'custom') return CUSTOM_TAG_DESCRIPTION;
  const def = STANDARD_SOUNDFONT_TAGS.find((t) => t.key === selectedKey);
  return def ? def.description : '';
}
