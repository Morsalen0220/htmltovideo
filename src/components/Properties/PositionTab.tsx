import React, { useState } from 'react';
import { useProjectStore } from '../../store/project';
import type { ProjectItem, ItemOverride } from '../../types/project';

const STEPS = [1, 5, 10, 50];

/**
 * Position tab: move an element left / right / up / down (and scale / rotate it).
 * Values are in pixels of the original stage (e.g. 1280x720) and are applied on top of the page's own animation.
 */
const PositionTab: React.FC<{ item: ProjectItem }> = ({ item }) => {
  const { updateItemOverride } = useProjectStore();
  const [step, setStep] = useState(10);
  const ov = item.override;
  const x = ov.posX ?? 0;
  const y = ov.posY ?? 0;
  const scale = ov.scale ?? 1;
  const rotate = ov.rotate ?? 0;

  const set = (patch: Partial<ItemOverride>) => updateItemOverride(item.id, patch);
  const num = (v: string, fallback = 0) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };

  return (
    <div className="tab-section">
      <div className="field-group">
        <h4>Move</h4>

        <div className="field-row">
          <label>Step (px)</label>
          <div className="pos-steps">
            {STEPS.map(s => (
              <button key={s} className={`btn btn-sm ${step === s ? 'btn-primary' : ''}`} onClick={() => setStep(s)}>{s}</button>
            ))}
          </div>
        </div>

        <div className="pos-pad">
          <span />
          <button className="btn" title="Move up" onClick={() => set({ posY: y - step })}>↑ Up</button>
          <span />
          <button className="btn" title="Move left" onClick={() => set({ posX: x - step })}>← Left</button>
          <button className="btn" title="Back to original position" onClick={() => set({ posX: 0, posY: 0 })}>⌖</button>
          <button className="btn" title="Move right" onClick={() => set({ posX: x + step })}>Right →</button>
          <span />
          <button className="btn" title="Move down" onClick={() => set({ posY: y + step })}>↓ Down</button>
          <span />
        </div>

        <div className="field-row">
          <label>Left (−) / Right (+)</label>
          <input type="number" value={x} step={step} onChange={e => set({ posX: num(e.target.value) })} />
        </div>
        <div className="field-row">
          <label>Up (−) / Down (+)</label>
          <input type="number" value={y} step={step} onChange={e => set({ posY: num(e.target.value) })} />
        </div>
      </div>

      <div className="field-group">
        <h4>Size &amp; Rotation</h4>
        <div className="field-row">
          <label>Scale (%)</label>
          <input
            type="number" value={Math.round(scale * 100)} min={1} step={5}
            onChange={e => set({ scale: Math.max(0.01, num(e.target.value, 100) / 100) })}
          />
        </div>
        <div className="field-row">
          <label>Rotate (°)</label>
          <input type="number" value={rotate} step={1} onChange={e => set({ rotate: num(e.target.value) })} />
        </div>
      </div>

      <button className="btn btn-sm" onClick={() => set({ posX: 0, posY: 0, scale: 1, rotate: 0 })}>Reset position, size &amp; rotation</button>
      <p className="hint" style={{ marginTop: 10 }}>
        Moves are in pixels of the original stage and work on top of the element's own animation.
        They apply to both the preview and the exported video.
      </p>
    </div>
  );
};

export default PositionTab;
