import React, { useState } from 'react';
import { useProjectStore } from '../../store/project';
import type { ProjectItem, TextFx, FxParams } from '../../types/project';
import { EFFECTS, FONTS, findFont } from '../../engine/fxDefs';
import type { EffectDef } from '../../engine/fxDefs';

interface TextTabProps {
  item: ProjectItem;
}

/** Collapsible category */
const Section: React.FC<{ title: string; defaultOpen?: boolean; badge?: number; children: React.ReactNode }> = ({ title, defaultOpen, badge, children }) => {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="fx-section">
      <button className="fx-section-head" onClick={() => setOpen(o => !o)}>
        <span className="fx-caret">{open ? '▾' : '▸'}</span>
        <span>{title}</span>
        {!!badge && <span className="fx-badge">{badge}</span>}
      </button>
      {open && <div className="fx-section-body">{children}</div>}
    </div>
  );
};

const Slider: React.FC<{ label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }> = ({ label, value, min, max, step, onChange }) => (
  <div className="field-row">
    <label>{label}</label>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} />
    <input type="number" className="fx-num" min={min} max={max} step={step} value={value}
      onChange={e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v); }} />
  </div>
);

const ColorField: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
  <div className="field-row">
    <label>{label}</label>
    <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={e => onChange(e.target.value)} style={{ flex: 'none', width: 36, padding: 0 }} />
    <input type="text" value={value} onChange={e => onChange(e.target.value)} />
  </div>
);

const Check: React.FC<{ label: string; value: boolean; onChange: (v: boolean) => void }> = ({ label, value, onChange }) => (
  <div className="field-row">
    <label>{label}</label>
    <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} style={{ flex: 'none', width: 'auto' }} />
  </div>
);

/** Font list where every entry is shown in its own font, Bengali fonts with a Bengali sample. */
const FontPicker: React.FC<{ value?: string; onChange: (v: string | undefined) => void }> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const current = findFont(value);
  return (
    <div className="font-picker">
      <button className="font-picker-btn" onClick={() => setOpen(o => !o)} style={{ fontFamily: value ? `"${value}"` : undefined }}>
        {value || 'Inherit (page font)'} <span style={{ float: 'right' }}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="font-picker-list">
          <div className="font-opt" onClick={() => { onChange(undefined); setOpen(false); }}>Inherit (page font)</div>
          {FONTS.map(f => (
            <div key={f.name} className={`font-opt ${current?.name === f.name ? 'sel' : ''}`}
              style={{ fontFamily: `"${f.name}"` }} onClick={() => { onChange(f.name); setOpen(false); }}>
              <span>{f.name}</span>
              <span className="font-sample">{f.bengali ? 'বাংলা Aa' : 'Aa Bb'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const TextTab: React.FC<TextTabProps> = ({ item }) => {
  const { updateItemOverride } = useProjectStore();
  const ov = item.override;
  const style = ov.style || {};
  const fx: TextFx = ov.fx || {};
  const effects = fx.effects || {};
  const grad = fx.gradient || {};
  const box = fx.box || {};
  const isContainer = item.type === 'container';

  // ── writers (every change goes straight to the store → live preview) ─────
  const updateStyle = (key: string, value: unknown) => {
    const next = { ...style };
    if (value === undefined || value === '') delete next[key];
    else next[key] = value;
    updateItemOverride(item.id, { style: next });
  };
  const updateFx = (patch: Partial<TextFx>) => updateItemOverride(item.id, { fx: { ...fx, ...patch } });
  const setEffect = (def: EffectDef, patch: FxParams) => {
    const cur: FxParams = effects[def.id] || { ...def.defaults, on: false };
    updateFx({ effects: { ...effects, [def.id]: { ...cur, ...patch } } });
  };
  const countOn = (group: EffectDef['group']) => EFFECTS.filter(d => d.group === group && effects[d.id]?.on).length;

  const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
  const underline = String(style.textDecoration || '').includes('underline');
  const strike = String(style.textDecoration || '').includes('line-through');
  const setDeco = (u: boolean, s: boolean) => updateStyle('textDecoration', [u ? 'underline' : '', s ? 'line-through' : ''].filter(Boolean).join(' ') || undefined);

  const renderEffects = (group: EffectDef['group']) => EFFECTS.filter(d => d.group === group).map(def => {
    const p: FxParams = effects[def.id] || { ...def.defaults, on: false };
    return (
      <div key={def.id} className={`fx-effect ${p.on ? 'on' : ''}`}>
        <label className="fx-effect-head">
          <input type="checkbox" checked={!!p.on} onChange={e => setEffect(def, { on: e.target.checked })} style={{ width: 'auto', flex: 'none' }} />
          <span>{def.label}</span>
        </label>
        {p.on && (
          <div className="fx-effect-body">
            {def.hint && <p className="hint" style={{ marginBottom: 6 }}>{def.hint}</p>}
            {def.fields.map(f => f.kind === 'color'
              ? <ColorField key={f.key} label={f.label} value={String(p[f.key] ?? def.defaults[f.key] ?? '#ffffff')} onChange={v => setEffect(def, { [f.key]: v })} />
              : f.kind === 'checkbox'
                ? <Check key={f.key} label={f.label} value={p[f.key] !== false} onChange={v => setEffect(def, { [f.key]: v })} />
                : <Slider key={f.key} label={f.label} value={num(p[f.key], num(def.defaults[f.key], 0))} min={f.min ?? 0} max={f.max ?? 100} step={f.step ?? 1}
                    onChange={v => setEffect(def, { [f.key]: v })} />)}
          </div>
        )}
      </div>
    );
  });

  return (
    <div className="tab-section">
      <Section title="Font & Style" defaultOpen>
        <label className="fx-label">Text</label>
        <textarea rows={3} value={ov.text ?? item.originalText ?? ''} placeholder="Enter text content..."
          onChange={e => updateItemOverride(item.id, { text: e.target.value })} style={{ resize: 'vertical', width: '100%', marginBottom: 8 }} />
        {isContainer && <p className="hint" style={{ marginBottom: 6 }}>This is a group: font family, colour, weight, spacing and alignment also apply to the text inside it.</p>}

        <div className="field-row"><label>Font</label><FontPicker value={style.fontFamily as string | undefined} onChange={v => updateStyle('fontFamily', v)} /></div>
        <Slider label="Size (px)" value={num(style.fontSize, 48)} min={8} max={400} step={1} onChange={v => updateStyle('fontSize', v)} />
        <div className="field-row">
          <label>Weight</label>
          <select value={String(style.fontWeight ?? '')} onChange={e => updateStyle('fontWeight', e.target.value || undefined)}>
            <option value="">inherit</option>
            <option value="300">Light (300)</option>
            <option value="400">Regular (400)</option>
            <option value="500">Medium (500)</option>
            <option value="600">SemiBold (600)</option>
            <option value="700">Bold (700)</option>
            <option value="800">ExtraBold (800)</option>
            <option value="900">Black (900)</option>
          </select>
        </div>
        <div className="field-row">
          <label>Style</label>
          <div className="pos-steps">
            <button className={`btn btn-sm ${style.fontStyle === 'italic' ? 'btn-primary' : ''}`} onClick={() => updateStyle('fontStyle', style.fontStyle === 'italic' ? undefined : 'italic')}><i>I</i></button>
            <button className={`btn btn-sm ${String(style.fontWeight) === '700' ? 'btn-primary' : ''}`} onClick={() => updateStyle('fontWeight', String(style.fontWeight) === '700' ? undefined : '700')}><b>B</b></button>
            <button className={`btn btn-sm ${underline ? 'btn-primary' : ''}`} onClick={() => setDeco(!underline, strike)}><u>U</u></button>
            <button className={`btn btn-sm ${strike ? 'btn-primary' : ''}`} onClick={() => setDeco(underline, !strike)}><s>S</s></button>
          </div>
        </div>
        <div className="field-row">
          <label>Alignment</label>
          <select value={(style.textAlign as string) ?? ''} onChange={e => updateStyle('textAlign', e.target.value || undefined)}>
            <option value="">inherit</option>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
        <Slider label="Line height" value={num(style.lineHeight, 1.2)} min={0.5} max={3} step={0.05} onChange={v => updateStyle('lineHeight', v)} />
        <Slider label="Letter spacing" value={num(style.letterSpacing, 0)} min={-10} max={60} step={0.5} onChange={v => updateStyle('letterSpacing', v)} />
        <Slider label="Word spacing" value={num(fx.wordSpacing, 0)} min={-10} max={80} step={1} onChange={v => updateFx({ wordSpacing: v })} />
        <button className="btn btn-sm" onClick={() => updateItemOverride(item.id, { style: {}, fx: undefined })}>Reset typography</button>
      </Section>

      <Section title="Color & Gradient" badge={grad.on ? 1 : 0}>
        <ColorField label="Text color" value={(style.color as string) || '#ffffff'} onChange={v => updateStyle('color', v)} />
        <Check label="Gradient text" value={!!grad.on} onChange={v => updateFx({ gradient: { type: 'linear', angle: 90, c1: '#ff00cc', c2: '#00e5ff', c3: '#ffd23f', ...grad, on: v } })} />
        {grad.on && (
          <>
            <div className="field-row">
              <label>Type</label>
              <select value={grad.type || 'linear'} onChange={e => updateFx({ gradient: { ...grad, type: e.target.value as 'linear' | 'radial' } })}>
                <option value="linear">Linear</option>
                <option value="radial">Radial</option>
              </select>
            </div>
            {(grad.type || 'linear') === 'linear' && <Slider label="Angle" value={num(grad.angle, 90)} min={0} max={360} step={1} onChange={v => updateFx({ gradient: { ...grad, angle: v } })} />}
            <ColorField label="Color 1" value={grad.c1 || '#ff00cc'} onChange={v => updateFx({ gradient: { ...grad, c1: v } })} />
            <ColorField label="Color 2" value={grad.c2 || '#00e5ff'} onChange={v => updateFx({ gradient: { ...grad, c2: v } })} />
            <Check label="Third color" value={!!grad.useC3} onChange={v => updateFx({ gradient: { ...grad, useC3: v } })} />
            {grad.useC3 && <ColorField label="Color 3" value={grad.c3 || '#ffd23f'} onChange={v => updateFx({ gradient: { ...grad, c3: v } })} />}
          </>
        )}
      </Section>

      <Section title="Shadow & Depth" badge={countOn('shadow')}>{renderEffects('shadow')}</Section>
      <Section title="Glow" badge={countOn('glow')}>{renderEffects('glow')}</Section>
      <Section title="Stroke & Outline" badge={countOn('stroke')}>{renderEffects('stroke')}</Section>

      <Section title="Background & Border" badge={(box.bgOn ? 1 : 0) + (box.borderOn ? 1 : 0)}>
        <Check label="Text background" value={!!box.bgOn} onChange={v => updateFx({ box: { bg: '#000000', bgOpacity: 0.6, padX: 16, padY: 8, radius: 8, ...box, bgOn: v } })} />
        {box.bgOn && (
          <>
            <ColorField label="Color" value={box.bg || '#000000'} onChange={v => updateFx({ box: { ...box, bg: v } })} />
            <Slider label="Opacity" value={num(box.bgOpacity, 0.6)} min={0} max={1} step={0.05} onChange={v => updateFx({ box: { ...box, bgOpacity: v } })} />
          </>
        )}
        <Slider label="Padding X" value={num(box.padX, 0)} min={0} max={120} step={1} onChange={v => updateFx({ box: { ...box, padX: v } })} />
        <Slider label="Padding Y" value={num(box.padY, 0)} min={0} max={80} step={1} onChange={v => updateFx({ box: { ...box, padY: v } })} />
        <Slider label="Rounded corners" value={num(box.radius, 0)} min={0} max={80} step={1} onChange={v => updateFx({ box: { ...box, radius: v } })} />
        <Check label="Text border" value={!!box.borderOn} onChange={v => updateFx({ box: { borderW: 2, borderColor: '#ffffff', borderStyle: 'solid', ...box, borderOn: v } })} />
        {box.borderOn && (
          <>
            <Slider label="Border width" value={num(box.borderW, 2)} min={1} max={20} step={1} onChange={v => updateFx({ box: { ...box, borderW: v } })} />
            <ColorField label="Border color" value={box.borderColor || '#ffffff'} onChange={v => updateFx({ box: { ...box, borderColor: v } })} />
            <div className="field-row">
              <label>Border style</label>
              <select value={box.borderStyle || 'solid'} onChange={e => updateFx({ box: { ...box, borderStyle: e.target.value } })}>
                <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option><option value="double">Double</option>
              </select>
            </div>
          </>
        )}
      </Section>

      <Section title="Transform">
        <Slider label="Opacity" value={num(style.opacity, 1)} min={0} max={1} step={0.05} onChange={v => updateStyle('opacity', v)} />
        <Slider label="Rotation (°)" value={num(ov.rotate, 0)} min={-180} max={180} step={1} onChange={v => updateItemOverride(item.id, { rotate: v })} />
        <Slider label="Scale (%)" value={Math.round(num(ov.scale, 1) * 100)} min={10} max={300} step={1} onChange={v => updateItemOverride(item.id, { scale: v / 100 })} />
        <p className="hint">Position is in the Position tab; start time and duration are in the Timing tab.</p>
      </Section>
    </div>
  );
};

export default TextTab;
