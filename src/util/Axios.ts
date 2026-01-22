import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'
import axiosRetry from 'axios-retry'
import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { URL } from 'url'
import type { AccountProxy } from '../interface/Account'

class AxiosClient {
    private instance: AxiosInstance
    private account: AccountProxy

    constructor(account: AccountProxy) {
        this.account = account

        this.instance = axios.create({
            timeout: 20000
        })
        // 如果提供了代理配置，设置代理
        if (this.account.url && this.account.proxyAxios) {
            const agent = this.getAgentForProxy(this.account)
            this.instance.defaults.httpAgent = agent
            this.instance.defaults.httpsAgent = agent
        }

        axiosRetry(this.instance, {
            retries: 5,
            retryDelay: axiosRetry.exponentialDelay,
            shouldResetTimeout: true,
            retryCondition: error => {
                if (axiosRetry.isNetworkError(error)) return true
                if (!error.response) return true

                const status = error.response.status
                return status === 429 || (status >= 500 && status <= 599)
            }
        })
    }

    private getAgentForProxy(
        proxyConfig: AccountProxy
    ): HttpProxyAgent<string> | HttpsProxyAgent<string> | SocksProxyAgent {
        const { url: baseUrl, port, username, password } = proxyConfig

        let urlObj: URL
        try {
            urlObj = new URL(baseUrl)
        } catch (e) {
            try {
                urlObj = new URL(`http://${baseUrl}`)
            } catch (error) {
                throw new Error(`Invalid proxy URL format: ${baseUrl}`)
            }
        }

        const protocol = urlObj.protocol.toLowerCase()
        let proxyUrl: string

        if (username && password) {
            urlObj.username = encodeURIComponent(username)
            urlObj.password = encodeURIComponent(password)
            urlObj.port = port.toString()
            proxyUrl = urlObj.toString()
        } else {
            proxyUrl = `${protocol}//${urlObj.hostname}:${port}`
        }

        switch (protocol) {
            case 'http:':
                return new HttpProxyAgent(proxyUrl)
            case 'https:':
                return new HttpsProxyAgent(proxyUrl)
            case 'socks4:':
            case 'socks5:':
                return new SocksProxyAgent(proxyUrl)
            default:
                throw new Error(`Unsupported proxy protocol: ${protocol}. Only HTTP(S) and SOCKS4/5 are supported!`)
        }
    }

    public async request(config: AxiosRequestConfig, bypassProxy = false): Promise<AxiosResponse> {
        if (bypassProxy) {
            const bypassInstance = axios.create()
            axiosRetry(bypassInstance, {
                retries: 3,
                retryDelay: axiosRetry.exponentialDelay
            })
            return bypassInstance.request(config)
        }

        let lastError: unknown
        const maxAttempts = 2
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await this.instance.request(config)
            } catch (err: unknown) {
                lastError = err
                const axiosErr = err as AxiosError | undefined

                // 检测HTTP代理身份验证失败（状态407）并重试无代理
                if (axiosErr && axiosErr.response && axiosErr.response.status === 407) {
                    if (attempt < maxAttempts) {
                        await this.sleep(1000 * attempt) // 指数退避
                    }
                    const bypassInstance = axios.create()
                    return bypassInstance.request(config)
                }

                // 如果代理请求因常见代理/网络错误而失败，使用退避重试
                const e = err as { code?: string; cause?: { code?: string }; message?: string } | undefined
                const code = e?.code || e?.cause?.code
                const isNetErr = code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ENOTFOUND'
                const msg = String(e?.message || '')
                const looksLikeProxyIssue = /proxy|tunnel|socks|agent/i.test(msg)
                
                if (isNetErr || looksLikeProxyIssue) {
                    if (attempt < maxAttempts) {
                        // 指数退避：1s，2s，4s等。
                        const delayMs = 1000 * Math.pow(2, attempt - 1)
                        await this.sleep(delayMs)
                        continue
                    }
                    // 最后尝试：尝试无代理
                    const bypassInstance = axios.create()
                    return bypassInstance.request(config)
                }
                
                // 不可重试错误
                throw err
            }
        }
        
        throw lastError
    }
    
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }
}

export default AxiosClient
