export interface Config {
    baseURL: string
    sessionPath: string
    headless: boolean
    runOnZeroPoints: boolean
    clusters: number
    errorDiagnostics: boolean
    workers: ConfigWorkers
    searchOnBingLocalQueries: boolean
    globalTimeout: number | string
    searchSettings: ConfigSearchSettings
    debugLogs: boolean
    proxy: ConfigProxy
    consoleLogFilter: LogFilter
    webhook: ConfigWebhook
}

export type QueryEngine = 'google' | 'wikipedia' | 'reddit' | 'local'

export interface ConfigBrowser {
    headless?: boolean;
    globalTimeout?: number | string;
}

export interface ConfigFingerprinting {
    saveFingerprint?: ConfigSaveFingerprint;
}

export interface ConfigSearchSettings {
    scrollRandomResults: boolean
    clickRandomResults: boolean
    parallelSearching: boolean
    queryEngines: QueryEngine[]
    searchResultVisitTime: number | string
    searchDelay: ConfigDelay
    readDelay: ConfigDelay
}

export interface ConfigDelay {
    min: number | string
    max: number | string
}

export interface ConfigProxy {
    queryEngine: boolean
}

export interface ConfigVacation {
    enabled?: boolean; // default false
    minDays?: number; // default 3
    maxDays?: number; // default 5
}

export interface ConfigCrashRecovery {
    autoRestart?: boolean; // Restart the root process after fatal crash
    maxRestarts?: number; // Max restart attempts (default 2)
    backoffBaseMs?: number; // Base backoff before restart (default 2000)
    restartFailedWorker?: boolean; // (future) attempt to respawn crashed worker
    restartFailedWorkerAttempts?: number; // attempts per worker (default 1)
}

export interface ConfigWorkers {
    doDailySet: boolean
    doSpecialPromotions: boolean
    doMorePromotions: boolean
    doPunchCards: boolean
    doAppPromotions: boolean
    doDesktopSearch: boolean
    doMobileSearch: boolean
    doDailyCheckIn: boolean
    doReadToEarn: boolean
}

// Webhooks
export interface ConfigWebhook {
    discord?: WebhookDiscordConfig
    ntfy?: WebhookNtfyConfig
    webhookLogFilter: LogFilter
}

export interface LogFilter {
    enabled: boolean
    mode: 'whitelist' | 'blacklist'
    levels?: Array<'debug' | 'info' | 'warn' | 'error'>
    keywords?: string[]
    regexPatterns?: string[]
}

export interface WebhookDiscordConfig {
    enabled: boolean
    url: string
}

export interface WebhookNtfyConfig {
    enabled?: boolean
    url: string
    topic?: string
    token?: string
    title?: string
    tags?: string[]
    priority?: 1 | 2 | 3 | 4 | 5 // 5 highest (important)
}

// Anti-ban humanization
export interface ConfigHumanization {
    // Master toggle for Human Mode. When false, humanization is minimized.
    enabled?: boolean;
    // If true, stop processing remaining accounts after a ban is detected
    stopOnBan?: boolean;
    // If true, send an immediate webhook/NTFY alert when a ban is detected
    immediateBanAlert?: boolean;
    // Additional random waits between actions
    actionDelay?: { min: number | string; max: number | string };
    // Probability [0..1] to perform micro mouse moves per step
    gestureMoveProb?: number;
    // Probability [0..1] to perform tiny scrolls per step
    gestureScrollProb?: number;
    // Allowed execution windows (local time). Each item is "HH:mm-HH:mm".
    // If provided, runs outside these windows will be delayed until the next allowed window.
    allowedWindows?: string[];
    // Randomly skip N days per week to look more human (0-7). Default 1.
    randomOffDaysPerWeek?: number;
}

// Retry/backoff policy
export interface ConfigRetryPolicy {
    maxAttempts?: number; // default 3
    baseDelay?: number | string; // default 1000ms
    maxDelay?: number | string; // default 30s
    multiplier?: number; // default 2
    jitter?: number; // 0..1; default 0.2
}

// Job state persistence
export interface ConfigJobState {
    enabled?: boolean; // default true
    dir?: string; // base directory; defaults to <sessionPath>/job-state
}

// Live logging configuration
export interface ConfigLoggingLive {
    enabled?: boolean; // master switch for live webhook logs
    redactEmails?: boolean; // if true, redact emails in outbound logs
}

export interface ConfigLogging {
    excludeFunc?: string[];
    webhookExcludeFunc?: string[];
    live?: ConfigLoggingLive;
    liveWebhookUrl?: string; // legacy/dedicated live webhook override
    redactEmails?: boolean; // legacy top-level redaction flag
    // Optional nested live.url support (already handled dynamically in Logger)
    [key: string]: unknown; // forward compatibility
}

// CommunityHelp removed (privacy-first policy)

// NEW FEATURES: Risk Management, Query Diversity
export interface ConfigRiskManagement {
    enabled?: boolean; // master toggle for risk-aware throttling
    autoAdjustDelays?: boolean; // automatically increase delays when risk is high
    stopOnCritical?: boolean; // halt execution if risk reaches critical level
    banPrediction?: boolean; // enable ML-style ban prediction
    riskThreshold?: number; // 0-100, pause if risk exceeds this
}

export interface ConfigQueryDiversity {
    enabled?: boolean; // use multi-source query generation
    sources?: Array<'google-trends' | 'reddit' | 'news' | 'wikipedia' | 'local-fallback'>; // which sources to use
    maxQueriesPerSource?: number; // limit per source
    cacheMinutes?: number; // cache duration
}

