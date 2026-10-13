import React, { useState } from 'react';
import type { ImportReport } from '../types/project';
import './ImportReportModal.css';

interface ImportReportModalProps {
  report: ImportReport;
  onClose: () => void;
}

type IssueKind = 'warning' | 'error';

function getIssueHelp(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('cannot set properties of null') && lower.includes('setting')) return {
    impact: 'The HTML script tried to update a control that does not exist. The failing seek/render function may stop before updating the rest of that frame.',
    fix: 'Add the expected element with the correct id before seek() runs, or guard the write: const el=document.getElementById("control-id"); if(el) el.value=value;.'
  };
  if (lower.includes('preview runtime error')) return {
    impact: 'A source-page JavaScript error occurred while rendering the preview. That frame or later animation updates may be incomplete.',
    fix: 'Open the source near the reported line, correct the JavaScript error, then re-import. The preview line may include injected editor code, so use the error message and page DevTools to locate the source statement.'
  };
  if (lower.includes('sc array') || lower.includes('scenes from <section>')) return {
    impact: 'Scene timing may be estimated equally, so cuts can land at the wrong points.',
    fix: 'Define SC as numeric [start,end] pairs in seconds, in the same order as the <section> elements. Example: const SC=[[0,5],[5,10],[10,15]].'
  };
  if (lower.includes('after the detected total duration')) return {
    impact: 'The last scene extends beyond the project duration and may be cut off.',
    fix: 'Set D in milliseconds to at least the final SC end in seconds multiplied by 1000, or shorten the final scene.'
  };
  if (lower.includes('before the detected total duration')) return {
    impact: 'The final part of the project has no scene and may appear blank.',
    fix: 'Extend the last SC end to the project duration in seconds, or reduce D to match the intended final scene end.'
  };
  if (lower.includes('duration') || lower.includes('defaulting to 30s')) return {
    impact: 'The editor may use a 30 second fallback and misalign the timeline.',
    fix: 'Add a numeric duration in milliseconds, e.g. const D=30000; or set max on the #rg range input.'
  };
  if (lower.includes('no scenes detected')) return {
    impact: 'The editor cannot map the animation into scenes.',
    fix: 'Put each scene in its own <section>, add an SC array, and expose a seek(ms) function on window.'
  };
  if (lower.includes('seek(ms)')) return {
    impact: 'The editor may be unable to control the animation when you scrub, pause, or export.',
    fix: 'Create a deterministic function seek(ms) that updates the page for the requested millisecond time, then expose it with window.seek=seek; and call seek(0) after setup.'
  };
  if (lower.includes('sc defines') && lower.includes('<section>')) return {
    impact: 'Scene timing entries do not line up one-to-one with the HTML sections.',
    fix: 'Make the number and order of SC [start,end] pairs match the number and order of <section> elements.'
  };
  if (lower.includes('gap or overlap')) return {
    impact: 'The timeline may show an unintended blank interval or overlapping scene boundary.',
    fix: 'Make each SC scene start where the previous scene ends, for example [[0,5],[5,10],[10,15]].'
  };
  if (lower.includes('initial gap')) return {
    impact: 'The timeline begins with a blank interval before the first scene.',
    fix: 'Set the first SC start time to 0 seconds.'
  };
  if (lower.includes('sc array is empty')) return {
    impact: 'The editor cannot use scene-specific timing and may fall back to equal-duration sections.',
    fix: 'Add at least one numeric [start,end] pair for each <section> in the SC array.'
  };
  if (lower.includes('invalid timing')) return {
    impact: 'A scene has a negative start or ends before it starts, so the timeline cannot represent it reliably.',
    fix: 'Use non-negative numeric seconds and make each end greater than its start in the SC array.'
  };
  if (lower.includes('no editable text')) return {
    impact: 'The HTML may preview, but no text/timed elements will appear in the layer tree for editing.',
    fix: 'Add data-s="startSeconds" to timed text, or use supported headings and paragraphs. Artwork-only SVG can remain non-editable.'
  };
  if (lower.includes('stage dimensions')) return {
    impact: 'The preview defaults to 1280x720 and may scale or crop the source incorrectly.',
    fix: 'Give #stage explicit pixel width and height, for example #stage { width:1280px; height:720px; }.'
  };
  if (lower.includes('own audio')) return {
    impact: 'Page audio is muted in preview and export.',
    fix: 'Import the music separately from the Audio panel.'
  };
  if (lower.includes('underscore') && lower.includes('font')) return {
    impact: 'A Google Font may fail to load.',
    fix: 'Use + between words in Google Fonts family URLs. The importer attempts this correction automatically.'
  };
  return {
    impact: 'This feature may not be imported as expected.',
    fix: 'Review the source HTML around this feature. Copy the diagnostic log to share the raw details for help.'
  };
}

const ImportReportModal: React.FC<ImportReportModalProps> = ({ report, onClose }) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const issues: Array<{ message: string; kind: IssueKind }> = [
    ...report.errors.map(message => ({ message, kind: 'error' as const })),
    ...report.warnings.map(message => ({ message, kind: 'warning' as const }))
  ];

  const copyLog = async () => {
    const log = [
      'h2video H2VID - Import diagnostic log',
      `File: ${report.file || '(unknown)'}`,
      `Result: ${report.errors.length ? 'Imported with errors' : issues.length ? 'Imported with warnings' : 'Imported successfully'}`,
      `Duration: ${(report.duration / 1000).toFixed(1)} seconds`,
      `Scenes: ${report.sceneCount}`,
      `Editable items: ${report.itemCount}`,
      '',
      issues.length ? 'Issues and suggested fixes:' : 'Issues: none',
      ...issues.flatMap(({ message, kind }) => {
        const help = getIssueHelp(message);
        return [`[${kind.toUpperCase()}] ${message}`, `Impact: ${help.impact}`, `Fix: ${help.fix}`, ''];
      }),
      `Detected duration declaration: ${report.rawD || '(not detected)'}`,
      'Detected SC array:',
      report.rawSC ? (report.rawSC.length > 3000 ? `${report.rawSC.slice(0, 3000)}...(truncated)` : report.rawSC) : '(not detected)'
    ].join('\n');

    try {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(log);
        } catch {
          // Some Electron and file:// contexts expose the API but reject writes.
          // Fall through to the textarea copy path.
          const textarea = document.createElement('textarea');
          textarea.value = log;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          const copied = document.execCommand('copy');
          textarea.remove();
          if (!copied) throw new Error('Clipboard copy failed');
        }
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = log;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('Clipboard copy failed');
      }
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    window.setTimeout(() => setCopyState('idle'), 2500);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal import-report-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Import Report</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close import report">×</button>
        </div>

        <div className="modal-body">
          <div className="report-stats">
            <div className="stat">
              <span className="stat-value">{(report.duration / 1000).toFixed(1)}s</span>
              <span className="stat-label">Duration</span>
            </div>
            <div className="stat">
              <span className="stat-value">{report.sceneCount}</span>
              <span className="stat-label">Scenes</span>
            </div>
            <div className="stat">
              <span className="stat-value">{report.itemCount}</span>
              <span className="stat-label">Items</span>
            </div>
          </div>

          {issues.length > 0 && (
            <div className="report-section">
              <h3>Import issues &amp; how to fix them</h3>
              <div className="report-issues">
                {issues.map(({ message, kind }, i) => {
                  const help = getIssueHelp(message);
                  return (
                    <article key={`${kind}-${i}`} className={`report-issue ${kind}`}>
                      <div className="issue-heading">
                        <span className={`issue-badge ${kind}`}>{kind === 'error' ? 'Error' : 'Warning'}</span>
                        <span>{message}</span>
                      </div>
                      <p><strong>What this means:</strong> {help.impact}</p>
                      <p><strong>How to fix:</strong> {help.fix}</p>
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          {issues.length === 0 && (
            <p className="success-msg">File imported successfully with no detected issues.</p>
          )}
        </div>

        <div className="modal-footer">
          <div className="copy-log-status" role="status" aria-live="polite">
            {copyState === 'copied' && 'Diagnostic log copied'}
            {copyState === 'failed' && 'Could not copy. Check clipboard permission.'}
          </div>
          <button className="btn" onClick={copyLog}>
            {copyState === 'copied' ? 'Copied!' : 'Copy diagnostic log'}
          </button>
          <button className="btn btn-primary" onClick={onClose}>OK, Got It</button>
        </div>
      </div>
    </div>
  );
};

export default ImportReportModal;
