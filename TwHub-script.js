// ==UserScript==
// @name         TwHub Video ArtPlayer 增强
// @namespace    https://hajimix.local/
// @icon         data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='80'>▶</text></svg>
// @version      1.1.0
// @description  为 TwHub 视频聚合站注入 ArtPlayer 播放器，支持内嵌播放与浮动窗口，自动适配视频分辨率
// @author       哈基米
// @match        https://truvaze.com/*
// @match        https://twitter-ero-video-ranking.com/*
// @match        https://x-ero-anime.com/*
// @match        https://twivideo.net/*
// @match        https://twiigle.com/*
// @match        https://twihub.net/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const CFG = {
        DEBUG: true,
        ARTPLAYER_JS_URL: 'https://cdn.jsdelivr.net/npm/artplayer@5/dist/artplayer.js',
        TWIVIDEO_WIDTH_LANDSCAPE: 560,
        TWIVIDEO_WIDTH_PORTRAIT: 340,
    };

    const isTwivideo = location.hostname.includes('twivideo.net') || (location.hostname.includes('twiigle.com') && !location.pathname.includes('contents.html'));

    function log(...args) {
        if (CFG.DEBUG && typeof console !== 'undefined') {
            console.log(isTwivideo ? '[TWIVIDEO-PLAY]' : '[TRUVAZE-AUTO]', ...args);
        }
    }

    // ── 通用: 设置全局 Referrer ──────────────────────────────────

    function disableGlobalReferrer() {
        let meta = document.querySelector('meta[name="referrer"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'referrer';
            document.head.appendChild(meta);
        }
        meta.content = 'no-referrer';
        log('已设置全局 meta referrer 为 no-referrer');
    }

    // ── 通用: 加载外部脚本 ────────────────────────────────────────

    function loadScriptOnce(src) {
        return new Promise((resolve, reject) => {
            const exists = document.querySelector(`script[data-vx-src="${src}"]`);
            if (exists && exists.dataset.loaded === '1') {
                resolve();
                return;
            }
            if (exists) {
                exists.addEventListener('load', () => resolve(), { once: true });
                exists.addEventListener('error', () => reject(new Error(`load script failed: ${src}`)), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.dataset.vxSrc = src;
            script.addEventListener('load', () => {
                script.dataset.loaded = '1';
                resolve();
            }, { once: true });
            script.addEventListener('error', () => reject(new Error(`load script failed: ${src}`)), { once: true });
            document.head?.appendChild(script);
        });
    }

    // ── 通用: 解析视频分辨率 ──────────────────────────────────────

    function getVideoDimensions(url) {
        const match = url.match(/\/(\d+)[xX](\d+)\//);
        if (match) {
            const w = parseInt(match[1], 10);
            const h = parseInt(match[2], 10);
            return {
                width: w,
                height: h,
                ratio: w / h,
                isPortrait: h > w
            };
        }
        return { width: 1280, height: 720, ratio: 16 / 9, isPortrait: false };
    }


    // =========================================================================
    // Twivideo 逻辑
    // =========================================================================
    const twState = {
        artInstance: null,
        panelEl: null,
        currentVideoUrl: null,
    };

    function injectTwivideoStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* 播放按钮 */
            .twvp-play-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                height: 24px;
                padding: 0 8px;
                border-radius: 4px;
                background: linear-gradient(135deg, #ff4d6d, #c9184a);
                color: #fff;
                font-size: 12px;
                cursor: pointer;
                transition: transform 0.15s ease, background 0.15s ease;
                border: none;
                z-index: 10;
                position: absolute;
                bottom: 8px;
                right: 60px;
            }
            .twvp-play-btn:hover {
                transform: scale(1.05);
                color: #fff;
                background: linear-gradient(135deg, #ff758f, #ff4d6d);
            }
            .twvp-play-btn i {
                margin-right: 4px;
                font-size: 10px;
            }

            /* 浮动播放器面板 */
            .twvp-floating-panel {
                position: fixed;
                bottom: 24px;
                right: 24px;
                z-index: 99999;
                /* width/height 将被 JS 动态分配 */
                background: #111;
                border-radius: 12px;
                box-shadow: 0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08);
                overflow: hidden;
                animation: twvp-slide-in 0.3s ease-out;
                resize: both;
                display: flex;
                flex-direction: column;
            }
            @keyframes twvp-slide-in {
                from { transform: translateY(30px) scale(0.95); opacity: 0; }
                to   { transform: translateY(0) scale(1); opacity: 1; }
            }

            /* 面板头部 */
            .twvp-panel-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 12px;
                background: linear-gradient(135deg, #1a1a2e, #16213e);
                color: #eee;
                font-size: 13px;
                font-family: system-ui, -apple-system, sans-serif;
                cursor: move;
                user-select: none;
                flex-shrink: 0;
            }
            .twvp-panel-title {
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                flex: 1;
                margin-right: 8px;
            }
            .twvp-panel-close {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 24px;
                height: 24px;
                border-radius: 50%;
                background: rgba(255,255,255,0.1);
                color: #ccc;
                font-size: 14px;
                cursor: pointer;
                transition: background 0.2s;
                border: none;
                flex-shrink: 0;
            }
            .twvp-panel-close:hover {
                background: rgba(255,77,109,0.6);
                color: #fff;
            }

            /* 播放器容器 */
            .twvp-player-container {
                width: 100%;
                flex: 1;
                min-height: 100px;
                background: #000;
            }

            .item_inner {
                position: relative !important;
            }
        `;
        document.head.appendChild(style);
    }

    function addTwivideoPlayButtons(root = document) {
        const items = root.querySelectorAll('.item_inner');
        for (const item of items) {
            if (item.querySelector('.twvp-play-btn')) {
                continue;
            }

            const link = item.querySelector('a.item_link');
            if (!link) {
                continue;
            }

            let videoUrl = link.getAttribute('href');
            if (!videoUrl || !videoUrl.includes('video.twimg.com')) {
                continue;
            }

            if (location.hostname.includes('twiigle.com')) {
                const match = videoUrl.match(/contents=([^&]+)/);
                if (match) {
                    videoUrl = decodeURIComponent(match[1]);
                } else {
                    continue;
                }
            }

            const posterImg = link.querySelector('img');
            const posterUrl = posterImg ? posterImg.getAttribute('src') : '';

            const btn = document.createElement('div');
            btn.className = 'twvp-play-btn';
            btn.dataset.videoUrl = videoUrl;
            btn.dataset.posterUrl = posterUrl;
            btn.innerHTML = '<i class="fas fa-play"></i>播放';
            btn.title = '播放视频';

            if (location.hostname.includes('twiigle.com')) {
                btn.style.right = '5px';
                btn.style.bottom = '5px';
            }

            const likeCount = item.querySelector('.like_count');
            if (likeCount) {
                likeCount.before(btn);
            } else {
                item.appendChild(btn);
            }
        }
    }

    function observeTwivideoDynamicContent() {
        const grids = document.querySelector('.grids');
        if (!grids) return;
        const observer = new MutationObserver((mutations) => {
            let shouldUpdate = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) shouldUpdate = true;
            }
            if (shouldUpdate) {
                addTwivideoPlayButtons(grids);
            }
        });
        observer.observe(grids, { childList: true, subtree: true });
    }

    function destroyTwivideoPlayer() {
        if (twState.artInstance) {
            try { twState.artInstance.destroy(false); } catch (_) { }
            twState.artInstance = null;
        }
        twState.currentVideoUrl = null;
    }

    function closeTwivideoPanel() {
        destroyTwivideoPlayer();
        if (twState.panelEl) {
            twState.panelEl.remove();
            twState.panelEl = null;
        }
    }

    function createTwivideoPanel() {
        if (twState.panelEl) {
            destroyTwivideoPlayer();
            const container = twState.panelEl.querySelector('.twvp-player-container');
            if (container) container.innerHTML = '';
            return twState.panelEl;
        }

        const panel = document.createElement('div');
        panel.className = 'twvp-floating-panel';
        panel.innerHTML = `
            <div class="twvp-panel-header">
                <span class="twvp-panel-title">▶ 视频播放器</span>
                <button class="twvp-panel-close" title="关闭">✕</button>
            </div>
            <div class="twvp-player-container"></div>
        `;

        panel.querySelector('.twvp-panel-close').addEventListener('click', (e) => {
            e.stopPropagation();
            closeTwivideoPanel();
        });

        const handle = panel.querySelector('.twvp-panel-header');
        let isDragging = false;
        let startX, startY, origX, origY;
        handle.addEventListener('mousedown', (e) => {
            if (e.target.closest('.twvp-panel-close')) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            origX = rect.left;
            origY = rect.top;

            panel.style.bottom = 'auto';
            panel.style.right = 'auto';
            panel.style.left = origX + 'px';
            panel.style.top = origY + 'px';
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            panel.style.left = (origX + (e.clientX - startX)) + 'px';
            panel.style.top = (origY + (e.clientY - startY)) + 'px';
        });
        document.addEventListener('mouseup', () => { isDragging = false; });

        document.body.appendChild(panel);
        twState.panelEl = panel;
        return panel;
    }

    async function playTwivideoVideo(videoUrl, posterUrl) {
        if (twState.currentVideoUrl === videoUrl && twState.artInstance) return;
        log('播放:', videoUrl);

        const panel = createTwivideoPanel();
        const container = panel.querySelector('.twvp-player-container');
        twState.currentVideoUrl = videoUrl;

        // --- 动态适配分辨率开始 ---
        const dim = getVideoDimensions(videoUrl);
        const panelWidth = dim.isPortrait ? CFG.TWIVIDEO_WIDTH_PORTRAIT : CFG.TWIVIDEO_WIDTH_LANDSCAPE;
        const playerHeight = panelWidth / dim.ratio;
        const panelHeight = Math.round(playerHeight + 40);

        panel.style.width = `${panelWidth}px`;
        panel.style.height = `${panelHeight}px`;
        log(`设置浮窗大小: 宽 ${panelWidth}px, 高 ${panelHeight}px (是否竖屏: ${dim.isPortrait})`);
        // --- 动态适配分辨率结束 ---

        const title = panel.querySelector('.twvp-panel-title');
        title.textContent = `▶ ${videoUrl.split('/').pop().split('?')[0]}`;

        try {
            if (!window.Artplayer) await loadScriptOnce(CFG.ARTPLAYER_JS_URL);
            if (!window.Artplayer) return;

            const art = new window.Artplayer({
                container,
                url: videoUrl,
                poster: posterUrl || '',
                volume: 0.8,
                autoplay: true,
                pip: true,
                autoSize: true,
                autoMini: true,
                setting: true,
                playbackRate: true,
                aspectRatio: true,
                fullscreen: true,
                fullscreenWeb: true,
                miniProgressBar: true,
                mutex: true,
                backdrop: true,
                theme: '#ff4d6d',
                type: 'mp4NoRef',
                customType: {
                    mp4NoRef: function (video, url) {
                        video.crossOrigin = null;
                        video.removeAttribute('crossorigin');
                        video.setAttribute('referrerpolicy', 'no-referrer');
                        video.src = url;
                    },
                },
            });
            twState.artInstance = art;
        } catch (error) {
            log('播放失败', error);
        }
    }

    function bootTwivideo() {
        disableGlobalReferrer();
        injectTwivideoStyles();
        addTwivideoPlayButtons();
        observeTwivideoDynamicContent();

        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.twvp-play-btn');
            if (btn) {
                e.preventDefault();
                e.stopPropagation();
                if (btn.dataset.videoUrl) playTwivideoVideo(btn.dataset.videoUrl, btn.dataset.posterUrl);
            }
        }, true);
    }


    // =========================================================================
    // Truvaze 逻辑
    // =========================================================================
    const truvazeState = {
        videoUrl: null,
        posterUrl: null,
        playerMounted: false,
        artInstance: null,
    };

    function extractTruvazeVideoInfo() {
        if (location.hostname.includes('twihub.net')) {
            const videoLink = document.getElementById('video-link');
            const thumbnail = document.getElementById('thumbnail');
            if (videoLink && videoLink.href && videoLink.href.includes('video.twimg.com')) {
                return {
                    videoUrl: videoLink.href,
                    posterUrl: thumbnail ? thumbnail.src : null,
                    title: document.querySelector('.mt-4 p.text-gray-200')?.innerText || 'TwiHub Video'
                };
            }
            return null;
        }

        if (location.hostname.includes('twiigle.com')) {
            const link = document.querySelector('a[href*="video.twimg.com"]');
            const hashMatch = location.hash.match(/contents=([^&]+)/);
            const foundUrl = (link && link.href) || (hashMatch ? decodeURIComponent(hashMatch[1]) : null);

            if (foundUrl && foundUrl.includes('video.twimg.com')) {
                return {
                    videoUrl: foundUrl,
                    posterUrl: null,
                    title: 'Twiigle Video'
                };
            }
            return null;
        }

        const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of ldScripts) {
            try {
                const data = JSON.parse(script.textContent);
                if (data['@type'] === 'VideoObject' && data.contentUrl) {
                    return {
                        videoUrl: data.contentUrl,
                        posterUrl: data.thumbnailUrl || null,
                        title: data.name || '',
                    };
                }
            } catch (e) { }
        }
        return null;
    }

    async function initTruvazeArtPlayer(container, videoUrl, posterUrl) {
        try {
            if (!window.Artplayer) await loadScriptOnce(CFG.ARTPLAYER_JS_URL);
            if (!window.Artplayer) return null;

            const art = new window.Artplayer({
                container,
                url: videoUrl,
                poster: posterUrl || '',
                volume: 0.8,
                autoplay: true,
                pip: true,
                autoSize: true,
                autoMini: true,
                setting: true,
                playbackRate: true,
                aspectRatio: true,
                fullscreen: true,
                fullscreenWeb: true,
                miniProgressBar: true,
                mutex: true,
                backdrop: true,
                theme: '#f81775',
                type: 'mp4NoRef',
                customType: {
                    mp4NoRef: function (video, url) {
                        video.crossOrigin = null;
                        video.removeAttribute('crossorigin');
                        video.setAttribute('referrerpolicy', 'no-referrer');
                        video.src = url;
                    },
                },
            });
            truvazeState.artInstance = art;
            return art;
        } catch (error) {
            log('Truvaze ArtPlayer 初始化失败:', error);
            return null;
        }
    }

    function mountTruvazeInlinePlayer(videoUrl, posterUrl) {
        if (!videoUrl || truvazeState.playerMounted) return false;

        let containerForPlayer;

        if (location.hostname.includes('twiigle.com')) {
            const link = document.querySelector('a[href*="video.twimg.com"]');
            if (!link) return false;
            const wrapperDiv = link.closest('div');
            if (!wrapperDiv) return false;

            const newContainer = document.createElement('div');
            wrapperDiv.insertAdjacentElement('afterend', newContainer);
            containerForPlayer = newContainer;
        } else if (location.hostname.includes('twihub.net')) {
            const videoLink = document.getElementById('video-link');
            if (!videoLink) return false;

            videoLink.style.display = 'none';
            const newContainer = document.createElement('div');
            videoLink.insertAdjacentElement('afterend', newContainer);
            containerForPlayer = newContainer;
        } else {
            const bgBlackDiv = document.querySelector('div.bg-white.rounded-lg div.w-full.bg-black');
            if (!bgBlackDiv) return false;

            const relativeDiv = bgBlackDiv.querySelector('div.relative');
            if (!relativeDiv) return false;

            relativeDiv.innerHTML = '';
            containerForPlayer = relativeDiv;
        }

        // --- 动态适配分辨率开始 ---
        const dim = getVideoDimensions(videoUrl);
        log(`提取视频宽高比: ${dim.ratio}`);

        const artContainer = document.createElement('div');
        artContainer.setAttribute('data-truvaze-auto-player', 'true');

        if (location.hostname.includes('twiigle.com') || location.hostname.includes('twihub.net')) {
            artContainer.style.cssText = `width:100%;max-width:800px;margin:0 auto;aspect-ratio:${dim.ratio};background:#000;`;
        } else {
            artContainer.style.cssText = `width:100%;aspect-ratio:${dim.ratio};background:#000;`;
        }

        containerForPlayer.appendChild(artContainer);

        truvazeState.playerMounted = true;
        initTruvazeArtPlayer(artContainer, videoUrl, posterUrl);
        log('内嵌播放器已挂载:', videoUrl);
        return true;
    }

    function watchTruvazeReactClobber(videoUrl, posterUrl) {
        const guardObserver = new MutationObserver(() => {
            if (document.querySelector('[data-truvaze-auto-player="true"]')) return;
            log('被 React 覆盖，重新挂载...');
            truvazeState.playerMounted = false;
            if (truvazeState.artInstance) {
                try { truvazeState.artInstance.destroy(false); } catch (_) { }
                truvazeState.artInstance = null;
            }
            if (mountTruvazeInlinePlayer(videoUrl, posterUrl)) {
                log('重新挂载成功...');
            }
        });
        guardObserver.observe(document.documentElement, { childList: true, subtree: true });
        window.setTimeout(() => guardObserver.disconnect(), 30000);
    }

    function bootTruvaze() {
        const info = extractTruvazeVideoInfo();
        if (!info || !info.videoUrl) return;

        truvazeState.videoUrl = info.videoUrl;
        truvazeState.posterUrl = info.posterUrl;

        if (mountTruvazeInlinePlayer(info.videoUrl, info.posterUrl)) {
            watchTruvazeReactClobber(info.videoUrl, info.posterUrl);
            return;
        }

        const observer = new MutationObserver(() => {
            if (mountTruvazeInlinePlayer(info.videoUrl, info.posterUrl)) {
                observer.disconnect();
                watchTruvazeReactClobber(info.videoUrl, info.posterUrl);
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        window.setTimeout(() => observer.disconnect(), 15000);
    }

    function cleanAds() {
        const style = document.createElement('style');
        style.textContent = `
            [id^="banner-"], [id^="ad-container-"], [id^="bnc_ad_"],
            div.fixed.bottom-0.right-0.z-50,
            [data-cl-spot] {
                display: none !important;
            }
        `;
        if (document.head) document.head.appendChild(style);
    }

    function delayedBootTruvaze() {
        disableGlobalReferrer();
        cleanAds();
        const origConsoleError = console.error;
        console.error = function (...args) {
            if (typeof args[0] === 'string' && args[0].includes('#418')) return;
            return origConsoleError.apply(console, args);
        };
        setTimeout(bootTruvaze, 1500);
    }

    // =========================================================================
    // 路由分发
    // =========================================================================
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        if (isTwivideo) {
            bootTwivideo();
        } else {
            delayedBootTruvaze();
        }
    }
})();
