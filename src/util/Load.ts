import type { Cookie } from 'patchright'
import type { BrowserFingerprintWithHeaders } from 'fingerprint-generator'
import fs from 'fs'
import path from 'path'

import type { Account, ConfigSaveFingerprint } from '../interface/Account'
import type { Config } from '../interface/Config'
import { validateAccounts, validateConfig } from './Validator'

let configCache: Config
let configSourcePath = ''


// 将旧版（平面）和新版（嵌套）配置模式标准化为平面Config接口
function normalizeConfig(raw: unknown): Config {
    // 在这里使用any是必要的，以支持旧版平面配置和新版嵌套配置结构
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = (raw || {}) as any

    // Browser / execution
    const headless = n.browser?.headless ?? n.headless ?? false
    const globalTimeout = n.browser?.globalTimeout ?? n.globalTimeout ?? '30s'
    const parallel = n.execution?.parallel ?? n.parallel ?? false
    const runOnZeroPoints = n.execution?.runOnZeroPoints ?? n.runOnZeroPoints ?? false
    const clusters = n.execution?.clusters ?? n.clusters ?? 1

    // Search
    const useLocalQueries = n.search?.useLocalQueries ?? n.searchOnBingLocalQueries ?? false
    const searchSettingsSrc = n.search?.settings ?? n.searchSettings ?? {}
    const delaySrc = searchSettingsSrc.delay ?? searchSettingsSrc.searchDelay ?? { min: '3min', max: '5min' }
    const searchSettings = {
        useGeoLocaleQueries: !!(searchSettingsSrc.useGeoLocaleQueries ?? false),
        scrollRandomResults: !!(searchSettingsSrc.scrollRandomResults ?? false),
        clickRandomResults: !!(searchSettingsSrc.clickRandomResults ?? false),
        useLocale: searchSettingsSrc.useLocale ?? 'cn',
        retryMobileSearchAmount: Number(searchSettingsSrc.retryMobileSearchAmount ?? 2),
        searchDelay: {
            min: delaySrc.min ?? '3min',
            max: delaySrc.max ?? '5min'
        },
        localFallbackCount: Number(searchSettingsSrc.localFallbackCount ?? 25),
        extraFallbackRetries: Number(searchSettingsSrc.extraFallbackRetries ?? 1)
    }

    // Workers
    const workers = n.workers ?? {
        doDailySet: true,
        doMorePromotions: true,
        doPunchCards: true,
        doDesktopSearch: true,
        doMobileSearch: true,
        doDailyCheckIn: true,
        doReadToEarn: true,
        bundleDailySetWithSearch: false
    }
    // 确保缺少的标志获得默认值
    if (typeof workers.bundleDailySetWithSearch !== 'boolean') workers.bundleDailySetWithSearch = false

    // Logging
    const logging = n.logging ?? {}
    const logExcludeFunc = Array.isArray(logging.excludeFunc) ? logging.excludeFunc : (n.logExcludeFunc ?? [])
    const webhookLogExcludeFunc = Array.isArray(logging.webhookExcludeFunc) ? logging.webhookExcludeFunc : (n.webhookLogExcludeFunc ?? [])

    // Notifications
    const notifications = n.notifications ?? {}
    const webhook = notifications.webhook ?? n.webhook ?? { enabled: false, url: '' }
    const conclusionWebhook = notifications.conclusionWebhook ?? n.conclusionWebhook ?? { enabled: false, url: '' }
    const ntfy = notifications.ntfy ?? n.ntfy ?? { enabled: false, url: '', topic: '', authToken: '' }


    // Fingerprinting
    const saveFingerprint = (n.fingerprinting?.saveFingerprint ?? n.saveFingerprint) ?? { mobile: false, desktop: false }

    // Humanization defaults (single on/off)
    if (!n.humanization) n.humanization = {}
    if (typeof n.humanization.enabled !== 'boolean') n.humanization.enabled = true
    if (typeof n.humanization.stopOnBan !== 'boolean') n.humanization.stopOnBan = false
    if (typeof n.humanization.immediateBanAlert !== 'boolean') n.humanization.immediateBanAlert = true
    if (typeof n.humanization.randomOffDaysPerWeek !== 'number') {
        n.humanization.randomOffDaysPerWeek = 1
    }
    // Strong default gestures when enabled (explicit values still win)
    if (typeof n.humanization.gestureMoveProb !== 'number') {
        n.humanization.gestureMoveProb = n.humanization.enabled === false ? 0 : 0.5
    }
    if (typeof n.humanization.gestureScrollProb !== 'number') {
        n.humanization.gestureScrollProb = n.humanization.enabled === false ? 0 : 0.25
    }

    // Vacation mode (monthly contiguous off-days)
    if (!n.vacation) n.vacation = {}
    if (typeof n.vacation.enabled !== 'boolean') n.vacation.enabled = false
    const vMin = Number(n.vacation.minDays)
    const vMax = Number(n.vacation.maxDays)
    n.vacation.minDays = isFinite(vMin) && vMin > 0 ? Math.floor(vMin) : 3
    n.vacation.maxDays = isFinite(vMax) && vMax > 0 ? Math.floor(vMax) : 5
    if (n.vacation.maxDays < n.vacation.minDays) {
        const t = n.vacation.minDays; n.vacation.minDays = n.vacation.maxDays; n.vacation.maxDays = t
    }

    const cfg: Config = {
        baseURL: n.baseURL ?? 'https://rewards.bing.com',
        sessionPath: n.sessionPath ?? 'sessions',
        headless,
        parallel,
        runOnZeroPoints,
        clusters,
        saveFingerprint,
        workers,
        searchOnBingLocalQueries: !!useLocalQueries,
        globalTimeout,
        searchSettings,
        humanization: n.humanization,
        retryPolicy: n.retryPolicy,
        jobState: n.jobState,
        logExcludeFunc,
        webhookLogExcludeFunc,
        logging, // retain full logging object for live webhook usage
        proxy: n.proxy ?? { proxyGoogleTrends: true, proxyBingTerms: true },
        webhook,
        conclusionWebhook,
        ntfy,
        vacation: n.vacation,
        crashRecovery: n.crashRecovery || {}
    }

    return cfg
}

export function loadAccounts(): Account[] {
    try {
        // 1) CLI dev override
        let file = 'accounts.json'
        if (process.argv.includes('-dev')) {
            file = 'accounts.dev.json'
        }

        const accountDir = path.join(__dirname, '../', file)
        const accounts = fs.readFileSync(accountDir, 'utf-8')
        const accountsData = JSON.parse(accounts)

        validateAccounts(accountsData)

        return accountsData
    } catch (error) {
        throw new Error(error as string)
    }
}

export function getConfigPath(): string { return configSourcePath }

export function loadConfig(): Config {
    try {
        if (configCache) {
            return configCache
        }

        // Resolve configuration file from common locations
        const names = ['config.json']
        const bases = [
            path.join(__dirname, '../'),       // 编译时的dist根目录
            path.join(__dirname, '../src'),    // 回退：运行dist但配置仍在src中
            process.cwd(),                     // repo根目录
            path.join(process.cwd(), 'src'),   // 运行ts-node时的repo/src
            __dirname                          // dist/util
        ]
        const candidates: string[] = []
        for (const base of bases) {
            for (const name of names) {
                candidates.push(path.join(base, name))
            }
        }
        let cfgPath: string | null = null
        for (const p of candidates) {
            try { if (fs.existsSync(p)) { cfgPath = p; break } } catch { /* ignore */ }
        }
        if (!cfgPath) throw new Error(`配置文件未找到: ${candidates.join(' | ')}`)
        const config = fs.readFileSync(cfgPath, 'utf-8')
        const json = config.replace(/^\uFEFF/, '')
        const raw = JSON.parse(json)
        const normalized = normalizeConfig(raw)
        configCache = normalized // Set as cache
        configSourcePath = cfgPath

        const configData = JSON.parse(config)
        validateConfig(configData)

        configCache = configData

        return configData
    } catch (error) {
        throw new Error(error as string)
    }
}

export async function loadSessionData(
    sessionPath: string,
    email: string,
    saveFingerprint: ConfigSaveFingerprint,
    isMobile: boolean
) {
    try {
        // 获取cookie文件
        const cookiesFileName = isMobile ? 'session_mobile.json' : 'session_desktop.json'
        const cookieFile = path.join(__dirname, '../browser/', sessionPath, email, cookiesFileName)

        let cookies: Cookie[] = []
        if (fs.existsSync(cookieFile)) {
            const cookiesData = await fs.promises.readFile(cookieFile, 'utf-8')
            cookies = JSON.parse(cookiesData)
        }

        const fingerprintFileName = isMobile ? 'session_fingerprint_mobile.json' : 'session_fingerprint_desktop.json'
        const fingerprintFile = path.join(__dirname, '../browser/', sessionPath, email, fingerprintFileName)

        let fingerprint!: BrowserFingerprintWithHeaders
        const shouldLoadFingerprint = isMobile ? saveFingerprint.mobile : saveFingerprint.desktop
        if (shouldLoadFingerprint && fs.existsSync(fingerprintFile)) {
            const fingerprintData = await fs.promises.readFile(fingerprintFile, 'utf-8')
            fingerprint = JSON.parse(fingerprintData)
        }

        return {
            cookies: cookies,
            fingerprint: fingerprint
        }
    } catch (error) {
        throw new Error(error as string)
    }
}

export async function saveSessionData(
    sessionPath: string,
    cookies: Cookie[],
    email: string,
    isMobile: boolean
): Promise<string> {
    try {
        const sessionDir = path.join(__dirname, '../browser/', sessionPath, email)
        const cookiesFileName = isMobile ? 'session_mobile.json' : 'session_desktop.json'

        if (!fs.existsSync(sessionDir)) {
            await fs.promises.mkdir(sessionDir, { recursive: true })
        }

        await fs.promises.writeFile(path.join(sessionDir, cookiesFileName), JSON.stringify(cookies))

        return sessionDir
    } catch (error) {
        throw new Error(error as string)
    }
}

export async function saveFingerprintData(
    sessionPath: string,
    email: string,
    isMobile: boolean,
    fingerpint: BrowserFingerprintWithHeaders
): Promise<string> {
    try {
        const sessionDir = path.join(__dirname, '../browser/', sessionPath, email)
        const fingerprintFileName = isMobile ? 'session_fingerprint_mobile.json' : 'session_fingerprint_desktop.json'

        if (!fs.existsSync(sessionDir)) {
            await fs.promises.mkdir(sessionDir, { recursive: true })
        }

        await fs.promises.writeFile(path.join(sessionDir, fingerprintFileName), JSON.stringify(fingerpint))

        return sessionDir
    } catch (error) {
        throw new Error(error as string)
    }
}
