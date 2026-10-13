import { useEffect } from 'react';
import { useProjectStore } from '../store/project';

/** Ctrl/Cmd + C / X / V / D for scenes and elements. Ignored while typing in an input. */
export function useClipboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const st = useProjectStore.getState();
      const k = e.key.toLowerCase();
      if (k === 'c') { if (st.copySelection()) e.preventDefault(); }
      else if (k === 'x') { if (st.cutSelection()) e.preventDefault(); }
      else if (k === 'v') { if (st.pasteClipboard()) e.preventDefault(); }
      else if (k === 'd') { if (st.duplicateSelection()) e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
