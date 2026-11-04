// ─────────────────────────────────────────────────────────
// Model Configuration — Tab 4 event binding (cover artwork picker and dropzone).
// ─────────────────────────────────────────────────────────

import { toast } from '../../notify';
import type { ModelConfigEventContext } from '../types';

export function bindArtworkEvents(ctx: ModelConfigEventContext): void {
    if (!ctx.element) return;

    // Pick cover file
    const fileInp = ctx.element.querySelector<HTMLInputElement>('#inp-cfg-cover-file');
    ctx.element.querySelector('#btn-cfg-pick-cover')?.addEventListener('click', () => {
      fileInp?.click();
    });

    fileInp?.addEventListener('change', () => {
      const f = fileInp.files?.[0];
      if (f) {
        ctx.handlers.onSelectCoverImage?.(f);
      }
    });

    // Remove cover
    ctx.element.querySelector('#btn-cfg-remove-cover')?.addEventListener('click', () => {
      ctx.handlers.onRemoveCoverImage?.();
    });

    // Dropzone
    const dz = ctx.element.querySelector<HTMLElement>('#cfg-cover-dropzone');
    if (dz) {
      dz.addEventListener('dragover', (e) => {
        e.preventDefault();
        dz.classList.add('is-dragover');
      });
      dz.addEventListener('dragleave', () => {
        dz.classList.remove('is-dragover');
      });
      dz.addEventListener('drop', (e) => {
        e.preventDefault();
        dz.classList.remove('is-dragover');
        const f = e.dataTransfer?.files?.[0];
        if (f && f.type.startsWith('image/')) {
          ctx.handlers.onSelectCoverImage?.(f);
        } else {
          toast('Please drop an image file (PNG, JPG, WebP, SVG, AVIF).', 'warning');
        }
      });
    }

    // AI Artwork Generator (Roadmap Phase 20)
    ctx.element.querySelector('#btn-cfg-ai-cover')?.addEventListener('click', () => {
      if (ctx.handlers.onOpenAiCoverGenerator) {
        ctx.handlers.onOpenAiCoverGenerator();
      } else {
        toast('Opening AI Cover Artwork Generator...', 'info');
      }
    });
}
