import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useProjectStore } from '../../store/project';
import './Timeline.css';

// Colors for scene blocks
const SCENE_COLORS = [
  '#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626',
  '#0891b2', '#65a30d', '#9333ea', '#c2410c', '#be185d'
];

const RULER_HEIGHT = 24;
const TRACK_HEIGHT = 36;
const AUDIO_TRACK_HEIGHT = 54;

interface AudioMeta { duration: number; peaks: number[] }

interface DragState {
  type: 'scene-move' | 'scene-resize-left' | 'scene-resize-right' | 'audio-move' | 'audio-trim-left' | 'audio-trim-right' | 'playhead';
  sceneId?: string;
  audioId?: string;
  audioIndex?: number;
  startX: number;
  startMs: number;
  startEnd?: number;
  audioStart?: number;
  trimIn?: number;
  trimOut?: number;
  sourceDuration?: number;
}

const Timeline: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wheelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const {
    project,
    selection,
    currentTimeMs,
    isPlaying,
    setCurrentTime,
    setPlaying,
    selectScene,
    selectAudio,
    addAudio,
    updateScene,
    updateAudio
  } = useProjectStore();

  const [zoom, setZoom] = useState(1);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [canvasWidth, setCanvasWidth] = useState(800);
  const [audioMeta, setAudioMeta] = useState<Record<string, AudioMeta>>({});
  const [timelineCursor, setTimelineCursor] = useState('default');

  // Decode each imported file once so the timeline shows its true duration and waveform.
  const audioFilesKey = project.audio.map(clip => `${clip.id}:${clip.file}`).join('|');
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const context = new AudioContext();
      try {
        for (const clip of project.audio) {
          if (cancelled) return;
          try {
            const result = await window.electronAPI?.readFileBinary(clip.file);
            if (!result?.success || !result.data) continue;
            const bytes = Uint8Array.from(atob(result.data), char => char.charCodeAt(0));
            const decoded = await context.decodeAudioData(bytes.buffer);
            const channel = decoded.getChannelData(0);
            const count = Math.min(2400, Math.max(240, Math.ceil(decoded.duration * 12)));
            const stride = Math.max(1, Math.floor(channel.length / count));
            const peaks = new Array(count);
            for (let i = 0; i < count; i++) {
              let peak = 0;
              for (let j = i * stride; j < Math.min(channel.length, (i + 1) * stride); j++) peak = Math.max(peak, Math.abs(channel[j]));
              peaks[i] = peak;
            }
            if (!cancelled) {
              const duration = decoded.duration * 1000;
              setAudioMeta(previous => ({ ...previous, [clip.id]: { duration, peaks } }));
              if (Math.abs((clip.duration ?? 0) - duration) > 50) updateAudio(clip.id, { duration });
            }
          } catch (error) { console.warn(`[Timeline] Could not read audio waveform for ${clip.name}`, error); }
        }
      } finally { await context.close(); }
    };
    if (project.audio.length) void load();
    return () => { cancelled = true; };
  }, [audioFilesKey, updateAudio]);

  const totalDuration = project.source.duration || 30000;
  const pxPerMs = zoom * 0.1;

  const msToX = useCallback((ms: number) => ms * pxPerMs - scrollLeft, [pxPerMs, scrollLeft]);
  const xToMs = useCallback((x: number) => (x + scrollLeft) / pxPerMs, [pxPerMs, scrollLeft]);

  // ─── Draw ────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Background
    ctx.fillStyle = '#111122';
    ctx.fillRect(0, 0, w, h);

    // ── Ruler ──────────────────────────────────────────────────────────────
    ctx.fillStyle = '#1a1a30';
    ctx.fillRect(0, 0, w, RULER_HEIGHT);

    const secInterval = zoom < 0.5 ? 5 : zoom < 1 ? 2 : 1;
    const msInterval = secInterval * 1000;
    const startMark = Math.floor(xToMs(0) / msInterval) * msInterval;
    const endMark = xToMs(w) + msInterval;

    ctx.font = '9px monospace';
    ctx.textBaseline = 'top';

    for (let ms = startMark; ms <= endMark; ms += msInterval) {
      const x = Math.round(msToX(ms)) + 0.5;
      if (x < 0 || x > w) continue;

      // Vertical grid line
      ctx.strokeStyle = '#2d2d4e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, RULER_HEIGHT);
      ctx.lineTo(x, h);
      ctx.stroke();

      // Ruler tick
      ctx.strokeStyle = '#3d3d5e';
      ctx.beginPath();
      ctx.moveTo(x, RULER_HEIGHT - 8);
      ctx.lineTo(x, RULER_HEIGHT);
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.fillText(`${(ms / 1000).toFixed(0)}s`, x + 2, 4);
    }

    // Half-second ticks
    for (let ms = startMark; ms <= endMark; ms += msInterval / 2) {
      if (ms % msInterval === 0) continue;
      const x = Math.round(msToX(ms)) + 0.5;
      if (x < 0 || x > w) continue;
      ctx.strokeStyle = '#222238';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, RULER_HEIGHT - 4);
      ctx.lineTo(x, RULER_HEIGHT);
      ctx.stroke();
    }

    // ── Scene track ────────────────────────────────────────────────────────
    const sceneY = RULER_HEIGHT;
    ctx.fillStyle = '#161628';
    ctx.fillRect(0, sceneY, w, TRACK_HEIGHT);

    // Label area
    ctx.fillStyle = '#0f0f20';
    ctx.fillRect(0, sceneY, 80, TRACK_HEIGHT);
    ctx.fillStyle = '#64748b';
    ctx.font = '10px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('SCENES', 8, sceneY + TRACK_HEIGHT / 2);

    // Scene blocks
    project.scenes.forEach((scene, i) => {
      const x = msToX(scene.start);
      const bw = msToX(scene.end) - x;
      if (bw < 1) return;

      const isSelected = selection.selectedSceneId === scene.id;
      const color = SCENE_COLORS[i % SCENE_COLORS.length];
      const blockY = sceneY + 3;
      const blockH = TRACK_HEIGHT - 6;

      // Fill
      ctx.fillStyle = isSelected ? color : color + '88';
      ctx.beginPath();
      ctx.roundRect(x, blockY, Math.max(bw, 20), blockH, 3);
      ctx.fill();

      // Border
      ctx.strokeStyle = isSelected ? '#ffffff88' : color;
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();

      // Label
      if (bw > 30) {
        ctx.fillStyle = '#ffffffcc';
        ctx.font = '10px sans-serif';
        ctx.textBaseline = 'middle';
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 2, blockY, bw - 4, blockH);
        ctx.clip();
        ctx.fillText(scene.name, x + 5, blockY + blockH / 2);
        ctx.restore();
      }

      // Resize handles (selected only)
      if (isSelected && bw > 20) {
        ctx.fillStyle = '#ffffff55';
        ctx.fillRect(x, blockY, 4, blockH);
        ctx.fillRect(x + bw - 4, blockY, 4, blockH);
      }
    });

    // ── Audio tracks ───────────────────────────────────────────────────────
    const audioY = sceneY + TRACK_HEIGHT;
    const audioTrackCount = project.audio.length ? Math.max(...project.audio.map(clip => (clip.trackIndex ?? 0) + 1)) : 0;
    const visibleAudioRows = Math.max(1, audioTrackCount + 1);
    for (let i = 0; i < visibleAudioRows; i++) {
      const y = audioY + i * AUDIO_TRACK_HEIGHT;
      ctx.fillStyle = '#151d27';
      ctx.fillRect(0, y, w, AUDIO_TRACK_HEIGHT);
      ctx.fillStyle = '#101720';
      ctx.fillRect(0, y, 80, AUDIO_TRACK_HEIGHT);
      ctx.fillStyle = '#a3b4c7';
      ctx.font = 'bold 9px sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(i < audioTrackCount ? `A${i + 1}` : '+', 8, y + 8);
      ctx.fillStyle = '#64748b'; ctx.font = '8px sans-serif'; ctx.fillText(i < audioTrackCount ? 'AUDIO' : 'TRACK', 8, y + 23);
      if (i >= audioTrackCount) {
        ctx.setLineDash([4, 4]); ctx.strokeStyle = '#3d4657'; ctx.strokeRect(82, y + 3, w - 84, AUDIO_TRACK_HEIGHT - 6); ctx.setLineDash([]);
      }

      project.audio.forEach(clip => {
        if ((clip.trackIndex ?? 0) !== i) return;
        const meta = audioMeta[clip.id];
        const sourceDuration = meta?.duration ?? clip.duration ?? Math.max(0, totalDuration - clip.start + clip.trimIn + clip.trimOut);
        const clipDuration = Math.max(0, sourceDuration - clip.trimIn - clip.trimOut);
        const clipX = msToX(clip.start);
        const clipW = msToX(clip.start + clipDuration) - clipX;
        if (clipW <= 0) return;
        const top = y + 3, clipH = AUDIO_TRACK_HEIGHT - 6;
        const selected = selection.selectedAudioId === clip.id;
        ctx.save(); ctx.beginPath(); ctx.roundRect(clipX, top, Math.max(clipW, 1), clipH, 4); ctx.clip();
        ctx.fillStyle = selected ? '#12584f' : '#103d3a'; ctx.fillRect(clipX, top, clipW, clipH);
        const peaks = meta?.peaks;
        if (peaks?.length && clipW > 2) {
          const mid = top + clipH / 2;
          const sourceStart = Math.floor((clip.trimIn / sourceDuration) * peaks.length);
          const sourceEnd = Math.ceil(((sourceDuration - clip.trimOut) / sourceDuration) * peaks.length);
          const visiblePeaks = Math.max(1, sourceEnd - sourceStart);
          ctx.fillStyle = '#56d6b4';
          for (let x = 1; x < clipW; x += 2) {
            const p = peaks[Math.min(sourceEnd - 1, sourceStart + Math.floor((x / clipW) * visiblePeaks))] || 0;
            const bar = Math.max(1, p * (clipH * 0.72));
            ctx.fillRect(clipX + x, mid - bar / 2, 1, bar);
          }
        } else {
          ctx.fillStyle = '#3b8f7d'; ctx.fillRect(clipX + 3, top + clipH / 2, Math.max(0, clipW - 6), 1);
        }
        const title = `${clip.name}  •  ${clipDuration > 0 ? (clipDuration / 1000).toFixed(1) + 's' : 'Loading waveform…'}`;
        ctx.font = '9px sans-serif'; ctx.textBaseline = 'top';
        const labelW = ctx.measureText(title).width + 10;
        ctx.fillStyle = '#102b2a'; ctx.fillRect(clipX, top, Math.min(labelW, clipW), 13);
        ctx.fillStyle = '#d8fff5'; ctx.fillText(title, clipX + 5, top + 2, Math.max(0, clipW - 10));
        // Volume line and fade ramps, similar to a lightweight audio automation overlay.
        ctx.strokeStyle = '#d5fff0aa'; ctx.lineWidth = 1;
        const center = top + clipH / 2;
        ctx.beginPath(); ctx.moveTo(clipX, center); ctx.lineTo(clipX + clipW, center); ctx.stroke();
        if (clip.fadeIn > 0) { ctx.beginPath(); ctx.moveTo(clipX, top + clipH - 3); ctx.lineTo(Math.min(clipX + clipW, msToX(clip.start + clip.fadeIn)), center); ctx.stroke(); }
        if (clip.fadeOut > 0) { ctx.beginPath(); ctx.moveTo(Math.max(clipX, msToX(clip.start + clipDuration - clip.fadeOut)), center); ctx.lineTo(clipX + clipW, top + clipH - 3); ctx.stroke(); }
        ctx.restore();
        ctx.strokeStyle = selected ? '#b5fff0' : '#37b69d'; ctx.lineWidth = selected ? 2 : 1;
        ctx.beginPath(); ctx.roundRect(clipX, top, Math.max(clipW, 1), clipH, 4); ctx.stroke();
        if (selected && clipW > 16) { ctx.fillStyle = '#c8fff5'; ctx.fillRect(clipX, top, 3, clipH); ctx.fillRect(clipX + clipW - 3, top, 3, clipH); }
      });
    }

    // ── Playhead ───────────────────────────────────────────────────────────
    const playX = msToX(currentTimeMs);
    if (playX >= 0 && playX <= w) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX, h);
      ctx.stroke();

      // Arrow head
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(playX - 6, 0);
      ctx.lineTo(playX + 6, 0);
      ctx.lineTo(playX + 6, RULER_HEIGHT - 4);
      ctx.lineTo(playX, RULER_HEIGHT);
      ctx.lineTo(playX - 6, RULER_HEIGHT - 4);
      ctx.closePath();
      ctx.fill();
    }
  }, [project, selection, currentTimeMs, msToX, xToMs, totalDuration, zoom, audioMeta]);

  useEffect(() => { draw(); }, [draw]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      setCanvasWidth(container.clientWidth);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ─── Hit testing ──────────────────────────────────────────────────────────
  const getHitTarget = useCallback((x: number, y: number): DragState | null => {
    // Playhead handle
    const playX = msToX(currentTimeMs);
    if (Math.abs(x - playX) < 8 && y < RULER_HEIGHT) {
      return { type: 'playhead', startX: x, startMs: currentTimeMs };
    }
    // Ruler click → move playhead
    if (y < RULER_HEIGHT) {
      return { type: 'playhead', startX: x, startMs: xToMs(x) };
    }
    // Scene blocks
    const sceneY = RULER_HEIGHT;
    if (y >= sceneY && y < sceneY + TRACK_HEIGHT) {
      for (const scene of [...project.scenes].reverse()) {
        const bx = msToX(scene.start);
        const bw = msToX(scene.end) - bx;
        if (x < bx || x > bx + bw) continue;
        if (x - bx < 8) return { type: 'scene-resize-left', sceneId: scene.id, startX: x, startMs: scene.start, startEnd: scene.end };
        if (bx + bw - x < 8) return { type: 'scene-resize-right', sceneId: scene.id, startX: x, startMs: scene.start, startEnd: scene.end };
        return { type: 'scene-move', sceneId: scene.id, startX: x, startMs: scene.start, startEnd: scene.end };
      }
    }
    const audioY = sceneY + TRACK_HEIGHT;
    for (const clip of [...project.audio].reverse()) {
      const rowY = audioY + (clip.trackIndex ?? 0) * AUDIO_TRACK_HEIGHT;
      if (y < rowY || y >= rowY + AUDIO_TRACK_HEIGHT) continue;
      const meta = audioMeta[clip.id];
      const sourceDuration = meta?.duration ?? clip.duration ?? Math.max(0, totalDuration - clip.start + clip.trimIn + clip.trimOut);
      const duration = Math.max(0, sourceDuration - clip.trimIn - clip.trimOut);
      const bx = msToX(clip.start), bw = msToX(clip.start + duration) - bx;
      if (x < bx || x > bx + bw) return null;
      if (x - bx < 7) return { type: 'audio-trim-left', audioId: clip.id, startX: x, startMs: clip.start, audioStart: clip.start, trimIn: clip.trimIn, trimOut: clip.trimOut, sourceDuration };
      if (bx + bw - x < 7) return { type: 'audio-trim-right', audioId: clip.id, startX: x, startMs: clip.start, audioStart: clip.start, trimIn: clip.trimIn, trimOut: clip.trimOut, sourceDuration };
      return { type: 'audio-move', audioId: clip.id, startX: x, startMs: clip.start, audioStart: clip.start, trimIn: clip.trimIn, trimOut: clip.trimOut, sourceDuration };
    }
    return null;
  }, [msToX, xToMs, currentTimeMs, project.scenes, project.audio, audioMeta, totalDuration]);

  // ─── Mouse handlers ───────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = getHitTarget(x, y);

    if (!hit) {
      // Click on empty area → move playhead
      const ms = Math.max(0, Math.min(totalDuration, xToMs(x)));
      setCurrentTime(Math.round(ms));
      if (isPlaying) setPlaying(false);
      return;
    }

    dragRef.current = hit;

    if (hit.type === 'playhead') {
      const ms = Math.max(0, Math.min(totalDuration, xToMs(x)));
      setCurrentTime(Math.round(ms));
      if (isPlaying) setPlaying(false);
    } else if (hit.sceneId) {
      selectScene(hit.sceneId);
    } else if (hit.audioId) {
      selectAudio(hit.audioId);
    }
    e.preventDefault();
  }, [getHitTarget, xToMs, setCurrentTime, setPlaying, isPlaying, totalDuration, selectScene, selectAudio]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dms = (x - drag.startX) / pxPerMs;

    if (drag.type === 'playhead') {
      setCurrentTime(Math.round(Math.max(0, Math.min(totalDuration, xToMs(x)))));
    } else if (drag.type === 'scene-move' && drag.sceneId) {
      const dur = (drag.startEnd || 0) - drag.startMs;
      const newStart = Math.max(0, drag.startMs + dms);
      updateScene(drag.sceneId, { start: Math.round(newStart), end: Math.round(newStart + dur) });
    } else if (drag.type === 'scene-resize-left' && drag.sceneId) {
      const newStart = Math.max(0, drag.startMs + dms);
      if (newStart < (drag.startEnd || 0) - 500) {
        updateScene(drag.sceneId, { start: Math.round(newStart) });
      }
    } else if (drag.type === 'scene-resize-right' && drag.sceneId) {
      const newEnd = Math.max(drag.startMs + 500, (drag.startEnd || 0) + dms);
      updateScene(drag.sceneId, { end: Math.round(newEnd) });
    } else if (drag.audioId) {
      const delta = Math.round(dms);
      if (drag.type === 'audio-move') {
        updateAudio(drag.audioId, { start: Math.max(0, (drag.audioStart || 0) + delta) });
        const audioTop = RULER_HEIGHT + TRACK_HEIGHT;
        const targetIndex = Math.max(0, Math.floor((y - audioTop) / AUDIO_TRACK_HEIGHT));
        updateAudio(drag.audioId, { trackIndex: targetIndex });
      }
      if (drag.type === 'audio-trim-left') {
        const trimDelta = Math.min((drag.sourceDuration || 0) - (drag.trimIn || 0) - (drag.trimOut || 0) - 100, delta);
        const newStart = Math.max(0, (drag.audioStart || 0) + trimDelta);
        const actualDelta = newStart - (drag.audioStart || 0);
        updateAudio(drag.audioId, { start: newStart, trimIn: Math.max(0, (drag.trimIn || 0) + actualDelta) });
      }
      if (drag.type === 'audio-trim-right') {
        const maxTrim = (drag.sourceDuration || 0) - (drag.trimIn || 0) - 100;
        updateAudio(drag.audioId, { trimOut: Math.max(0, Math.min(maxTrim, (drag.trimOut || 0) - delta)) });
      }
    }
  }, [pxPerMs, xToMs, setCurrentTime, updateScene, updateAudio, totalDuration]);

  const handleMouseUp = useCallback(() => { dragRef.current = null; }, []);

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') { e.preventDefault(); setPlaying(!isPlaying); }
      else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        setCurrentTime(Math.max(0, currentTimeMs - (e.shiftKey ? 1000 : Math.round(1000 / 30))));
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        setCurrentTime(Math.min(totalDuration, currentTimeMs + (e.shiftKey ? 1000 : Math.round(1000 / 30))));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isPlaying, currentTimeMs, totalDuration, setPlaying, setCurrentTime]);

  // ─── Wheel (zoom / scroll) ────────────────────────────────────────────────
  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(z => Math.max(0.1, Math.min(10, z * (e.deltaY > 0 ? 0.8 : 1.25))));
    } else if (e.shiftKey) {
      e.preventDefault();
      setScrollLeft(s => Math.max(0, s + e.deltaY * 2));
    } else {
      const target = wheelRef.current;
      if (!target || target.scrollHeight <= target.clientHeight) {
        e.preventDefault();
        setScrollLeft(s => Math.max(0, s + e.deltaY * 2));
      }
    }
  }, []);

  useEffect(() => {
    const target = wheelRef.current;
    if (!target) return;
    target.addEventListener('wheel', handleWheel, { passive: false });
    return () => target.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handleAudioDrop = useCallback((e: React.DragEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const assetId = e.dataTransfer.getData('application/x-h2v-audio-asset');
    const asset = project.audioAssets?.find(item => item.id === assetId);
    if (!asset) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const audioTop = RULER_HEIGHT + TRACK_HEIGHT;
    if (y < audioTop) return;
    const trackIndex = Math.floor((y - audioTop) / AUDIO_TRACK_HEIGHT);
    const clipId = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    addAudio({
      id: clipId,
      file: asset.file,
      name: asset.name,
      start: Math.max(0, Math.round(xToMs(x))),
      duration: asset.duration,
      trackIndex,
      trimIn: 0,
      trimOut: 0,
      volume: 0.8,
      fadeIn: 0,
      fadeOut: 0
    });
    selectAudio(clipId);
  }, [project.audioAssets, addAudio, selectAudio, xToMs]);

  const audioTrackCount = project.audio.length ? Math.max(...project.audio.map(clip => (clip.trackIndex ?? 0) + 1)) : 0;
  const totalH = RULER_HEIGHT + TRACK_HEIGHT + Math.max(1, audioTrackCount + 1) * AUDIO_TRACK_HEIGHT;
  const maxScroll = Math.max(0, totalDuration * pxPerMs - canvasWidth + 100);

  return (
    <div className="timeline" ref={containerRef}>
      {/* Controls bar */}
      <div className="timeline-controls">
        <button
          className={`btn btn-sm ${isPlaying ? 'btn-primary' : ''}`}
          onClick={() => setPlaying(!isPlaying)}
          title="Play/Pause (Space)"
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        <span className="time-display">
          {(currentTimeMs / 1000).toFixed(2)}s
        </span>

        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>Zoom:</span>
        <input
          type="range" min={0.2} max={8} step={0.1} value={zoom}
          onChange={e => setZoom(parseFloat(e.target.value))}
          style={{ width: 80 }}
          title="Zoom (Ctrl+Scroll)"
        />
        <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', minWidth: 32 }}>
          {zoom.toFixed(1)}x
        </span>

        <span style={{ flex: 1 }} />

        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {project.scenes.length} scenes • {(totalDuration / 1000).toFixed(1)}s total
        </span>
      </div>

      {/* Canvas */}
      <div className="canvas-scroll-container" ref={wheelRef}>
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={Math.max(totalH, 80)}
          className="timeline-canvas"
          style={{ cursor: timelineCursor }}
          onMouseDown={handleMouseDown}
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
          onDrop={handleAudioDrop}
          onMouseMove={e => {
            if (dragRef.current) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const hit = getHitTarget(e.clientX - rect.left, e.clientY - rect.top);
            setTimelineCursor(hit?.type === 'audio-trim-left' || hit?.type === 'audio-trim-right' || hit?.type === 'scene-resize-left' || hit?.type === 'scene-resize-right'
              ? 'ew-resize'
              : hit?.type === 'audio-move' || hit?.type === 'scene-move' ? 'grab' : 'default');
          }}
          onMouseLeave={() => { if (!dragRef.current) setTimelineCursor('default'); }}
        />
        {/* Horizontal scrollbar */}
        <div className="timeline-scrollbar">
          <input
            type="range"
            min={0}
            max={maxScroll}
            step={1}
            value={Math.min(scrollLeft, maxScroll)}
            onChange={e => setScrollLeft(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
      </div>
    </div>
  );
};

export default Timeline;
