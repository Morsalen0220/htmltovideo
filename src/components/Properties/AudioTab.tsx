import React, { useRef } from 'react';
import { useProjectStore } from '../../store/project';
import type { AudioAsset, AudioClip } from '../../types/project';

interface AudioTabProps {
  selectedClip?: AudioClip;
  onSelectClip: (id: string) => void;
}

const AudioTab: React.FC<AudioTabProps> = ({ selectedClip, onSelectClip }) => {
  const { project, currentTimeMs, addAudioAsset, removeAudioAsset, updateAudio, removeAudio, splitAudio } = useProjectStore();
  const durationCache = useRef(new Map<string, number>());
  const assets = project.audioAssets ?? [];

  const readDuration = async (context: AudioContext, file: string): Promise<number | undefined> => {
    const cached = durationCache.current.get(file);
    if (cached !== undefined) return cached;
    const result = await window.electronAPI?.readFileBinary(file);
    if (!result?.success || !result.data) return undefined;
    const bytes = Uint8Array.from(atob(result.data), char => char.charCodeAt(0));
    const decoded = await context.decodeAudioData(bytes.buffer);
    const duration = decoded.duration * 1000;
    durationCache.current.set(file, duration);
    return duration;
  };

  const importAudio = async () => {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.showOpenDialog({
      title: 'Import Audio to Bin',
      filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'aiff', 'aif'] }],
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled) return;

    const confirmed = window.confirm(
      'Music Copyright Notice\n\nMake sure you have the right to use any audio files you import. Using copyrighted music without permission may violate copyright law.\n\nClick OK to confirm you have the rights to use this audio.'
    );
    if (!confirmed) return;

    const context = new AudioContext();
    try {
      for (const [i, file] of result.filePaths.entries()) {
        if (assets.some(asset => asset.file === file)) continue;
        let duration: number | undefined;
        try { duration = await readDuration(context, file); }
        catch (error) { console.warn(`[Audio import] Could not read ${file}`, error); }
        const asset: AudioAsset = {
          id: `asset-${Date.now()}-${i}`,
          file,
          name: file.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, ''),
          duration
        };
        addAudioAsset(asset);
      }
    } finally { await context.close(); }
  };

  const handleAssetDragStart = (event: React.DragEvent, asset: AudioAsset) => {
    event.dataTransfer.setData('application/x-h2v-audio-asset', asset.id);
    event.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="tab-section">
      {selectedClip && (
        <div className="field-group">
          <div className="audio-clip-header">
            <span className="audio-name">{selectedClip.name}</span>
            <button className="btn-icon" onClick={() => removeAudio(selectedClip.id)} title="Remove from timeline">×</button>
          </div>
          <button
            className="btn btn-sm"
            style={{ width: '100%', marginBottom: 10 }}
            disabled={!selectedClip.duration || currentTimeMs <= selectedClip.start + 50 || currentTimeMs >= selectedClip.start + selectedClip.duration - selectedClip.trimIn - selectedClip.trimOut - 50}
            onClick={() => splitAudio(selectedClip.id, currentTimeMs, selectedClip.duration)}
            title="Split this clip at the current playhead position"
          >✂ Split at Playhead</button>
          <div className="field-row">
            <label>Start (s)</label>
            <input type="number" value={(selectedClip.start / 1000).toFixed(1)} min={0} step={0.1}
              onChange={e => updateAudio(selectedClip.id, { start: Math.max(0, Number(e.target.value) * 1000) })} />
          </div>
          <div className="field-row">
            <label>Volume</label>
            <input type="range" min={0} max={1} step={0.05} value={selectedClip.volume}
              onChange={e => updateAudio(selectedClip.id, { volume: Number(e.target.value) })} />
            <span style={{ fontSize: 11, minWidth: 30, color: 'var(--text-muted)' }}>{Math.round(selectedClip.volume * 100)}%</span>
          </div>
          <div className="field-row"><label>Fade In (ms)</label><input type="number" min={0} step={100} value={selectedClip.fadeIn} onChange={e => updateAudio(selectedClip.id, { fadeIn: Math.max(0, Number(e.target.value)) })} /></div>
          <div className="field-row"><label>Fade Out (ms)</label><input type="number" min={0} step={100} value={selectedClip.fadeOut} onChange={e => updateAudio(selectedClip.id, { fadeOut: Math.max(0, Number(e.target.value)) })} /></div>
        </div>
      )}

      <div className="field-group">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4>Audio Bin</h4>
          <button className="btn btn-sm btn-primary" onClick={importAudio}>+ Import</button>
        </div>
        <p className="hint">Import one or more files here, then drag an audio item onto a timeline track.</p>
        {assets.length === 0 ? (
          <div className="audio-empty"><p>♫ No audio files in the bin</p></div>
        ) : (
          <div className="audio-list">
            {assets.map(asset => (
              <div key={asset.id} className="audio-asset" draggable onDragStart={e => handleAssetDragStart(e, asset)} title="Drag onto the timeline">
                <span className="audio-asset-icon">♫</span>
                <span className="audio-asset-info"><strong>{asset.name}</strong><small>{asset.duration ? `${(asset.duration / 1000).toFixed(1)}s` : 'Audio'} · Drag to timeline</small></span>
                <button className="btn-icon" onClick={() => removeAudioAsset(asset.id)} title="Remove from bin">×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AudioTab;
