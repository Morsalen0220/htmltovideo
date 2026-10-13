import React, { useState } from 'react';
import { useProjectStore } from '../store/project';
import LayerTree from '../components/LayerTree/LayerTree';
import Preview from '../components/Preview/Preview';
import Properties from '../components/Properties/Properties';
import Timeline from '../components/Timeline/Timeline';
import ExportDialog from '../components/Export/ExportDialog';
import ImportReportModal from '../components/ImportReportModal';
import { useClipboardShortcuts } from './useClipboardShortcuts';
import './Layout.css';

interface LayoutProps {
  onImportHtml: () => void;
  onSaveProject: () => void;
  onOpenProject: () => void;
}

const Layout: React.FC<LayoutProps> = ({ onImportHtml, onSaveProject, onOpenProject }) => {
  const { project, isModified, isLoading, loadingMessage, importReport, setImportReport } = useProjectStore();
  const [showExport, setShowExport] = useState(false);
  const [leftWidth, setLeftWidth] = useState(220);
  const [rightWidth, setRightWidth] = useState(280);
  const [timelineHeight, setTimelineHeight] = useState(200);
  const hasProject = !!project.source.file;
  useClipboardShortcuts();

  return (
    <div className="layout">
      {/* Top toolbar */}
      <header className="toolbar">
        <div className="toolbar-left">
          <span className="app-name">🎬 h2video H2VID</span>
          {isModified && <span className="modified-badge" title="Unsaved changes">●</span>}
        </div>
        
        <div className="toolbar-center">
          {hasProject && (
            <span className="project-name">
              {project.source.file.split(/[\\/]/).pop()}
            </span>
          )}
        </div>
        
        <div className="toolbar-right">
          <button className="btn" onClick={onOpenProject} title="Open Project (Ctrl+Shift+O)">
            📂 Open
          </button>
          <button className="btn btn-primary" onClick={onImportHtml} title="Import HTML (Ctrl+O)">
            ⬇️ Import HTML
          </button>
          {hasProject && (
            <>
              <button className="btn" onClick={() => onSaveProject()} title="Save (Ctrl+S)">
                💾 Save
              </button>
              <button className="btn btn-primary" onClick={() => setShowExport(true)} title="Export Video">
                🎬 Export
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main content area */}
      <div className="content-area">
        {/* Left panel: Layer tree */}
        <div className="panel panel-left" style={{ width: leftWidth }}>
          <LayerTree />
        </div>
        
        <div className="resize-handle resize-handle-h"
          onMouseDown={(e) => {
            const startX = e.clientX;
            const startW = leftWidth;
            const onMove = (e: MouseEvent) => setLeftWidth(Math.max(160, Math.min(400, startW + e.clientX - startX)));
            const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          }}
        />

        {/* Center panel: Preview + Timeline */}
        <div className="panel panel-center">
          <div className="preview-area">
            <Preview />
          </div>
          
          <div className="resize-handle resize-handle-v"
            onMouseDown={(e) => {
              const startY = e.clientY;
              const startH = timelineHeight;
              const onMove = (e: MouseEvent) => setTimelineHeight(Math.max(100, Math.min(400, startH - (e.clientY - startY))));
              const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            }}
          />
          
          <div className="timeline-area" style={{ height: timelineHeight }}>
            <Timeline />
          </div>
        </div>

        <div className="resize-handle resize-handle-h"
          onMouseDown={(e) => {
            const startX = e.clientX;
            const startW = rightWidth;
            const onMove = (e: MouseEvent) => setRightWidth(Math.max(200, Math.min(420, startW - (e.clientX - startX))));
            const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          }}
        />

        {/* Right panel: Properties */}
        <div className="panel panel-right" style={{ width: rightWidth }}>
          <Properties />
        </div>
      </div>

      {/* Export dialog */}
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}

      {/* Import report modal */}
      {importReport && (
        <ImportReportModal
          report={importReport}
          onClose={() => setImportReport(null)}
        />
      )}

      {/* Loading overlay */}
      {isLoading && (
        <div className="loading-overlay">
          <div className="spinner" />
          <span>{loadingMessage || 'Loading...'}</span>
        </div>
      )}
    </div>
  );
};

export default Layout;
