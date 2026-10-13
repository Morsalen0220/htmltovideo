import React, { useState } from 'react';
import { useProjectStore } from '../../store/project';
import TimingTab from './TimingTab';
import TextTab from './TextTab';
import PositionTab from './PositionTab';
import SceneTab from './SceneTab';
import AudioTab from './AudioTab';
import './Properties.css';

type TabType = 'timing' | 'position' | 'text' | 'scene' | 'audio';

/**
 * Properties panel (right sidebar).
 * Shows tabs depending on what's selected:
 * - Scene selected: Scene tab + Timing tab
 * - Item selected: Timing + Text tabs
 * - Nothing: Audio tab only
 */
const Properties: React.FC = () => {
  const { project, selection, selectAudio } = useProjectStore();
  const [activeTab, setActiveTab] = useState<TabType>('timing');

  const selectedScene = project.scenes.find(s => s.id === selection.selectedSceneId);
  const selectedItem = project.items.find(i => i.id === selection.selectedItemIds[0]);
  const selectedAudio = project.audio.find(a => a.id === selection.selectedAudioId);

  // Determine available tabs
  const tabs: { id: TabType; label: string }[] = [];
  if (selectedAudio) {
    tabs.push({ id: 'audio', label: 'Audio' });
  } else if (selectedScene && !selectedItem) {
    tabs.push({ id: 'scene', label: 'Scene' });
    tabs.push({ id: 'timing', label: 'Timing' });
  } else if (selectedItem) {
    tabs.push({ id: 'timing', label: 'Timing' });
    tabs.push({ id: 'position', label: 'Position' });
    if (selectedItem.type === 'text' || selectedItem.type === 'heading' || selectedItem.type === 'container') {
      tabs.push({ id: 'text', label: 'Text' });
    }
  }
  if (!selectedAudio) tabs.push({ id: 'audio', label: 'Audio' });

  // Ensure active tab is valid
  const validTab = tabs.find(t => t.id === activeTab) ? activeTab : tabs[0]?.id;

  React.useEffect(() => {
    if (selectedAudio) setActiveTab('audio');
  }, [selectedAudio?.id]);

  return (
    <div className="properties">
      <div className="panel-header">
        <span>Properties</span>
        {selectedItem && <span className="badge">{selectedItem.type}</span>}
        {selectedScene && !selectedItem && <span className="badge">scene</span>}
        {selectedAudio && <span className="badge">audio</span>}
      </div>

      {/* Context info */}
      {selectedItem && (
        <div className="properties-context">
          <span className="context-icon">📌</span>
          <span className="context-name">{selectedItem.name}</span>
        </div>
      )}
      {selectedScene && !selectedItem && (
        <div className="properties-context">
          <span className="context-icon">🎬</span>
          <span className="context-name">{selectedScene.name}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="properties-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`tab-btn ${validTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="properties-content">
        {validTab === 'timing' && selectedItem && <TimingTab item={selectedItem} />}
        {validTab === 'position' && selectedItem && <PositionTab item={selectedItem} />}
        {validTab === 'text' && selectedItem && <TextTab item={selectedItem} />}
        {validTab === 'scene' && selectedScene && <SceneTab scene={selectedScene} />}
        {validTab === 'audio' && <AudioTab selectedClip={selectedAudio} onSelectClip={selectAudio} />}
        
        {tabs.length === 1 && validTab === 'audio' && !selectedItem && !selectedScene && !selectedAudio && (
          <div className="properties-empty">
            <p>👬 Select a scene or item</p>
            <p className="hint">Click an item in the layer tree or timeline to edit its properties.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Properties;
