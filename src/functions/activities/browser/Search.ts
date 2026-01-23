import type { Page } from 'patchright'
import type { Counters, DashboardData } from '../../../interface/DashboardData'

import { QueryCore } from '../../QueryEngine'
import { Workers } from '../../Workers'

/**
 * 必应搜索类，负责执行必应搜索以获取积分
 * 该类继承自Workers，提供了搜索相关的核心功能
 */
export class Search extends Workers {
    /** 必应主页URL */
    private bingHome = 'https://bing.com'
    /** 当前搜索页面URL */
    private searchPageURL = ''
    /** 搜索计数器 */
    private searchCount = 0
    /** 首次滚动标志 */
    private firstScroll: boolean = true;

    public async doSearch(data: DashboardData, page: Page, isMobile: boolean): Promise<number> {
        const startBalance = Number(this.bot.userData.currentPoints ?? 0)

        this.bot.logger.info(isMobile, 'SEARCH-BING', `开始必应搜索 | currentPoints=${startBalance}`)

        let totalGainedPoints = 0

        try {
            let searchCounters: Counters = await this.bot.browser.func.getSearchPoints()
            const missingPoints = this.bot.browser.func.missingSearchPoints(searchCounters, isMobile)
            let missingPointsTotal = missingPoints.totalPoints

            this.bot.logger.debug(
                isMobile,
                'SEARCH-BING',
                `初始搜索计数器 | mobile=${missingPoints.mobilePoints} | desktop=${missingPoints.desktopPoints} | edge=${missingPoints.edgePoints}`
            )

            this.bot.logger.info(
                isMobile,
                'SEARCH-BING',
                `剩余搜索积分 | Edge=${missingPoints.edgePoints} | Desktop=${missingPoints.desktopPoints} | Mobile=${missingPoints.mobilePoints}`
            )

            const queryCore = new QueryCore(this.bot)
            const locale = (this.bot.userData.geoLocale ?? 'US').toUpperCase()
            const langCode = (this.bot.userData.langCode ?? 'en').toLowerCase()

            this.bot.logger.debug(
                isMobile,
                'SEARCH-BING',
                `通过QueryCore解析搜索查询 | locale=${locale} | lang=${langCode} | related=true`
            )

            // 根据地区选择查询方式，如果是CN地区则使用中国热搜
            let queries = await queryCore.queryManager({
                shuffle: true,
                related: true,
                langCode,
                geoLocale: locale,
                // sourceOrder: ['google', 'wikipedia', 'reddit', 'local']
                sourceOrder: ['china','local']
            })

            queries = [...new Set(queries.map(q => q.trim()).filter(Boolean))]

            this.bot.logger.info(isMobile, 'SEARCH-BING', `搜索查询池准备就绪 | count=${queries.length}`)

            // 跳转到bing
            const targetUrl = this.searchPageURL ? this.searchPageURL : this.bingHome
            this.bot.logger.debug(isMobile, 'SEARCH-BING', `导航到搜索页面 | url=${targetUrl}`)

            await page.goto(targetUrl)
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
            await this.bot.browser.utils.tryDismissAllMessages(page)

            let stagnantLoop = 0
            const stagnantLoopMax = 10

            for (let i = 0; i < queries.length; i++) {
                const query = queries[i] as string

                searchCounters = await this.bingSearch(page, query, isMobile)
                const newMissingPoints = this.bot.browser.func.missingSearchPoints(searchCounters, isMobile)
                const newMissingPointsTotal = newMissingPoints.totalPoints

                const rawGained = missingPointsTotal - newMissingPointsTotal
                const gainedPoints = Math.max(0, rawGained)

                if (gainedPoints === 0) {
                    stagnantLoop++
                    this.bot.logger.info(
                        isMobile,
                        'SEARCH-BING',
                        `未获得积分 ${stagnantLoop}/${stagnantLoopMax} | query="${query}" | remaining=${newMissingPointsTotal}`
                    )
                } else {
                    stagnantLoop = 0

                    const newBalance = Number(this.bot.userData.currentPoints ?? 0) + gainedPoints
                    this.bot.userData.currentPoints = newBalance
                    this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + gainedPoints

                    totalGainedPoints += gainedPoints

                    this.bot.logger.info(
                        isMobile,
                        'SEARCH-BING',
                        `获得积分=${gainedPoints} points | query="${query}" | remaining=${newMissingPointsTotal}`,
                        'green'
                    )
                }

                missingPointsTotal = newMissingPointsTotal

                if (missingPointsTotal === 0) {
                    this.bot.logger.info(
                        isMobile,
                        'SEARCH-BING',
                        '已获得所有必需的搜索积分，停止主搜索循环'
                    )
                    break
                }

                if (stagnantLoop > stagnantLoopMax) {
                    this.bot.logger.warn(
                        isMobile,
                        'SEARCH-BING',
                        `搜索在 ${stagnantLoopMax} 次迭代中未获得积分，中止主搜索循环`
                    )
                    stagnantLoop = 0
                    break
                }

                const remainingQueries = queries.length - (i + 1)
                const minBuffer = 20
                if (missingPointsTotal > 0 && remainingQueries < minBuffer) {
                    this.bot.logger.warn(
                        isMobile,
                        'SEARCH-BING',
                        `在仍有积分缺失的情况下查询缓冲区过低，重新生成 | remainingQueries=${remainingQueries} | missing=${missingPointsTotal}`
                    )

                    const extra = await queryCore.queryManager({
                        shuffle: true,
                        related: true,
                        langCode,
                        geoLocale: locale,
                        sourceOrder: this.bot.config.searchSettings.queryEngines
                    })

                    const merged = [...queries, ...extra].map(q => q.trim()).filter(Boolean)
                    queries = [...new Set(merged)]
                    queries = this.bot.utils.shuffleArray(queries)

                    this.bot.logger.debug(isMobile, 'SEARCH-BING', `查询池已重新生成 | count=${queries.length}`)
                }
            }

            if (missingPointsTotal > 0) {
                this.bot.logger.info(
                    isMobile,
                    'SEARCH-BING',
                    `搜索完成但仍有积分缺失，继续使用重新生成的查询 | remaining=${missingPointsTotal}`
                )

                let stagnantLoop = 0
                const stagnantLoopMax = 5

                while (missingPointsTotal > 0) {
                    const extra = await queryCore.queryManager({
                        shuffle: true,
                        related: true,
                        langCode,
                        geoLocale: locale,
                        sourceOrder: this.bot.config.searchSettings.queryEngines
                    })

                    const merged = [...queries, ...extra].map(q => q.trim()).filter(Boolean)
                    const newPool = [...new Set(merged)]
                    queries = this.bot.utils.shuffleArray(newPool)

                    this.bot.logger.info(
                        isMobile,
                        'SEARCH-BING-EXTRA',
                        `新搜索查询池已生成 | count=${queries.length}`
                    )

                    for (const query of queries) {
                        this.bot.logger.info(
                            isMobile,
                            'SEARCH-BING-EXTRA',
                            `额外搜索 | remaining=${missingPointsTotal} | query="${query}"`
                        )

                        searchCounters = await this.bingSearch(page, query, isMobile)
                        const newMissingPoints = this.bot.browser.func.missingSearchPoints(searchCounters, isMobile)
                        const newMissingPointsTotal = newMissingPoints.totalPoints

                        const rawGained = missingPointsTotal - newMissingPointsTotal
                        const gainedPoints = Math.max(0, rawGained)

                        if (gainedPoints === 0) {
                            stagnantLoop++
                            this.bot.logger.info(
                                isMobile,
                                'SEARCH-BING-EXTRA',
                                `未获得积分 ${stagnantLoop}/${stagnantLoopMax} | query="${query}" | remaining=${newMissingPointsTotal}`
                            )
                        } else {
                            stagnantLoop = 0

                            const newBalance = Number(this.bot.userData.currentPoints ?? 0) + gainedPoints
                            this.bot.userData.currentPoints = newBalance
                            this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + gainedPoints

                            totalGainedPoints += gainedPoints

                            this.bot.logger.info(
                                isMobile,
                                'SEARCH-BING-EXTRA',
                                `获得积分=${gainedPoints} points | query="${query}" | remaining=${newMissingPointsTotal}`,
                                'green'
                            )
                        }

                        missingPointsTotal = newMissingPointsTotal

                        if (missingPointsTotal === 0) {
                            this.bot.logger.info(
                                isMobile,
                                'SEARCH-BING-EXTRA',
                                '在额外搜索期间已获得所有必需的搜索积分'
                            )
                            break
                        }

                        if (stagnantLoop > stagnantLoopMax) {
                            this.bot.logger.warn(
                                isMobile,
                                'SEARCH-BING-EXTRA',
                                `搜索在 ${stagnantLoopMax} 次迭代中未获得积分，中止额外搜索`
                            )
                            const finalBalance = Number(this.bot.userData.currentPoints ?? startBalance)
                            this.bot.logger.info(
                                isMobile,
                                'SEARCH-BING',
                                `中止额外搜索 | startBalance=${startBalance} | finalBalance=${finalBalance}`
                            )
                            return totalGainedPoints
                        }
                    }
                }
            }

            const finalBalance = Number(this.bot.userData.currentPoints ?? startBalance)

            this.bot.logger.info(
                isMobile,
                'SEARCH-BING',
                `完成必应搜索 | startBalance=${startBalance} | newBalance=${finalBalance}`
            )

            return totalGainedPoints
        } catch (error) {
            this.bot.logger.error(
                isMobile,
                'SEARCH-BING',
                `doSearch中出现错误 | message=${error instanceof Error ? error.message : String(error)}`
            )
            return totalGainedPoints
        }
    }

    private async bingSearch(searchPage: Page, query: string, isMobile: boolean) {
        const maxAttempts = 5
        const refreshThreshold = 10 // 页面在x次搜索后变得缓慢？

        this.searchCount++

        if (this.searchCount % refreshThreshold === 0) {
            this.bot.logger.info(
                isMobile,
                'SEARCH-BING',
                `返回主页以清除累积的页面上下文 | count=${this.searchCount} | threshold=${refreshThreshold}`
            )

            this.bot.logger.debug(isMobile, 'SEARCH-BING', `返回主页以刷新状态 | url=${this.bingHome}`)

            await searchPage.goto(this.bingHome)
            await searchPage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
            await this.bot.browser.utils.tryDismissAllMessages(searchPage)
        }

        // 每次搜索重置首次滚动标志，确保有初始向下滚动
        this.firstScroll = true;

        this.bot.logger.debug(
            isMobile,
            'SEARCH-BING',
            `开始bingSearch | query="${query}" | maxAttempts=${maxAttempts} | searchCount=${this.searchCount} | refreshEvery=${refreshThreshold} | scrollRandomResults=${this.bot.config.searchSettings.scrollRandomResults} | clickRandomResults=${this.bot.config.searchSettings.clickRandomResults}`
        )

        for (let i = 0; i < maxAttempts; i++) {
            try {
                const searchBar = '#sb_form_q'
                const searchBox = searchPage.locator(searchBar)

                await searchPage.evaluate(() => {
                    window.scrollTo({ left: 0, top: 0, behavior: 'auto' })
                })

                await searchPage.keyboard.press('Home')
                await searchBox.waitFor({ state: 'visible', timeout: 15000 })

                await this.bot.utils.wait(1000)
                await this.bot.browser.utils.ghostClick(searchPage, searchBar, { clickCount: 3 })
                await searchBox.fill('')

                await searchPage.keyboard.type(query, { delay: 50 })
                await searchPage.keyboard.press('Enter')

                this.bot.logger.debug(
                    isMobile,
                    'SEARCH-BING',
                    `提交查询到必应 | attempt=${i + 1}/${maxAttempts} | query="${query}"`
                )

                await this.bot.utils.wait(3000)

                if (this.bot.config.searchSettings.scrollRandomResults) {
                    await this.bot.utils.wait(2000)
                    await this.randomScroll(searchPage, isMobile)
                }

                if (this.bot.config.searchSettings.clickRandomResults) {
                    await this.bot.utils.wait(2000)
                    await this.clickRandomLink(searchPage, isMobile)
                }

                await this.bot.utils.wait(
                    this.bot.utils.randomDelay(
                        this.bot.config.searchSettings.searchDelay.min,
                        this.bot.config.searchSettings.searchDelay.max
                    )
                )

                const counters = await this.bot.browser.func.getSearchPoints()

                this.bot.logger.debug(
                    isMobile,
                    'SEARCH-BING',
                    `查询后的搜索计数器 | attempt=${i + 1}/${maxAttempts} | query="${query}"`
                )

                return counters
            } catch (error) {
                if (i >= 5) {
                    this.bot.logger.error(
                        isMobile,
                        'SEARCH-BING',
                        `5次重试后失败 | query="${query}" | message=${error instanceof Error ? error.message : String(error)}`
                    )
                    break
                }

                this.bot.logger.error(
                    isMobile,
                    'SEARCH-BING',
                    `搜索尝试失败 | attempt=${i + 1}/${maxAttempts} | query="${query}" | message=${error instanceof Error ? error.message : String(error)}`
                )

                this.bot.logger.warn(
                    isMobile,
                    'SEARCH-BING',
                    `重试搜索 | attempt=${i + 1}/${maxAttempts} | query="${query}"`
                )

                await this.bot.utils.wait(2000)
            }
        }

        this.bot.logger.debug(
            isMobile,
            'SEARCH-BING',
            `在重试失败后返回当前搜索计数器 | query="${query}"`
        )

        return await this.bot.browser.func.getSearchPoints()
    }

    private async randomScroll(page: Page, isMobile: boolean) {
        // 使用人性化滚动代替简单的随机滚动
        await this.humanLikeScroll(page, isMobile);
    }

    /**
     * 模拟人类滚动行为，包含加速、减速和随机停顿
     * @param page - 当前页面的Page对象
     * @param isMobile - 是否为移动设备
     */
    private async humanLikeScroll(page: Page, isMobile: boolean) {
        // 获取当前滚动位置和页面高度
        const currentY = await page.evaluate(() => window.scrollY)
        const maxScroll = await page.evaluate(() => document.body.scrollHeight) - await page.evaluate(() => window.innerHeight);

        // 根据设备类型设置滚动参数
        let scrollParams;
        if (isMobile) {
            // 移动设备参数：模拟触摸滑动
            scrollParams = {
                minOffset: 200,
                maxOffset: 500,
                minDuration: 2000,
                maxDuration: 4000,
                minPause: 1000,
                maxPause: 3000,
                segments: 1 // 单次滚动
            };
        } else {
            // 电脑设备参数：模拟鼠标滚轮分段滚动
            scrollParams = {
                minOffset: 50,
                maxOffset: 150,
                minDuration: 500,
                maxDuration: 1500,
                minPause: 500,
                maxPause: 1000,
                segments: this.bot.utils.randomNumber(2, 4) // 2-4段滚动
            };
        }

        // 计算滚动偏移量，第一次必定向下滚动
        let offset;
        if (this.firstScroll) {
            // 第一次向下滚动
            offset = this.bot.utils.randomNumber(scrollParams.minOffset, scrollParams.maxOffset);
            this.firstScroll = false;
        } else {
            // 随机上下滚动
            if (Math.random() < 0.7) { // 70%概率生成绝对值较大的数
                if (Math.random() < 0.5) {
                    offset = this.bot.utils.randomNumber(-scrollParams.maxOffset, -scrollParams.minOffset);
                } else {
                    offset = this.bot.utils.randomNumber(scrollParams.minOffset, scrollParams.maxOffset);
                }
            } else { // 30%概率生成中间区间的数
                offset = this.bot.utils.randomNumber(-scrollParams.minOffset, scrollParams.minOffset);
            }
        }

        // 计算目标位置，确保在有效范围内
        // 根据设备类型执行不同的滚动策略
        if (!isMobile && scrollParams.segments > 1) {
            let remainingOffset = offset;
            let currentPosition = currentY;

            for (let i = 0; i < scrollParams.segments; i++) {
                // 计算每段的偏移量，最后一段处理剩余部分
                const segmentOffset = i < scrollParams.segments - 1
                    ? Math.floor(remainingOffset / (scrollParams.segments - i))
                    : remainingOffset;

                const targetPosition = Math.max(0, Math.min(currentPosition + segmentOffset, maxScroll));
                const duration = this.bot.utils.randomNumber(scrollParams.minDuration, scrollParams.maxDuration);
                const startTime = Date.now();

                await page.evaluate(({ currentPosition, targetPosition, duration, startTime }) => {
                    return new Promise(resolve => {
                        const animateScroll = () => {
                            const elapsed = Date.now() - startTime;
                            const progress = Math.min(elapsed / duration, 1);
                            // 使用缓动函数模拟自然加速减速效果
                            const easeProgress = 0.5 - 0.5 * Math.cos(progress * Math.PI);
                            const position = currentPosition + easeProgress * (targetPosition - currentPosition);

                            window.scrollTo(0, position);

                            if (progress < 1) {
                                requestAnimationFrame(animateScroll);
                            } else {
                                resolve(null);
                            }
                        };

                        animateScroll();
                    });
                }, { currentPosition, targetPosition, duration, startTime });

                // 更新当前位置和剩余偏移量
                currentPosition = targetPosition;
                remainingOffset -= segmentOffset;

                // 段间停顿（最后一段后不停顿）
                if (i < scrollParams.segments - 1) {
                    await this.bot.utils.waitRandom(scrollParams.minPause, scrollParams.maxPause);
                }
            }
        } else {
            // 单次滚动（移动设备或电脑单段滚动）
            const targetPosition = Math.max(0, Math.min(currentY + offset, maxScroll));
            const duration = this.bot.utils.randomNumber(scrollParams.minDuration, scrollParams.maxDuration);
            const startTime = Date.now();

            await page.evaluate(({ currentY, targetPosition, duration, startTime }) => {
                return new Promise(resolve => {
                    const animateScroll = () => {
                        const elapsed = Date.now() - startTime;
                        const progress = Math.min(elapsed / duration, 1);
                        // 使用缓动函数模拟自然加速减速效果
                        const easeProgress = 0.5 - 0.5 * Math.cos(progress * Math.PI);
                        const position = currentY + easeProgress * (targetPosition - currentY);

                        window.scrollTo(0, position);

                        if (progress < 1) {
                            requestAnimationFrame(animateScroll);
                        } else {
                            resolve(null);
                        }
                    };

                    animateScroll();
                });
            }, { currentY, targetPosition, duration, startTime });
        }

        // 最终停顿
        await this.bot.utils.waitRandom(scrollParams.minPause, scrollParams.maxPause);
    }

    private async clickRandomLink(page: Page, isMobile: boolean) {
        try {
            this.bot.logger.debug(isMobile, 'SEARCH-RANDOM-CLICK', '尝试点击随机搜索结果链接')

            // 获取搜索结果中的标题链接
            const resultLinks = await page.locator('#b_results .b_algo h2').all();
            // 筛选可见的链接
            const visibleLinks = [];
            for (const link of resultLinks) {
                if (await link.isVisible()) {
                    visibleLinks.push(link);
                }
            }

            if (visibleLinks.length <= 0) {
                this.bot.logger.debug(isMobile, 'SEARCH-BING', `没有可见的链接`);
                return;
            }

            const randomLink = visibleLinks[this.bot.utils.randomNumber(0, visibleLinks.length - 1)];

            // 模拟人类行为：悬停后点击，增加不确定性
            if (randomLink) await randomLink.hover();
            await this.bot.utils.waitRandom(1000, 2000);

            // 取消悬停
            if (randomLink) await page.mouse.move(0, 0);

            // 30%几率只悬停不点击
            const clickProbability = this.bot.utils.randomNumber(1, 100);
            if (clickProbability <= 30) {
                this.bot.logger.debug(isMobile, 'SEARCH-BING', `执行只悬停操作并返回 (概率: ${clickProbability}%)`);
                return;
            }

            if (randomLink) {
                await randomLink.click({ timeout: 2000 }).catch(() => { });
            }

            // 停留一段时间让页面加载并完成"访问"
            await this.bot.utils.waitRandom(20000, 30000)

            if (isMobile) {
                // 移动端：返回搜索页面
                await page.goto(this.searchPageURL || this.bingHome)
                this.bot.logger.debug(isMobile, 'SEARCH-RANDOM-CLICK', '返回搜索页面')
            } else {
                // 桌面端：处理新标签页
                const newTab = await this.bot.browser.utils.getLatestTab(page)
                const newTabUrl = newTab.url()

                this.bot.logger.debug(isMobile, 'SEARCH-RANDOM-CLICK', `访问结果标签页 | url=${newTabUrl}`)

                await this.bot.browser.utils.closeTabs(newTab)
                this.bot.logger.debug(isMobile, 'SEARCH-RANDOM-CLICK', '关闭结果标签页')
            }
        } catch (error) {
            this.bot.logger.error(
                isMobile,
                'SEARCH-RANDOM-CLICK',
                `随机点击期间发生错误 | message=${error instanceof Error ? error.message : String(error)}`
            )
        }
    }
}
