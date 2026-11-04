// ─────────────────────────────────────────────────────────
// Model Configuration — Tab 3 event binding (provenance fields and tag editor).
// ─────────────────────────────────────────────────────────

import type { ExtendedModelMetadata } from '../../../core/types';
import { toast } from '../../notify';
import { activeTagDescription, activeTagPlaceholder } from '../tagHelpers';
import type { ModelConfigEventContext } from '../types';

export function bindMetadataEvents(ctx: ModelConfigEventContext): void {
    if (!ctx.element) return;
    const config = ctx.handlers.getConfig();
    const meta: ExtendedModelMetadata = config.extendedMetadata ?? {};

    const syncMeta = () => {
      config.extendedMetadata = { ...meta };
      ctx.handlers.onConfigChange({ ...config });
    };

    // Author
    ctx.element.querySelector<HTMLInputElement>('#inp-cfg-meta-author')?.addEventListener('input', (e) => {
      meta.author = (e.target as HTMLInputElement).value;
      syncMeta();
    });

    // Version
    ctx.element.querySelector<HTMLInputElement>('#inp-cfg-meta-version')?.addEventListener('input', (e) => {
      meta.version = (e.target as HTMLInputElement).value;
      syncMeta();
    });

    // License
    ctx.element.querySelector<HTMLInputElement>('#inp-cfg-meta-license')?.addEventListener('input', (e) => {
      meta.license = (e.target as HTMLInputElement).value;
      syncMeta();
    });

    // URL
    ctx.element.querySelector<HTMLInputElement>('#inp-cfg-meta-url')?.addEventListener('input', (e) => {
      meta.sourceUrl = (e.target as HTMLInputElement).value;
      syncMeta();
    });

    // Description
    ctx.element.querySelector<HTMLTextAreaElement>('#inp-cfg-meta-desc')?.addEventListener('input', (e) => {
      meta.description = (e.target as HTMLTextAreaElement).value;
      syncMeta();
    });

    // Tag selector dropdown
    const selTag = ctx.element.querySelector<HTMLSelectElement>('#sel-cfg-standard-tag');
    const customKeyGroup = ctx.element.querySelector<HTMLElement>('#group-cfg-custom-key');
    const tagHelper = ctx.element.querySelector<HTMLElement>('#cfg-tag-helper-text');
    const inpVal = ctx.element.querySelector<HTMLInputElement>('#inp-cfg-tag-val');

    selTag?.addEventListener('change', () => {
      ctx.tags.selectedKey = selTag.value;
      if (customKeyGroup) {
        customKeyGroup.classList.toggle('is-hidden', ctx.tags.selectedKey !== 'custom');
      }
      if (tagHelper) {
        tagHelper.textContent = activeTagDescription(ctx.tags.selectedKey);
      }
      if (inpVal) {
        inpVal.placeholder = activeTagPlaceholder(ctx.tags.selectedKey);
      }
    });

    // Custom tag key input
    const inpCustomKey = ctx.element.querySelector<HTMLInputElement>('#inp-cfg-custom-tag-key');
    inpCustomKey?.addEventListener('input', () => {
      ctx.tags.customKey = inpCustomKey.value;
    });

    // Add Tag Button
    ctx.element.querySelector('#btn-cfg-add-tag')?.addEventListener('click', () => {
      let finalKey = '';
      if (ctx.tags.selectedKey === 'custom') {
        finalKey = (inpCustomKey?.value ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '');
        if (!finalKey) {
          toast('Please specify a valid tag key.', 'warning');
          return;
        }
      } else {
        finalKey = ctx.tags.selectedKey;
      }

      const val = (inpVal?.value ?? '').trim();
      if (!val) {
        toast('Please enter a value for the tag.', 'warning');
        return;
      }

      if (!meta.customAttributes) meta.customAttributes = [];
      meta.customAttributes.push({ tag: finalKey, value: val });
      syncMeta();
      toast(`Added tag "${finalKey}": "${val}"`, 'success');
      ctx.rerender();
    });

    // Remove Tag buttons
    ctx.element.querySelectorAll<HTMLButtonElement>('.btn-remove-tag').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-remove-tag-idx') ?? '-1', 10);
        if (idx >= 0 && meta.customAttributes && meta.customAttributes[idx]) {
          const removed = meta.customAttributes.splice(idx, 1)[0];
          syncMeta();
          toast(`Removed tag "${removed?.tag ?? idx}".`, 'info');
          ctx.rerender();
        }
      });
    });

    // 5-Layer Time Capsule Reprocess button
    ctx.element.querySelector('#btn-cfg-reprocess-capsule')?.addEventListener('click', () => {
      if (ctx.handlers.onReprocessFromPurestSource) {
        ctx.handlers.onReprocessFromPurestSource();
      } else {
        toast('Triggered lossless reprocess from purest source for current Time Capsule.', 'info');
      }
    });
}
