/**
 * HTML import pipeline.
 * Parses an HTML animation file to extract:
 * - Stage dimensions
 * - Total duration (D variable)
 * - Scenes (SC array + section elements)
 * - Items (elements with data-s, headings, SVG groups, images)
 */

import type { ProjectData, ProjectScene, ProjectItem, ImportReport, ItemType } from '../types/project';

/** A detected item before it's added to the project */
interface DetectedItem {
  selector: string;
  type: ItemType;
  name: string;
  dataS?: number;
  dataD?: number;
  dataY?: number;
  text?: string;
}

/**
 * Parse HTML string and extract animation metadata.
 * This runs in the renderer process (no DOM access to the main window).
 * The actual DOM parsing is done via a sandboxed webview/iframe.
 */
export interface ParsedHtml {
  duration: number;         // ms
  stage: { w: number; h: number };
  scenes: Array<{ start: number; end: number; name: string }>;  // times in ms
  items: DetectedItem[];
  warnings: string[];
  hasCaptureModeParam: boolean;
  hasOwnAudio: boolean;
  rawSC: string;            // The SC array as found in the source
  rawD: string;             // The D variable as found in the source
}

/**
 * Extract metadata from HTML source using regex (no DOM needed).
 * This is the server-side/engine-side parse.
 */
export function parseHtmlSource(html: string): ParsedHtml {
  const warnings: string[] = [];
  
  // -------------------------------------------------------
  // 1. Extract duration D
  // -------------------------------------------------------
  let duration = 30000;
  let rawD = '';
  
  // Match: const D = 30000 or let D = 30000 or var D = 30000
  const dMatch = html.match(/(?:const|let|var)\s+D\s*=\s*(\d+)/);
  if (dMatch) {
    duration = parseInt(dMatch[1], 10);
    rawD = dMatch[0];
  } else {
    // Try to get from range slider max
    const rgMatch = html.match(/id="rg"[^>]*max="(\d+)"/);
    if (rgMatch) {
      duration = parseInt(rgMatch[1], 10);
    } else {
      warnings.push('Could not detect duration (D variable or #rg max). Defaulting to 30s.');
    }
  }

  // -------------------------------------------------------
  // 2. Extract scenes SC
  // -------------------------------------------------------
  let scenes: Array<{ start: number; end: number; name: string }> = [];
  let rawSC = '';
  
  // Find `SC = [ ... ]` (const/let/var or part of `const D=..., SC=...`), tolerate // and /* */ comments
  // and trailing commas, by scanning for the balanced bracket ourselves.
  const scStart = html.search(/(?:const|let|var|,)\s*SC\s*=\s*\[/);
  if (scStart >= 0) {
    const open = html.indexOf('[', scStart);
    let depth = 0;
    let end = -1;
    for (let i = open; i < html.length; i++) {
      const ch = html[i];
      if (ch === '/' && html[i + 1] === '/') { i = html.indexOf('\n', i); if (i < 0) break; continue; }
      if (ch === '/' && html[i + 1] === '*') { i = html.indexOf('*/', i + 2); if (i < 0) break; i++; continue; }
      if (ch === '[') depth++;
      else if (ch === ']') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end > 0) {
      rawSC = html.slice(open, end + 1)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
        .replace(/,\s*([\]\}])/g, '$1');
      try {
        const pairs: [number, number][] = JSON.parse(rawSC);
        scenes = pairs.map((pair, i) => ({
          start: pair[0] * 1000,
          end: pair[1] * 1000,
          name: getSceneName(html, i)
        }));
      } catch (e) {
        warnings.push('SC array was found but could not be parsed. Equal-duration section fallback may be used.');
      }
    }
  }

  // Fallback: count section elements
  if (scenes.length === 0) {
    const sectionCount = (html.match(/<section/g) || []).length;
    if (sectionCount > 0) {
      const sceneDuration = duration / sectionCount;
      for (let i = 0; i < sectionCount; i++) {
        scenes.push({
          start: i * sceneDuration,
          end: (i + 1) * sceneDuration,
          name: `Scene ${i + 1}`
        });
      }
      if (scStart < 0) {
        warnings.push(`No SC array found. Created ${sectionCount} equal-duration scenes from <section> elements.`);
      }
    } else {
      warnings.push('No scenes detected. Treating the entire animation as a single scene.');
      scenes = [{ start: 0, end: duration, name: 'Scene 1' }];
    }
  }

  if (scStart >= 0 && scenes.length === 0 && !warnings.some(w => w.startsWith('SC array was found but could not be parsed'))) {
    warnings.push('SC array is empty or contains no usable scene pairs.');
  }

  const sectionCount = (html.match(/<section\b/gi) || []).length;
  if (scStart >= 0 && sectionCount > 0 && scenes.length !== sectionCount) {
    warnings.push(`SC defines ${scenes.length} scenes but the HTML contains ${sectionCount} <section> elements.`);
  }
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (scene.start < 0 || scene.end <= scene.start) {
      warnings.push(`Scene ${i + 1} has invalid timing (${(scene.start / 1000).toFixed(2)}s to ${(scene.end / 1000).toFixed(2)}s).`);
      break;
    }
    if (i === 0 && scene.start > 1) {
      warnings.push('SC timing starts after 0 seconds, leaving an initial gap before scene 1.');
    }
    if (i > 0 && Math.abs(scene.start - scenes[i - 1].end) > 1) {
      warnings.push(`SC timing has a gap or overlap before scene ${i + 1}.`);
      break;
    }
  }
  if (scenes.length && scenes[scenes.length - 1].end > duration + 1) {
    warnings.push('The final scene ends after the detected total duration.');
  } else if (scenes.length && scenes[scenes.length - 1].end < duration - 1) {
    warnings.push('The final scene ends before the detected total duration, leaving a blank tail.');
  }

  const hasSeekController = /\bfunction\s+seek\s*\(|\b(?:const|let|var)\s+seek\s*=|window\s*(?:\.\s*seek|\[\s*['"]seek['"]\s*\])\s*=/.test(html);
  if (!hasSeekController) {
    warnings.push('No seek(ms) animation function was detected. The imported page may not respond correctly to preview seeking or export.');
  }
  const hasCssAnimations = /@keyframes\b|\banimation(?:-name|-duration)?\s*:/i.test(html);
  const pageControlsAnimationTime = /\.getAnimations\s*\(|\.currentTime\s*=/.test(html);
  if (hasSeekController && hasCssAnimations && pageControlsAnimationTime) {
    warnings.push('The page seek() controller manages CSS animation timing. H2VID preserves its scene-relative animation times; check animation delays against each scene duration if motion still appears missing.');
  }

  // -------------------------------------------------------
  // 3. Extract items (elements with data-s)
  // -------------------------------------------------------
  const items: DetectedItem[] = extractItemsFromHtml(html, scenes);
  if (items.length === 0) {
    warnings.push('No editable text or timed items were detected. The HTML can still preview, but the layer tree may be empty.');
  }
  
  // -------------------------------------------------------
  // 4. Detect stage size
  // -------------------------------------------------------
  const stage = detectStageSize(html);
  const hasExplicitStage = /#stage\s*\{[^}]*width:\s*\d+px[^}]*height:\s*\d+px/i.test(html)
    || /id="stage"[^>]*style="[^"]*width:\s*\d+px[^\"]*height:\s*\d+px/i.test(html)
    || /viewBox="0\s+0\s+\d+\s+\d+"/.test(html);
  if (!hasExplicitStage) {
    warnings.push('Stage dimensions were not detected. The editor will use its 1280x720 default, which may not match the source layout.');
  }

  // -------------------------------------------------------
  // 5. Detect features
  // -------------------------------------------------------
  const hasCaptureModeParam = html.includes('?capture') || html.includes('capture');
  const hasOwnAudio = html.includes('AudioContext') || html.includes('audioContext') || html.includes('<audio');
  
  if (hasOwnAudio) {
    warnings.push('This page contains its own audio (AudioContext or <audio>). It will be muted in preview and export. Import a music file instead.');
  }
  
  // Check for underscore font names
  if (html.includes('Hind_Siliguri') || html.includes('Noto_Sans')) {
    warnings.push('Google Font names contain underscores (e.g., Hind_Siliguri). The app will fix these automatically.');
  }

  return {
    duration,
    stage,
    scenes,
    items,
    warnings,
    hasCaptureModeParam,
    hasOwnAudio,
    rawSC,
    rawD
  };
}

/** Extract scene name from HTML comments near the section, or JS scene comments */
function getSceneName(html: string, sceneIndex: number): string {
  // 1. Look for HTML comment patterns like <!-- 4-9 beach --> near sections
  const commentRe = /<!--\s*([^-]+?)\s*-->/g;
  const comments: string[] = [];
  let match;
  while ((match = commentRe.exec(html)) !== null) {
    const txt = match[1].trim();
    if (txt && !txt.startsWith('!')) {
      comments.push(txt);
    }
  }
  
  if (comments[sceneIndex]) {
    // Clean up: remove time prefix like "4-9 "
    return comments[sceneIndex].replace(/^[\d-]+\s*/, '').trim() || `Scene ${sceneIndex + 1}`;
  }

  // 2. Look for JS comments like `// দৃশ্য ১: ভোর` or `// Scene 1: Beach`
  const jsComments: string[] = [];
  const jsRe = /(?:^|\n)\s*\/\/\s*(?:(?:দৃশ্য|Scene|scene)\s*[\d০-৯a-zA-Z]+[:\s-]*)?([^\n\r]+)/g;
  while ((match = jsRe.exec(html)) !== null) {
    const txt = match[1].trim();
    if (txt && !txt.startsWith('/') && !txt.startsWith('*')) {
      jsComments.push(txt);
    }
  }

  if (jsComments[sceneIndex]) {
    return jsComments[sceneIndex].replace(/^[\d-]+\s*/, '').trim() || `Scene ${sceneIndex + 1}`;
  }
  
  return `Scene ${sceneIndex + 1}`;
}

/** Detect the stage size from the HTML */
function detectStageSize(html: string): { w: number; h: number } {
  // Look for id="stage" with fixed dimensions
  const stageMatch = html.match(/id="stage"[^>]*style="[^"]*width:\s*(\d+)px[^"]*height:\s*(\d+)px/);
  if (stageMatch) {
    return { w: parseInt(stageMatch[1], 10), h: parseInt(stageMatch[2], 10) };
  }
  
  // Look for CSS: #stage { width: 1280px; height: 720px }
  const cssMatch = html.match(/#stage\s*{[^}]*width:\s*(\d+)px[^}]*height:\s*(\d+)px/);
  if (cssMatch) {
    return { w: parseInt(cssMatch[1], 10), h: parseInt(cssMatch[2], 10) };
  }
  
  // Look for viewBox on top-level SVG
  const svgMatch = html.match(/viewBox="0\s+0\s+(\d+)\s+(\d+)"/);
  if (svgMatch) {
    return { w: parseInt(svgMatch[1], 10), h: parseInt(svgMatch[2], 10) };
  }
  
  // Default to 1280x720
  return { w: 1280, h: 720 };
}

/**
 * Extract detectable items from HTML source.
 * Items are elements with data-s, headings, SVG groups with ids, and images.
 */
function extractItemsFromHtml(
  html: string,
  scenes: Array<{ start: number; end: number; name: string }>
): DetectedItem[] {
  const items: DetectedItem[] = [];
  
  // Parse sections to assign items to scenes
  const sectionChunks = html.split(/<section[^>]*>/i).slice(1);
  
  sectionChunks.forEach((sectionHtml, sceneIdx) => {
    const endIdx = sectionHtml.indexOf('</section>');
    const chunk = endIdx >= 0 ? sectionHtml.substring(0, endIdx) : sectionHtml;
    
    // Find all elements with a data-s attribute (any quoting). Selectors use the stable ids the in-page runtime
    // assigns (data-h2v="d<section>-<n>"), so they always hit the right element.
    const dataRe = /<(\w+)\b[^>]*?\sdata-s\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let match;
    let itemIdx = 0;

    while ((match = dataRe.exec(chunk)) !== null) {
      const tag = match[1].toLowerCase();
      const dataS = parseFloat(match[2] ?? match[3] ?? match[4]);

      // Get data-d and data-y (from the same opening tag)
      const tagEnd = chunk.indexOf('>', match.index);
      const openTag = chunk.substring(match.index, tagEnd >= 0 ? tagEnd : match.index + 300);
      const dataDMatch = openTag.match(/data-d\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/);
      const dataYMatch = openTag.match(/data-y\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/);
      const dataD = dataDMatch ? parseFloat(dataDMatch[1] ?? dataDMatch[2] ?? dataDMatch[3]) : 0.8;
      const dataY = dataYMatch ? parseFloat(dataYMatch[1] ?? dataYMatch[2] ?? dataYMatch[3]) : 40;

      // Extract text content
      const aroundMatch = chunk.substring(match.index, match.index + 400);
      const textMatch = aroundMatch.match(/>([^<]+)</);
      const text = textMatch ? textMatch[1].trim() : '';

      // Determine type
      let type: ItemType = 'container';
      if (tag === 'h1' || tag === 'h2' || tag === 'h3') type = 'heading';
      else if (tag === 'p' || tag === 'span') type = 'text';
      else if (tag === 'img') type = 'image';
      else if (tag === 'svg') type = 'svg';

      // Generate a name
      let name = text || tag.toUpperCase();
      if (name.length > 30) name = name.substring(0, 30) + '...';

      items.push({
        selector: `[data-h2v="d${sceneIdx}-${itemIdx}"]`,
        type,
        name: name || `${type} ${itemIdx + 1}`,
        dataS: Number.isFinite(dataS) ? dataS : 0,
        dataD: Number.isFinite(dataD) ? dataD : 0.8,
        dataY: Number.isFinite(dataY) ? dataY : 40,
        text: text || undefined
      });

      itemIdx++;
    }

    // Also detect headings and paragraphs WITHOUT data-s (those with data-s were added above).
    // Counting every h1/h2/h3/p keeps the index identical to the in-page tagger (data-h2t="<tag>-<section>-<n>").
    const headingRe = /<(h[123]|p)(?=[\s>])([^>]*)>([^<]*)</gi;
    const tagCount: Record<string, number> = {};
    while ((match = headingRe.exec(chunk)) !== null) {
      const tag = match[1].toLowerCase();
      const attrs = match[2] || '';
      const text = (match[3] || '').trim();
      const occ = tagCount[tag] ?? 0;
      tagCount[tag] = occ + 1;
      if (!text) continue;
      if (/\sdata-s\s*=/.test(' ' + attrs)) continue; // already listed above

      const type: ItemType = tag.startsWith('h') ? 'heading' : 'text';
      items.push({
        selector: `[data-h2t="${tag}-${sceneIdx}-${occ}"]`,
        type,
        name: text.length > 30 ? text.substring(0, 30) + '...' : text,
        text
      });
    }
  });
  
  return items;
}

/** Decode HTML entities (&amp; &#39; &nbsp; ...) found in raw-source text. */
function decodeEntities(s?: string): string | undefined {
  if (!s) return s;
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    const l = e.toLowerCase();
    if (l[0] === '#') {
      const n = l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return named[l] ?? m;
  });
}

/**
 * Convert parsed HTML into a ProjectData object.
 * Called after the HTML is loaded and parsed.
 */
export function buildProjectFromParsed(
  parsed: ParsedHtml,
  htmlFilePath: string,
  htmlContent: string
): { project: ProjectData; report: ImportReport } {
  const scenes: ProjectScene[] = parsed.scenes.map((s, i) => ({
    id: `scene-${i + 1}`,
    name: s.name,
    start: s.start,
    end: s.end,
    orig: { start: s.start, end: s.end },
    transition: { type: 'fade', ms: 600 }
  }));
  
  const items: ProjectItem[] = [];
  let globalItemIdx = 0;
  
  parsed.items.forEach((item) => {
    // Find the scene for this item based on data-s
    // Items in section N belong to scene N
    const sectionMatch = item.selector.match(/(?:d|-)(\d+)(?:-\d+)?"\]$/);
    const sectionIdx = sectionMatch ? parseInt(sectionMatch[1], 10) : 0;
    const scene = scenes[sectionIdx] || scenes[0];
    
    items.push({
      id: `item-${++globalItemIdx}`,
      sceneId: scene.id,
      selector: item.selector,
      type: item.type,
      name: decodeEntities(item.name) || item.name,
      originalText: decodeEntities(item.text),
      locked: false,
      hidden: false,
      override: {
        s: item.dataS,
        d: item.dataD,
        y: item.dataY
      }
    });
  });
  
  const project: ProjectData = {
    version: 1,
    source: {
      file: htmlFilePath,
      duration: parsed.duration,
      stage: parsed.stage,
      htmlContent
    },
    scenes,
    items,
    audio: [],
    export: {
      width: 1920,
      height: 1080,
      fps: 30,
      codec: 'h264',
      crf: 18
    }
  };
  
  const report: ImportReport = {
    file: htmlFilePath,
    duration: parsed.duration,
    sceneCount: scenes.length,
    itemCount: items.length,
    warnings: parsed.warnings,
    errors: [],
    rawD: parsed.rawD,
    rawSC: parsed.rawSC
  };
  
  return { project, report };
}
