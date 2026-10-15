import React, { useEffect, useCallback, useRef } from 'react';
import Layout from './app/Layout';
import { useProjectStore } from './store/project';
import { parseHtmlSource, buildProjectFromParsed } from './engine/importer';


const App: React.FC = () => {
  const {
    setProject,
    setProjectFilePath,
    setLoading,
    setImportReport,
    markSaved,
    project,
    projectFilePath
  } = useProjectStore();
  
  const autoSaveTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const undoProject = useCallback(() => {
    const temporal = useProjectStore.temporal.getState();
    if (!temporal.pastStates.length) return false;
    temporal.undo();
    useProjectStore.getState().markModified();
    return true;
  }, []);

  const redoProject = useCallback(() => {
    const temporal = useProjectStore.temporal.getState();
    if (!temporal.futureStates.length) return false;
    temporal.redo();
    useProjectStore.getState().markModified();
    return true;
  }, []);

  /** Load and parse HTML file by path */
  const loadHtmlFromFile = useCallback(async (filePath: string) => {
    try {
      setLoading(true, 'Importing HTML...');
      const fileResult = await window.electronAPI.readFile(filePath);
      if (!fileResult.success || !fileResult.content) {
        throw new Error(fileResult.error || 'Failed to read file');
      }

      const parsed = parseHtmlSource(fileResult.content);
      const { project, report } = buildProjectFromParsed(parsed, filePath, fileResult.content);

      setProject(project);
      setImportReport(report);
      setProjectFilePath(null); // New import, no project file yet
    } catch (error) {
      console.error('Import error:', error);
      const message = error instanceof Error ? error.message : String(error);
      setImportReport({
        file: filePath,
        duration: 0,
        sceneCount: 0,
        itemCount: 0,
        warnings: [],
        errors: [message]
      });
    } finally {
      setLoading(false);
    }
  }, [setProject, setImportReport, setProjectFilePath, setLoading]);

  /** Import an HTML animation file via dialog */
  const importHtml = useCallback(async () => {
    try {
      const result = await window.electronAPI.showOpenDialog({
        title: 'Import HTML Animation',
        filters: [{ name: 'HTML Files', extensions: ['html', 'htm'] }],
        properties: ['openFile']
      });

      if (result.canceled || !result.filePaths[0]) return;
      await loadHtmlFromFile(result.filePaths[0]);
    } catch (error) {
      console.error('Import error:', error);
      alert(`Import failed: ${error}`);
    }
  }, [loadHtmlFromFile]);

  /** Save project as .h2v.json */
  const saveProject = useCallback(async (saveAs = false) => {
    try {
      let savePath = projectFilePath;
      
      if (!savePath || saveAs) {
        const result = await window.electronAPI.showSaveDialog({
          title: 'Save Project',
          defaultPath: 'project.h2v.json',
          filters: [{ name: 'H2V Project', extensions: ['h2v.json'] }]
        });
        
        if (result.canceled || !result.filePath) return;
        savePath = result.filePath;
      }
      
      // Don't include htmlContent in saved project (just the path reference)
      const projectToSave = {
        ...project,
        source: {
          ...project.source,
          htmlContent: undefined // Don't save HTML content
        }
      };
      
      const writeResult = await window.electronAPI.writeFile(
        savePath,
        JSON.stringify(projectToSave, null, 2)
      );
      
      if (!writeResult.success) throw new Error(writeResult.error);
      
      setProjectFilePath(savePath);
      markSaved();
      
    } catch (error) {
      console.error('Save error:', error);
      alert(`Save failed: ${error}`);
    }
  }, [project, projectFilePath, setProjectFilePath, markSaved]);

  /** Open a saved .h2v.json project */
  const openProject = useCallback(async () => {
    try {
      const result = await window.electronAPI.showOpenDialog({
        title: 'Open Project',
        filters: [{ name: 'H2V Project', extensions: ['h2v.json', 'json'] }],
        properties: ['openFile']
      });
      
      if (result.canceled || !result.filePaths[0]) return;
      
      const projectPath = result.filePaths[0];
      setLoading(true, 'Opening project...');
      
      const fileResult = await window.electronAPI.readFile(projectPath);
      if (!fileResult.success || !fileResult.content) {
        throw new Error(fileResult.error || 'Failed to read project');
      }
      
      const loadedProject = JSON.parse(fileResult.content);
      
      // Load the HTML content from the source file
      const projectDir = projectPath.replace(/[\\/][^\\/]*$/, '');
      const resolveProjectFile = (file: string) => /^[a-zA-Z]:[\\/]|^\\\\|^\//.test(file) ? file : `${projectDir}/${file}`;
      const sourceFile = resolveProjectFile(loadedProject.source.file);
      const htmlResult = await window.electronAPI.readFile(sourceFile);
      if (htmlResult.success && htmlResult.content) {
        loadedProject.source.file = sourceFile;
        loadedProject.source.htmlContent = htmlResult.content;
      }
      for (const clip of loadedProject.audio || []) clip.file = resolveProjectFile(clip.file);
      for (const asset of loadedProject.audioAssets || []) asset.file = resolveProjectFile(asset.file);
      
      setProject(loadedProject);
      setProjectFilePath(projectPath);
      markSaved();
      
    } catch (error) {
      console.error('Open error:', error);
      alert(`Open failed: ${error}`);
    } finally {
      setLoading(false);
    }
  }, [setProject, setProjectFilePath, setLoading, markSaved]);

  const shareProject = useCallback(async () => {
    try {
      const result = await window.electronAPI.shareProject(project);
      if (result.canceled) return;
      if (!result.success) throw new Error(result.error || 'Could not create the share archive.');
      alert(`Project share ZIP saved to:\n${result.filePath}`);
    } catch (error) {
      alert(`Project share failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [project]);

  // Setup keyboard shortcuts and menu event listeners
  useEffect(() => {
    if (!window.electronAPI) return;
    
    const unsubs = [
      window.electronAPI.on('menu:import', () => importHtml()),
      window.electronAPI.on('menu:save', () => saveProject()),
      window.electronAPI.on('menu:open', () => openProject()),
      window.electronAPI.on('menu:share', () => shareProject()),
      window.electronAPI.on('menu:undo', () => undoProject()),
      window.electronAPI.on('menu:redo', () => redoProject()),
      window.electronAPI.on('menu:duplicate', () => useProjectStore.getState().duplicateSelection()),
      window.electronAPI.on('menu:delete', () => useProjectStore.getState().deleteSelection()),
    ];
    
    return () => unsubs.forEach(fn => fn?.());
  }, [importHtml, saveProject, openProject, shareProject, undoProject, redoProject]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (useProjectStore.getState().deleteSelection()) e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (!e.altKey && key === 'z') {
          e.preventDefault();
          if (e.shiftKey) redoProject();
          else undoProject();
          return;
        }
        if (!e.altKey && key === 'y') {
          e.preventDefault();
          redoProject();
          return;
        }
        if (e.key === 'o' && !e.shiftKey) { e.preventDefault(); importHtml(); }
        if (e.key === 's') { e.preventDefault(); saveProject(); }
        if (e.key === 'O' && e.shiftKey) { e.preventDefault(); openProject(); }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [importHtml, saveProject, openProject, undoProject, redoProject]);

  // Autosave every 30 seconds if modified
  useEffect(() => {
    autoSaveTimer.current = setInterval(() => {
      const state = useProjectStore.getState();
      if (state.isModified && state.projectFilePath) {
        saveProject();
      }
    }, 30000);
    
    return () => {
      if (autoSaveTimer.current) clearInterval(autoSaveTimer.current);
    };
  }, [saveProject]);

  // Drag and drop HTML file to import
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer?.files?.[0];
      if (file && (file.name.endsWith('.html') || file.name.endsWith('.htm'))) {
        // Electron adds the absolute file path to File objects
        const filePath = (file as unknown as { path?: string }).path;
        if (filePath) {
          loadHtmlFromFile(filePath);
        }
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [loadHtmlFromFile]);

  return (
    <Layout
      onImportHtml={importHtml}
      onSaveProject={saveProject}
      onOpenProject={openProject}
    />
  );
};

export default App;
