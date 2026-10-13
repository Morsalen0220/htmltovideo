import React, { useState } from 'react';
import { useProjectStore } from '../../store/project';
import type { ProjectScene, ProjectItem } from '../../types/project';
import './LayerTree.css';

/**
 * Layer tree panel (left sidebar).
 * Shows scenes as top-level nodes and items as children.
 * Click to select; double-click to rename.
 */
const LayerTree: React.FC = () => {
  const {
    project,
    selection,
    currentTimeMs,
    selectScene,
    selectItem,
    clearSelection,
    updateScene,
    updateItem,
    clipboard,
    copySelection,
    cutSelection,
    pasteClipboard,
    duplicateSelection,
    deleteSelection
  } = useProjectStore();
  const hasObjectSelection = selection.selectedItemIds.length > 0 || !!selection.selectedSceneId;
  const hasSelection = hasObjectSelection || !!selection.selectedAudioId;

  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const toggleScene = (id: string) => {
    setExpandedScenes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startEditing = (id: string, currentName: string) => {
    setEditingId(id);
    setEditValue(currentName);
  };

  const commitEdit = () => {
    if (!editingId || !editValue.trim()) {
      setEditingId(null);
      return;
    }
    
    // Check if it's a scene or item
    const isScene = project.scenes.some(s => s.id === editingId);
    if (isScene) {
      updateScene(editingId, { name: editValue.trim() });
    } else {
      updateItem(editingId, { name: editValue.trim() });
    }
    setEditingId(null);
  };

  /** Get the active scene at current time */
  const activeSceneId = project.scenes.find(
    s => currentTimeMs >= s.start && currentTimeMs < s.end
  )?.id;

  /** Filter items by search query */
  const filteredScenes = project.scenes.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      project.items.some(i => i.sceneId === s.id && i.name.toLowerCase().includes(q))
    );
  });

  const getItemsForScene = (sceneId: string): ProjectItem[] => {
    return project.items.filter(i => {
      if (i.sceneId !== sceneId) return false;
      if (!searchQuery) return true;
      return i.name.toLowerCase().includes(searchQuery.toLowerCase());
    });
  };

  const getItemTypeIcon = (type: string): string => {
    switch (type) {
      case 'heading': return '📝';
      case 'text': return '✏️';
      case 'image': return '🖼️';
      case 'svg': return '⬡';
      case 'graphic': return '🎨';
      case 'container': return '📦';
      default: return '▪';
    }
  };

  return (
    <div className="layer-tree">
      <div className="panel-header">
        <span>Layers</span>
        <span className="badge">{project.scenes.length} scenes</span>
      </div>
      
      <div className="layer-toolbar">
        <button className="btn btn-sm" disabled={!hasObjectSelection} title="Copy (Ctrl+C)" onClick={() => copySelection()}>Copy</button>
        <button className="btn btn-sm" disabled={!hasObjectSelection} title="Cut (Ctrl+X)" onClick={() => cutSelection()}>Cut</button>
        <button className="btn btn-sm" disabled={!clipboard} title="Paste into the selected scene (Ctrl+V)" onClick={() => pasteClipboard()}>Paste</button>
        <button className="btn btn-sm" disabled={!hasObjectSelection} title="Duplicate (Ctrl+D)" onClick={() => duplicateSelection()}>Duplicate</button>
        <button className="btn btn-sm btn-danger" disabled={!hasSelection} title="Delete selected scene, item, or audio clip (Delete)" onClick={() => deleteSelection()}>Delete</button>
      </div>

      <div className="layer-search">
        <input
          type="text"
          placeholder="Search layers..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="layer-list">
        {filteredScenes.length === 0 ? (
          <div className="layer-empty">
            {project.scenes.length === 0
              ? 'Import an HTML file to see layers'
              : 'No layers match your search'}
          </div>
        ) : (
          filteredScenes.map((scene) => {
            const isSelected = selection.selectedSceneId === scene.id;
            const isActive = activeSceneId === scene.id;
            const isExpanded = expandedScenes.has(scene.id);
            const items = getItemsForScene(scene.id);
            
            return (
              <div key={scene.id} className="layer-scene">
                {/* Scene row */}
                <div
                  className={`layer-row scene-row ${isSelected ? 'selected' : ''} ${isActive ? 'active' : ''}`}
                  onClick={() => { selectScene(scene.id); }}
                  onDoubleClick={() => startEditing(scene.id, scene.name)}
                >
                  <button
                    className="expand-btn"
                    onClick={(e) => { e.stopPropagation(); toggleScene(scene.id); }}
                  >
                    {isExpanded ? '▾' : '▸'}
                  </button>
                  
                  <span className="layer-icon">🎬</span>
                  
                  {editingId === scene.id ? (
                    <input
                      className="layer-edit-input"
                      value={editValue}
                      autoFocus
                      onClick={e => e.stopPropagation()}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitEdit();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                    />
                  ) : (
                    <span className="layer-name">{scene.name}</span>
                  )}
                  
                  <span className="layer-time">
                    {(scene.start / 1000).toFixed(1)}s
                  </span>
                  
                  {isActive && <span className="active-dot" title="Current scene" />}
                </div>

                {/* Items */}
                {isExpanded && items.map((item) => {
                  const isItemSelected = selection.selectedItemIds.includes(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`layer-row item-row ${isItemSelected ? 'selected' : ''} ${item.locked ? 'locked' : ''} ${item.hidden ? 'hidden-layer' : ''}`}
                      onClick={(e) => { selectItem(item.id, e.ctrlKey || e.metaKey); }}
                      onDoubleClick={() => startEditing(item.id, item.name)}
                    >
                      <span className="layer-indent" />
                      <span className="layer-icon">{getItemTypeIcon(item.type)}</span>
                      
                      {editingId === item.id ? (
                        <input
                          className="layer-edit-input"
                          value={editValue}
                          autoFocus
                          onClick={e => e.stopPropagation()}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitEdit();
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                      ) : (
                        <span className="layer-name" title={item.selector}>{item.name}</span>
                      )}
                      
                      <div className="layer-actions">
                        <button
                          className="btn-icon"
                          title={item.locked ? 'Unlock' : 'Lock'}
                          onClick={(e) => { e.stopPropagation(); updateItem(item.id, { locked: !item.locked }); }}
                        >
                          {item.locked ? '🔒' : '🔓'}
                        </button>
                        <button
                          className="btn-icon"
                          title={item.hidden ? 'Show' : 'Hide'}
                          onClick={(e) => { e.stopPropagation(); updateItem(item.id, { hidden: !item.hidden }); }}
                        >
                          {item.hidden ? '👁‍🗨' : '👁'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default LayerTree;
