import React, { useState, useEffect, useRef } from 'react';
import { useProjectStore } from '../../store/project';
import type { RenderProgress } from '../../types/project';
import './ExportDialog.css';

// Each preset has a unique id used as the <option> value. (Before, the label was the value and HTML collapses
// repeated spaces, so '4K    (3840×2160)' never matched its preset and could not be selected.)
const RESOLUTION_PRESETS = [
  { id: '720',    label: '720p HD (1280×720)',          width: 1280, height: 720 },
  { id: '1080',   label: '1080p Full HD (1920×1080)',   width: 1920, height: 1080 },
  { id: '1440',   label: '1440p QHD / 2K (2560×1440)',  width: 2560, height: 1440 },
  { id: '2160',   label: '2160p UHD / 4K (3840×2160)',  width: 3840, height: 2160 },
  { id: 'custom', label: 'Custom',                      width: 0,    height: 0 }
];

interface ExportDialogProps {
  onClose: () => void;
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

const ExportDialog: React.FC<ExportDialogProps> = ({ onClose }) => {
  const { project, updateExportSettings } = useProjectStore();
  const exp = project.export;

  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress]       = useState<RenderProgress | null>(null);
  const [jobId, setJobId]             = useState<string | null>(null);
  const [outputFile, setOutputFile]   = useState('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const unsubsRef = useRef<Array<() => void>>([]);

  // Resolve current preset
  const currentPreset =
    RESOLUTION_PRESETS.find(p => p.width === exp.width && p.height === exp.height) ||
    RESOLUTION_PRESETS[RESOLUTION_PRESETS.length - 1];

  const handlePresetChange = (id: string) => {
    const p = RESOLUTION_PRESETS.find(x => x.id === id);
    if (p && p.width > 0) updateExportSettings({ width: p.width, height: p.height });
  };

  const startExport = async () => {
    if (!window.electronAPI) return;

    // Pick output path
    const baseName = project.source.file
      .split(/[/\\]/).pop()!.replace(/\.html?$/i, '') || 'export';

    const saveResult = await window.electronAPI.showSaveDialog({
      title: 'Export Video',
      defaultPath: `${baseName}_export.mp4`,
      filters: [{ name: 'Video Files', extensions: ['mp4'] }]
    });
    if (saveResult.canceled || !saveResult.filePath) return;

    const outFile = saveResult.filePath;
    setOutputFile(outFile);
    setIsRendering(true);
    setRenderError(null);
    setProgress(null);

    const newJobId = `render-${Date.now()}`;
    setJobId(newJobId);

    // Subscribe to render events
    const unsub1 = window.electronAPI.on('render:progress', (...args) => {
      const data = args[0] as RenderProgress;
      if (data.jobId === newJobId) setProgress(data);
    });
    const unsub2 = window.electronAPI.on('render:complete', (...args) => {
      const data = args[0] as { jobId: string };
      if (data.jobId === newJobId) {
        setIsRendering(false);
        setProgress(prev => prev ? { ...prev, percent: 100, stage: 'done' } : {
          jobId: newJobId, percent: 100, framesDone: 0, totalFrames: 0,
          elapsedMs: 0, etaMs: 0, stage: 'done'
        });
      }
    });
    const unsub3 = window.electronAPI.on('render:error', (...args) => {
      const data = args[0] as { jobId: string; error: string };
      if (data.jobId === newJobId) {
        setIsRendering(false);
        setRenderError(data.error);
      }
    });
    unsubsRef.current = [unsub1, unsub2, unsub3];

    // Determine parallel worker count
    const cpuCount  = await window.electronAPI.getCpuCount().catch(() => 2);
    const workerCount = Math.max(1, Math.floor((cpuCount as number) / 2));

    const result = await window.electronAPI.startRender({
      jobId: newJobId,
      htmlFile: project.source.file,
      htmlContent: project.source.htmlContent,
      projectData: project,
      outputFile: outFile,
      width:  exp.width,
      height: exp.height,
      fps:    exp.fps,
      codec:  exp.codec,
      crf:    exp.crf,
      useJpeg: exp.useJpeg || false,
      audioFiles: project.audio,
      workerCount
    });

    if (!result.success) {
      setIsRendering(false);
      setRenderError(result.error || 'Unknown error starting render');
    }
  };

  const cancelRender = async () => {
    if (jobId && window.electronAPI) {
      await window.electronAPI.cancelRender(jobId);
    }
    unsubsRef.current.forEach(fn => fn());
    unsubsRef.current = [];
    setIsRendering(false);
    setProgress(null);
    setJobId(null);
  };

  useEffect(() => {
    return () => { unsubsRef.current.forEach(fn => fn()); };
  }, []);

  const totalFrames = Math.round(project.source.duration / 1000 * exp.fps);

  return (
    <div className="modal-overlay" onClick={!isRendering ? onClose : undefined}>
      <div className="modal export-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header">
          <h2>🎬 Export Video</h2>
          {!isRendering && <button className="btn-icon" onClick={onClose}>✕</button>}
        </div>

        {/* Body */}
        <div className="modal-body">
          {!isRendering ? (
            /* ── Settings form ─────────────────────────────────── */
            <div className="export-settings">
              {/* Resolution */}
              <div className="field-group">
                <h4>Resolution</h4>
                <div className="field-row">
                  <label>Preset</label>
                  <select
                    value={currentPreset.id}
                    onChange={e => handlePresetChange(e.target.value)}
                  >
                    {RESOLUTION_PRESETS.map(p => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label>Width</label>
                    <input type="number" value={exp.width}
                      onChange={e => updateExportSettings({ width: Math.max(16, (parseInt(e.target.value) || exp.width) & ~1) })} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label>Height</label>
                    <input type="number" value={exp.height}
                      onChange={e => updateExportSettings({ height: Math.max(16, (parseInt(e.target.value) || exp.height) & ~1) })} />
                  </div>
                </div>
              </div>

              {exp.width >= 3840 && (
                <div className="hint" style={{ margin: '-4px 0 8px' }}>
                  4K renders {exp.width}×{exp.height} frames — it needs more RAM and time. Use Fast Mode (JPEG) if it feels slow.
                </div>
              )}

              {/* Video */}
              <div className="field-group">
                <h4>Video Settings</h4>
                <div className="field-row">
                  <label>Frame Rate</label>
                  <select value={exp.fps}
                    onChange={e => updateExportSettings({ fps: parseInt(e.target.value) as 24 | 30 | 60 })}>
                    <option value={24}>24 fps</option>
                    <option value={30}>30 fps</option>
                    <option value={60}>60 fps</option>
                  </select>
                </div>
                <div className="field-row">
                  <label>Codec</label>
                  <select value={exp.codec}
                    onChange={e => updateExportSettings({ codec: e.target.value as 'h264' | 'h265' })}>
                    <option value="h264">H.264 (MP4) — Best Compatibility</option>
                    <option value="h265">H.265 (HEVC) — Smaller File</option>
                  </select>
                </div>
                <div className="field-row">
                  <label>Quality (CRF)</label>
                  <input type="range" min={14} max={23} step={1} value={exp.crf}
                    onChange={e => updateExportSettings({ crf: parseInt(e.target.value) })}
                    style={{ flex: 1 }} />
                  <span className="crf-label">{exp.crf}</span>
                  <span className="crf-hint">
                    {exp.crf <= 16 ? '(Best)' : exp.crf >= 21 ? '(Fastest)' : '(Balanced)'}
                  </span>
                </div>
                <div className="field-row">
                  <label>Fast Mode</label>
                  <input type="checkbox" checked={exp.useJpeg || false}
                    onChange={e => updateExportSettings({ useJpeg: e.target.checked })}
                    style={{ width: 'auto', flex: 'none' }} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    JPEG frames (faster, slightly lower quality)
                  </span>
                </div>
              </div>

              {/* Summary */}
              <div className="export-summary">
                <strong>Summary:</strong>{' '}
                {exp.width}×{exp.height} @ {exp.fps} fps · {exp.codec.toUpperCase()} CRF {exp.crf}
                {' · '}{totalFrames.toLocaleString()} frames to capture
                {project.audio.length > 0 && ` · ${project.audio.length} audio track(s)`}
              </div>

              {renderError && (
                <div className="export-error">❌ {renderError}</div>
              )}
            </div>
          ) : (
            /* ── Render progress ────────────────────────────────── */
            <div className="render-progress">
              <div className="progress-info">
                <span>
                  {progress?.stage === 'done'     ? '✅ Done!' :
                   progress?.stage === 'encoding' ? '🎞 Encoding...' :
                                                    '📸 Capturing frames...'}
                </span>
                <span className="progress-pct">{(progress?.percent ?? 0).toFixed(1)}%</span>
              </div>

              <div className="progress-bar-container">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${progress?.percent ?? 0}%` }}
                />
              </div>

              <div className="progress-details">
                <span>Frames: {progress?.framesDone ?? 0} / {progress?.totalFrames ?? '?'}</span>
                <span>Elapsed: {formatTime(progress?.elapsedMs ?? 0)}</span>
                <span>ETA: {progress?.etaMs ? formatTime(progress.etaMs) : '—'}</span>
              </div>

              {progress?.stage === 'done' && (
                <div className="done-actions">
                  <p>Saved to: <code>{outputFile}</code></p>
                  <button className="btn btn-primary"
                    onClick={() => window.electronAPI?.showItemInFolder(outputFile)}>
                    📁 Show in Folder
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          {isRendering ? (
            progress?.stage === 'done' ? (
              <button className="btn btn-primary" onClick={onClose}>Close</button>
            ) : (
              <button className="btn btn-danger" onClick={cancelRender}>⏹ Cancel</button>
            )
          ) : (
            <>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={startExport}
                disabled={!project.source.file}
              >
                🎬 Start Export
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExportDialog;
