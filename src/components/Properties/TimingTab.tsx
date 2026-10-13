import React from 'react';
import { useProjectStore } from '../../store/project';
import type { ProjectItem } from '../../types/project';

interface TimingTabProps {
  item: ProjectItem;
}

const TimingTab: React.FC<TimingTabProps> = ({ item }) => {
  const { updateItemOverride } = useProjectStore();
  const ov = item.override;

  const update = (key: string, value: number) => {
    updateItemOverride(item.id, { [key]: value });
  };

  return (
    <div className="tab-section">
      <div className="field-group">
        <h4>Timing</h4>
        
        <div className="field-row">
          <label>Start (s)</label>
          <input
            type="number"
            value={ov.s ?? 0}
            min={0}
            step={0.1}
            onChange={e => update('s', parseFloat(e.target.value))}
          />
        </div>
        
        <div className="field-row">
          <label>Duration (s)</label>
          <input
            type="number"
            value={ov.d ?? 0.8}
            min={0.1}
            step={0.1}
            onChange={e => update('d', parseFloat(e.target.value))}
          />
        </div>
        
        <div className="field-row">
          <label>Slide Y (px)</label>
          <input
            type="number"
            value={ov.y ?? 40}
            step={5}
            onChange={e => update('y', parseFloat(e.target.value))}
          />
        </div>

        <div className="field-row">
          <label>Fade In (ms)</label>
          <input
            type="number"
            value={ov.fadeIn ?? 0}
            min={0}
            step={100}
            onChange={e => update('fadeIn', parseFloat(e.target.value))}
          />
        </div>
        
        <div className="field-row">
          <label>Fade Out (ms)</label>
          <input
            type="number"
            value={ov.fadeOut ?? 0}
            min={0}
            step={100}
            onChange={e => update('fadeOut', parseFloat(e.target.value))}
          />
        </div>
      </div>

      <div className="field-group">
        <h4>Easing</h4>
        <select
          value={ov.easing ?? 'ease-out'}
          onChange={e => updateItemOverride(item.id, { easing: e.target.value as never })}
        >
          <option value="linear">Linear</option>
          <option value="ease-in">Ease In</option>
          <option value="ease-out">Ease Out (default)</option>
          <option value="ease-in-out">Ease In-Out</option>
          <option value="bounce">Bounce</option>
        </select>
      </div>

      <div className="field-group">
        <h4>Motion Preset</h4>
        <select
          value={ov.motionPreset ?? 'none'}
          onChange={e => updateItemOverride(item.id, { motionPreset: e.target.value as never })}
        >
          <option value="none">None</option>
          <option value="fade-up">Fade Up</option>
          <option value="zoom-in">Zoom In</option>
          <option value="slide-in">Slide In</option>
          <option value="bounce-in">Bounce In</option>
        </select>

        <div className="field-row" style={{ marginTop: 8 }}>
          <label>Entrance</label>
          <select
            value={ov.entrance ?? 'up'}
            onChange={e => updateItemOverride(item.id, { entrance: e.target.value as never })}
          >
            <option value="none">None</option>
            <option value="up">From Bottom</option>
            <option value="down">From Top</option>
            <option value="left">From Left</option>
            <option value="right">From Right</option>
          </select>
        </div>

        <div className="field-row">
          <label>Loop Effect</label>
          <select
            value={ov.loopEffect ?? 'none'}
            onChange={e => updateItemOverride(item.id, { loopEffect: e.target.value as never })}
          >
            <option value="none">None</option>
            <option value="float">Float</option>
            <option value="sway">Sway</option>
            <option value="spin">Spin</option>
          </select>
        </div>
      </div>
    </div>
  );
};

export default TimingTab;
