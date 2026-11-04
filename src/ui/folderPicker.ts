// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Unified Filesystem Folder Picker Helper
//
// Opens a native OS folder selection dialog via Companion Bridge
// (`/api/fs/browse_folder`) so full local paths (e.g. `D:\...`)
// are returned, with automatic fallback to the browser's
// File System Access API (`showDirectoryPicker`) or `<input webkitdirectory>`
// when running offline without Companion Bridge.
// ─────────────────────────────────────────────────────────

import { bridgeClient } from '../core/bridge/BridgeClient.ts';

export interface BrowseFolderOptions {
  initialPath?: string;
  title?: string;
}

function mergeBrowserFolderWithBasePath(currentPath: string, folderName: string): string {
  const trimmed = currentPath.trim();
  if (!trimmed) return folderName;
  const useBackslash = trimmed.includes('\\') || /^[a-zA-Z]:/.test(trimmed);
  const sep = useBackslash ? '\\' : '/';
  const normalized = trimmed.replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/);
  if (parts.length > 1) {
    parts[parts.length - 1] = folderName;
    return parts.join(sep);
  }
  return `${normalized}${sep}${folderName}`;
}

export async function browseFilesystemFolder(
  options: BrowseFolderOptions = {}
): Promise<string | null> {
  const initialPath = options.initialPath?.trim() ?? '';
  const title = options.title ?? 'Seleccionar carpeta';

  // 1. Primary path: Local Companion Bridge native OS folder dialog (returns full absolute disk path)
  if (bridgeClient.isConnected()) {
    try {
      const res = await bridgeClient.browseLocalFolder(initialPath, title);
      if (res.cancelled) return null;
      if (res.path && res.path.trim().length > 0) {
        return res.path.trim();
      }
    } catch {
      // Fall through to browser directory picker if endpoint is unavailable
    }
  }

  // 2. Fallback A: Browser File System Access API (`window.showDirectoryPicker`)
  const win = window as Window & {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<{ name: string }>;
  };
  if (typeof win.showDirectoryPicker === 'function') {
    try {
      const handle = await win.showDirectoryPicker({ mode: 'read' });
      if (handle?.name) {
        return mergeBrowserFolderWithBasePath(initialPath, handle.name);
      }
      return null;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return null;
      }
    }
  }

  // 3. Fallback B: Standard `<input type="file" webkitdirectory>`
  return new Promise<string | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.className = 'is-hidden-file';
    document.body.appendChild(input);

    let settled = false;
    const cleanup = () => {
      input.remove();
    };

    input.addEventListener('change', () => {
      if (settled) return;
      settled = true;
      const files = input.files;
      if (files && files.length > 0) {
        const rel = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || '';
        const folderName = rel.split('/')[0] || '';
        cleanup();
        resolve(folderName ? mergeBrowserFolderWithBasePath(initialPath, folderName) : null);
      } else {
        cleanup();
        resolve(null);
      }
    });

    input.addEventListener('cancel', () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    });

    input.click();
  });
}
