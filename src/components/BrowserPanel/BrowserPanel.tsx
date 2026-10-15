import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../../store/project';
import type { AudioAsset } from '../../types/project';
import './BrowserPanel.css';

interface BrowserWebview extends HTMLElement {
  loadURL: (url: string) => void;
  getURL: () => string;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
}

interface DownloadedAudio { name: string; path: string }

interface BrowserPanelProps { onClose: () => void }

const BrowserPanel: React.FC<BrowserPanelProps> = ({ onClose }) => {
  const webviewRef = useRef<BrowserWebview | null>(null);
  const { project, addAudioAsset } = useProjectStore();
  const [address, setAddress] = useState('https://www.google.com');
  const [downloads, setDownloads] = useState<DownloadedAudio[]>([]);
  const [addedPaths, setAddedPaths] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const refreshDownloads = useCallback(async () => {
    const list = await window.electronAPI?.listAudioDownloads();
    if (list) setDownloads(list);
  }, []);

  useEffect(() => {
    void refreshDownloads();
    const unsubscribe = window.electronAPI?.on('browser:download-complete', () => { void refreshDownloads(); });
    return () => unsubscribe?.();
  }, [refreshDownloads]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    const updateAddress = () => {
      const current = webview.getURL();
      if (current) setAddress(current);
    };
    const onFailed = (event: Event) => {
      const detail = event as Event & { errorDescription?: string; validatedURL?: string };
      if (detail.validatedURL?.startsWith('http')) setError(detail.errorDescription || 'Could not load this page.');
    };
    webview.addEventListener('did-navigate', updateAddress);
    webview.addEventListener('did-navigate-in-page', updateAddress);
    webview.addEventListener('did-fail-load', onFailed);
    return () => {
      webview.removeEventListener('did-navigate', updateAddress);
      webview.removeEventListener('did-navigate-in-page', updateAddress);
      webview.removeEventListener('did-fail-load', onFailed);
    };
  }, []);

  const navigate = () => {
    const value = address.trim();
    if (!value) return;
    const url = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
    if (!/^https?:\/\//i.test(url)) {
      setError('Enter a website address starting with http:// or https://');
      return;
    }
    setError('');
    setAddress(url);
    webviewRef.current?.loadURL(url);
  };

  const importDownload = async (download: DownloadedAudio) => {
    if (project.audioAssets?.some(asset => asset.file === download.path)) {
      setAddedPaths(paths => new Set(paths).add(download.path));
      return;
    }
    const result = await window.electronAPI?.readFileBinary(download.path);
    if (!result?.success || !result.data) { setError('Could not read the downloaded audio file.'); return; }
    let duration: number | undefined;
    const context = new AudioContext();
    try {
      const bytes = Uint8Array.from(atob(result.data), char => char.charCodeAt(0));
      duration = (await context.decodeAudioData(bytes.buffer)).duration * 1000;
    } catch {
      // Some valid audio formats are supported by the export engine but not by
      // Chromium's Web Audio decoder. Keep the asset importable without duration metadata.
      setError('Audio imported without duration metadata; the timeline will use the source file duration when available.');
    } finally { await context.close(); }
    const asset: AudioAsset = {
      id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      file: download.path,
      name: download.name,
      duration
    };
    addAudioAsset(asset);
    setAddedPaths(paths => new Set(paths).add(download.path));
  };

  return (
    <aside className="browser-panel">
      <div className="browser-panel-header">
        <strong>Browser</strong>
        <button className="btn-icon" onClick={onClose} title="Close browser">×</button>
      </div>
      <div className="browser-controls">
        <button className="btn btn-sm" title="Back" onClick={() => webviewRef.current?.canGoBack() && webviewRef.current.goBack()}>‹</button>
        <button className="btn btn-sm" title="Forward" onClick={() => webviewRef.current?.canGoForward() && webviewRef.current.goForward()}>›</button>
        <button className="btn btn-sm" title="Reload" onClick={() => webviewRef.current?.reload()}>↻</button>
        <form className="browser-address-form" onSubmit={event => { event.preventDefault(); navigate(); }}>
          <input aria-label="Website address" value={address} onChange={event => setAddress(event.target.value)} />
        </form>
        <button className="btn btn-sm btn-primary" onClick={navigate}>Go</button>
      </div>
      {error && <div className="browser-error">{error}<button className="btn-icon" onClick={() => setError('')}>×</button></div>}
      <div className="browser-view">
        {/* @ts-ignore Electron webview element */}
        <webview
          ref={webviewRef as React.RefObject<BrowserWebview & HTMLElement>}
          src="https://www.google.com"
          partition="h2v-browser"
          webpreferences="contextIsolation=yes, nodeIntegration=no, sandbox=yes"
          style={{ display: 'inline-flex', width: '100%', height: '100%' }}
        />
      </div>
      <div className="browser-downloads">
        <div className="browser-downloads-title"><strong>Downloaded audio</strong><button className="btn btn-sm" onClick={() => void refreshDownloads()}>Refresh</button></div>
        {downloads.length === 0 ? <p className="hint">Audio downloaded in this browser appears here.</p> : downloads.map(download => {
          const exists = addedPaths.has(download.path) || !!project.audioAssets?.some(asset => asset.file === download.path);
          return <div className="browser-download-item" key={download.path} title={download.path}>
            <span>{download.name}</span>
            <button className="btn btn-sm btn-primary" disabled={exists} onClick={() => void importDownload(download)}>{exists ? 'Added' : 'Add to Audio'}</button>
          </div>;
        })}
      </div>
    </aside>
  );
};

export default BrowserPanel;
