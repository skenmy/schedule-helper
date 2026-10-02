// Domain types shared by the server, the Svelte client and the overlay feed.

export type ScheduleSource = 'oengus' | 'horaro' | 'demo';

/** Identifies one schedule (and therefore one sync room). */
export interface RoomRef {
  source: ScheduleSource;
  event: string;
  slug: string;
}

/**
 * Stable identifier for a schedule line. Oengus lines use their upstream id;
 * Horaro/demo lines use a content-derived key. Keys (not indexes) are what
 * room state refers to, so re-importing a schedule with inserted or reordered
 * runs keeps check-ins, timings and the current run attached to the right run.
 */
export type RunKey = string;

export interface ScheduleLine {
  key: RunKey;
  game: string;
  category: string;
  console: string;
  /** Oengus run type: SINGLE, RACE, COOP, RELAY, … */
  type: string;
  runners: string[];
  estimateSec: number;
  /** Setup buffer that follows this line. */
  setupSec: number;
  /** Epoch ms, or null when upstream has no date for the line. */
  scheduledStart: number | null;
  /** Interlude / setup-only line (never "played"). */
  setupBlock: boolean;
  setupBlockText: string;
}

export interface Schedule {
  ref: RoomRef;
  eventName: string;
  scheduleName: string;
  /** Default Twitch channel advertised upstream. */
  twitch: string;
  lines: ScheduleLine[];
  fetchedAt: number;
}

export interface ScheduleSummary {
  slug: string;
  name: string;
}

export type CheckIn = 'ready' | 'missing';

/**
 * Everything we know about one run as it actually happened. The live timer is
 * derived from the current run's record: started + not ended = running.
 */
export interface RunRecord {
  startedAt?: number;
  endedAt?: number;
  skipped?: boolean;
  checkIn?: CheckIn;
}

export type LogKind = 'note' | 'tech' | 'runner' | 'system' | 'warning';

export interface LogEntry {
  id: number;
  at: number;
  kind: LogKind;
  text: string;
  runKey: RunKey | null;
  /** Display name of whoever caused the entry; null for automatic entries. */
  actor: string | null;
}

export interface Broadcast {
  text: string;
  color: string;
  by: string | null;
  at: number;
}

export interface DriftSettings {
  enabled: boolean;
  intervalMin: number;
  thresholdSec: number;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface CaptureResult {
  id: string;
  /** Server wallclock when the frame was grabbed. */
  at: number;
  auto: boolean;
  by: string | null;
  channel: string;
  error: string | null;
  elapsedSec: number | null;
  estimateSec: number | null;
  game: string | null;
  /** Schedule line the detected game resolved to, if any. */
  runKey: RunKey | null;
  confidence: Confidence | null;
  /** Our timer for the current run at `at`, when it had started. */
  ourElapsedSec: number | null;
  /** Stream timer minus ours (positive: the stream is ahead of us). */
  driftSec: number | null;
  /** Current run at capture time, to spot "stream shows a different game". */
  currentKey: RunKey | null;
}

/** What follows the stream to notice run changes on its own. Per room; not undoable. */
export interface TrackingSettings {
  /** Watch the Twitch channel's category and title. */
  twitch: boolean;
  /** Read stream frames (Claude) around expected run changes. */
  vision: boolean;
  /** Act without asking when two independent signals agree. Off: always ask. */
  autoApply: boolean;
}

/**
 * Where a signal came from. `nodecg` and `push` are reserved for sources that
 * talk to the stream PC (NodeCG speedcontrol, a timer bridge).
 */
export type SignalSource = 'twitch' | 'vision' | 'nodecg' | 'push';

export interface DetectionSignal {
  source: SignalSource;
  /** When the source saw it (server wallclock). */
  at: number;
  /** For the operator: "Twitch category → Spyro the Dragon", "stream timer 0:01:12". */
  detail: string;
  /** When the run started on stream, if this source can tell (a timer reading). */
  startedAt: number | null;
}

/**
 * The stream appears to have moved on: to a later run, or the current run's
 * timer has started on stream but not here. Accepting it is an ordinary,
 * undoable action; it never applies itself unless `tracking.autoApply` is on
 * and two independent signals agree.
 */
export interface Detection {
  id: string;
  runKey: RunKey;
  /** `advance`: a later run is on stream. `start`: the current run has started on stream. */
  kind: 'advance' | 'start';
  /** The live run when this was detected; if that changes, the detection is dropped. */
  currentKey: RunKey | null;
  /** Best estimate of the run's start on stream, from a timer reading. */
  startedAt: number | null;
  firstAt: number;
  signals: DetectionSignal[];
}

/** The last thing a stream-info source (Twitch) reported for the room's channel. */
export interface StreamInfo {
  live: boolean;
  game: string | null;
  title: string | null;
  at: number;
  /** Set when the source is unavailable (no credentials, API error). */
  error: string | null;
}

export interface UndoInfo {
  /** Identifies the entry, so an undo can't revert a different change. */
  id: number;
  summary: string;
  actor: string | null;
  at: number;
}

export interface RoomState {
  /** Monotonic revision, bumped on every change. */
  rev: number;
  currentKey: RunKey | null;
  /** Set when the last run is advanced past; the marathon is over. */
  finishedAt: number | null;
  runs: Record<RunKey, RunRecord>;
  /** Newest first. Doubles as the audit trail. */
  log: LogEntry[];
  /** Last log id handed out; ids never repeat. */
  logSeq: number;
  /** Message board shown on kiosk message panels. */
  message: Broadcast | null;
  /** Banner pinned to the top of every operator's screen. */
  announcement: Broadcast | null;
  twitchChannel: string;
  drift: DriftSettings;
  capture: CaptureResult | null;
  captureBusy: boolean;
  tracking: TrackingSettings;
  /** A run change the sources noticed, waiting for an operator (or auto-apply). */
  detection: Detection | null;
  stream: StreamInfo | null;
  /** The action `undo` would revert, if any. */
  undo: UndoInfo | null;
  updatedAt: number;
}

export interface AuthUser {
  login: string;
  display: string;
  avatar: string | null;
}

export interface AuthInfo {
  authenticated: boolean;
  canWrite: boolean;
  root: boolean;
  user: AuthUser | null;
  loginUrl: string | null;
  manageUrl: string | null;
}
