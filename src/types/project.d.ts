/**
 * Core type definitions for the h2video H2VID project model.
 * These types define the .h2v.json project file format.
 */

/** Supported transition types between scenes */
export type TransitionType = 'none' | 'fade' | 'slide' | 'wipe';

/** Supported easing functions */
export type EasingType = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'bounce';

/** Supported entrance directions for motion presets */
export type EntranceDirection = 'up' | 'down' | 'left' | 'right' | 'none';

/** Looping animation effects */
export type LoopEffect = 'none' | 'float' | 'sway' | 'spin';

/** Motion preset names */
export type MotionPreset = 'none' | 'fade-up' | 'zoom-in' | 'slide-in' | 'bounce-in';

/** Item types detected from the HTML */
export type ItemType = 'text' | 'heading' | 'graphic' | 'svg' | 'image' | 'container' | 'unknown';

/** Codec choices for export */
export type VideoCodec = 'h264' | 'h265';

/** Resolution presets */
export interface ResolutionPreset {
  label: string;
  width: number;
  height: number;
}

/** Stage dimensions */
export interface StageDimensions {
  w: number;
  h: number;
}

/** Transition settings for a scene */
export interface SceneTransition {
  type: TransitionType;
  ms: number;
}

/** Original timing values from the HTML (for time remapping) */
export interface OriginalTiming {
  start: number; // milliseconds
  end: number;   // milliseconds
}

/** A single scene in the project */
export interface ProjectScene {
  id: string;
  name: string;
  start: number;  // project time ms
  end: number;    // project time ms
  orig: OriginalTiming;
  transition: SceneTransition;
  background?: string; // CSS color override
  locked?: boolean;
  hidden?: boolean;
  /** Index of the <section> in the source page that this scene shows (set on duplicated scenes). */
  section?: number;
}

/** Style overrides for an item */
export interface ItemStyle {
  color?: string;
  backgroundColor?: string;
  fontSize?: number;
  fontWeight?: string | number;
  fontFamily?: string;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: 'left' | 'center' | 'right';
  textShadow?: string;
  webkitTextStroke?: string;
  opacity?: number;
  width?: number;
  height?: number;
  transform?: string;
  fill?: string;
  stroke?: string;
  [key: string]: unknown;
}

/** Parameters of one text effect (shadow / glow / stroke). Which keys are used depends on the effect (see engine/fxDefs.ts). */
export interface FxParams {
  on?: boolean;
  color?: string;
  color2?: string;
  color3?: string;
  opacity?: number;     // 0-1
  distance?: number;    // px
  angle?: number;       // degrees, 0 = right, 90 = down
  blur?: number;        // px
  spread?: number;      // px
  intensity?: number;   // 1-5
  thickness?: number;   // px
  offset?: number;      // px
  depth?: number;       // px (extrude / long shadow length)
  speed?: number;       // animated glow pulses per second
  [key: string]: unknown;
}

export interface GradientFx {
  on?: boolean;
  type?: 'linear' | 'radial';
  angle?: number;
  c1?: string;
  c2?: string;
  c3?: string;
  useC3?: boolean;
}

export interface BoxFx {
  bgOn?: boolean; bg?: string; bgOpacity?: number;
  padX?: number; padY?: number; radius?: number;
  borderOn?: boolean; borderW?: number; borderColor?: string; borderStyle?: string;
}

export interface MaskFx { on?: boolean; type?: string; soft?: number; }
export interface ThreeDFx { on?: boolean; rotX?: number; rotY?: number; persp?: number; }

/** Text animation (runs on top of the page's own entrance animation) */
export interface TextAnimFx {
  type?: string;        // see ANIMATIONS in engine/fxDefs.ts
  start?: number;       // s, relative to the scene start
  delay?: number;       // s
  duration?: number;    // s
  speed?: number;       // multiplier
  easing?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
  stagger?: number;     // s between letters / words
  intensity?: number;   // distance / amplitude multiplier
  loop?: 'none' | 'loop' | 'pingpong';
  loopGap?: number;     // s pause between loops
}

/** Advanced typography effects of an item */
export interface TextFx {
  gradient?: GradientFx;
  effects?: Record<string, FxParams>;   // shadow/glow/stroke effects by id
  box?: BoxFx;
  mask?: MaskFx;
  threeD?: ThreeDFx;
  anim?: TextAnimFx;
  wordSpacing?: number;
}

/** Override values for a single item */
export interface ItemOverride {
  s?: number;          // start delay seconds (relative to scene)
  d?: number;          // duration seconds
  y?: number;          // slide distance px
  text?: string;       // text content override (only set when the user edits the text)
  posX?: number;       // move right(+)/left(-), px on the stage
  posY?: number;       // move down(+)/up(-), px on the stage
  scale?: number;      // 1 = 100%
  rotate?: number;     // degrees
  style?: ItemStyle;   // CSS style overrides
  entrance?: EntranceDirection;
  exitDirection?: EntranceDirection;
  easing?: EasingType;
  motionPreset?: MotionPreset;
  loopEffect?: LoopEffect;
  fadeIn?: number;     // ms
  fadeOut?: number;    // ms
  fx?: TextFx;         // advanced typography effects
}

/** A single item (element) in the project */
export interface ProjectItem {
  id: string;
  sceneId: string;
  selector: string;  // CSS selector path for targeting the element
  type: ItemType;
  name: string;
  locked: boolean;
  hidden: boolean;
  groupId?: string;
  originalText?: string; // text as found in the HTML (decoded)
  override: ItemOverride;
  /** Set on copies: selector of the original element this item was cloned from. */
  cloneOf?: string;
}

/** Imported audio file available in the audio bin. */
export interface AudioAsset {
  id: string;
  file: string;
  name: string;
  duration?: number; // ms
}

/** Audio clip in the project */
export interface AudioClip {
  id: string;
  file: string;      // absolute path to audio file
  name: string;
  start: number;     // ms - when to start playing in the video timeline
  duration?: number; // ms - decoded source duration, used for timeline placement
  trackIndex?: number; // zero-based audio track assignment
  trimIn: number;    // ms - trim from start of audio file
  trimOut: number;   // ms - trim from end (0 = no trim)
  volume: number;    // 0-1
  fadeIn: number;    // ms
  fadeOut: number;   // ms
}

/** Export settings */
export interface ExportSettings {
  width: number;
  height: number;
  fps: 24 | 30 | 60;
  codec: VideoCodec;
  crf: number;       // 14-23
  outputFolder?: string;
  filename?: string;
  useJpeg?: boolean; // JPEG frames instead of PNG for speed
}

/** Source file information */
export interface ProjectSource {
  file: string;     // absolute path to the HTML file
  duration: number; // ms total duration
  stage: StageDimensions;
  htmlContent?: string; // cached HTML content
}

/** Import report shown to the user */
export interface ImportReport {
  file?: string;
  duration: number;
  sceneCount: number;
  itemCount: number;
  warnings: string[];
  errors: string[];
  rawD?: string;
  rawSC?: string;
}

/** The full project data structure (.h2v.json) */
export interface ProjectData {
  version: 1;
  source: ProjectSource;
  scenes: ProjectScene[];
  items: ProjectItem[];
  audio: AudioClip[];
  audioAssets?: AudioAsset[];
  export: ExportSettings;
}

/** UI selection state (not persisted) */
export interface SelectionState {
  selectedSceneId: string | null;
  selectedItemIds: string[];
  selectedAudioId: string | null;
  hoveredItemId: string | null;
}

/** Render job progress */
export interface RenderProgress {
  jobId: string;
  percent: number;
  framesDone: number;
  totalFrames: number;
  elapsedMs: number;
  etaMs: number;
  stage: 'capturing' | 'encoding' | 'done' | 'error';
  error?: string;
}

/** Render job configuration */
export interface RenderConfig {
  jobId: string;
  htmlFile: string;
  htmlContent: string;
  projectData: ProjectData;
  outputFile: string;
  width: number;
  height: number;
  fps: number;
  codec: VideoCodec;
  crf: number;
  useJpeg: boolean;
  audioFiles: AudioClip[];
  workerCount: number;
}
