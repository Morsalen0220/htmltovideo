import React from 'react';
import { useProjectStore } from '../../store/project';
import type { ProjectScene, TransitionType } from '../../types/project';

interface SceneTabProps {
  scene: ProjectScene;
}

const SceneTab: React.FC<SceneTabProps> = ({ scene }) => {
  const { updateScene } = useProjectStore();

  const update = (key: keyof ProjectScene, value: unknown) => {
    updateScene(scene.id, { [key]: value } as Partial<ProjectScene>);
  };

  const duration = (scene.end - scene.start) / 1000;
  const startSec = scene.start / 1000;

  return (
    <div className="tab-section">
      <div className="field-group">
        <h4>Scene Timing</h4>
        
        <div className="field-row">
          <label>Start (s)</label>
          <input
            type="number"
            value={startSec.toFixed(2)}
            min={0}
            step={0.1}
            onChange={e => {
              const newStart = parseFloat(e.target.value) * 1000;
              update('start', newStart);
            }}
          />
        </div>
        
        <div className="field-row">
          <label>Duration (s)</label>
          <input
            type="number"
            value={duration.toFixed(2)}
            min={0.5}
            step={0.1}
            onChange={e => {
              const newEnd = scene.start + parseFloat(e.target.value) * 1000;
              update('end', newEnd);
            }}
          />
        </div>

        <div className="field-row">
          <label>End (s)</label>
          <input
            type="number"
            value={(scene.end / 1000).toFixed(2)}
            min={scene.start / 1000 + 0.5}
            step={0.1}
            onChange={e => update('end', parseFloat(e.target.value) * 1000)}
          />
        </div>

        <div className="scene-orig-info">
          <span>Original: {(scene.orig.start / 1000).toFixed(1)}s – {(scene.orig.end / 1000).toFixed(1)}s</span>
          <button
            className="btn btn-sm"
            onClick={() => {
              update('start', scene.orig.start);
              update('end', scene.orig.end);
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="field-group">
        <h4>Transition (to next scene)</h4>
        
        <div className="field-row">
          <label>Type</label>
          <select
            value={scene.transition.type}
            onChange={e => update('transition', { ...scene.transition, type: e.target.value as TransitionType })}
          >
            <option value="none">None</option>
            <option value="fade">Fade</option>
            <option value="slide">Slide</option>
            <option value="wipe">Wipe</option>
          </select>
        </div>
        
        <div className="field-row">
          <label>Duration (ms)</label>
          <input
            type="number"
            value={scene.transition.ms}
            min={100}
            max={3000}
            step={100}
            onChange={e => update('transition', { ...scene.transition, ms: parseInt(e.target.value) })}
          />
        </div>
      </div>

      <div className="field-group">
        <h4>Background</h4>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="color"
            value={scene.background || '#000000'}
            onChange={e => update('background', e.target.value)}
          />
          <input
            type="text"
            value={scene.background || ''}
            placeholder="none (use HTML)"
            onChange={e => update('background', e.target.value || undefined)}
          />
        </div>
      </div>
    </div>
  );
};

export default SceneTab;
