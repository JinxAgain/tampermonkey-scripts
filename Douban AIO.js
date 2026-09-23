// ==UserScript==
// @name         Douban AIO (Refactored)
// @namespace    https://github.com/JinxAgain
// @version      1.0.0
// @description  Streamlined resource search and subtitle aggregator for Douban Movies & TV Series with Dark Reader support.
// @author       Jinx
// @match        https://movie.douban.com/subject/*
// @icon         https://img3.doubanio.com/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      *
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // Chinese numeral mapping for season extraction
  const CN_NUM_MAP = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
    '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15
  };

  /**
   * Extract comprehensive metadata from current Douban subject page
   */
  function extractMetadata() {
    const doubanMatch = location.pathname.match(/\/subject\/(\d+)/);
    const doubanId = doubanMatch ? doubanMatch[1] : '';
    if (!doubanId) return null;

    // Detect if this is a TV series or a movie
    const isSeriesTag = document.querySelector('a.bn-sharing[data-type="电视剧"]');
    const hasEpisodes = Array.from(document.querySelectorAll('#info span.pl')).some(
      el => el.textContent.includes('集数') || el.textContent.includes('单集片长')
    );
    const isSeries = Boolean(isSeriesTag || hasEpisodes);

    // Extract IMDb ID from #info section
    let imdbId = '';
    const infoSpans = document.querySelectorAll('#info span.pl');
    for (const span of infoSpans) {
      if (span.textContent.includes('IMDb')) {
        let node = span.nextSibling;
        while (node) {
          if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
            const match = node.textContent.trim().match(/tt\d+/i);
            if (match) {
              imdbId = match[0];
              break;
            }
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const match = node.textContent.trim().match(/tt\d+/i);
            if (match) {
              imdbId = match[0];
              break;
            }
          }
          node = node.nextSibling;
        }
        break;
      }
    }

    // Extract raw title and year
    const h1El = document.querySelector('#content > h1');
    const titleSpan = h1El ? h1El.querySelector('span[property="v:itemreviewed"]') || h1El.firstElementChild : null;
    const rawFullTitle = titleSpan ? titleSpan.textContent.trim() : document.title.replace('(豆瓣)', '').trim();

    const yearSpan = h1El ? h1El.querySelector('span.year') : null;
    const yearMatch = yearSpan ? yearSpan.textContent.match(/\d{4}/) : null;
    const year = yearMatch ? yearMatch[0] : '';

    // Extract season information for TV series
    let seasonNum = 1;
    let seasonMatched = false;

    // Try Chinese season regex e.g. "第二季", "第2季"
    const cnSeasonMatch = rawFullTitle.match(/第([0-9]+|[一二三四五六七八九十]+)季/);
    if (cnSeasonMatch) {
      const val = cnSeasonMatch[1];
      seasonNum = CN_NUM_MAP[val] || parseInt(val, 10) || 1;
      seasonMatched = true;
    } else {
      // Try English season regex e.g. "Season 2", "Season 02"
      const enSeasonMatch = rawFullTitle.match(/Season\s*(\d+)/i);
      if (enSeasonMatch) {
        seasonNum = parseInt(enSeasonMatch[1], 10) || 1;
        seasonMatched = true;
      }
    }

    const seasonCode = `S${String(seasonNum).padStart(2, '0')}`;
    const seasonText = `Season ${seasonNum}`;

    // Separate Chinese and English portions of the title
    let cnTitle = '';
    let engTitle = '';

    // Remove year and season markers to isolate base titles
    const cleanRaw = rawFullTitle
      .replace(/第[0-9一二三四五六七八九十]+季/g, '')
      .replace(/Season\s*\d+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    const parts = cleanRaw.split(/\s+(?=[A-Za-z0-9])/);
    if (parts.length > 1) {
      cnTitle = parts[0].trim();
      engTitle = parts.slice(1).join(' ').trim();
    } else {
      if (/[\u4e00-\u9fa5]/.test(cleanRaw)) {
        cnTitle = cleanRaw;
      } else {
        engTitle = cleanRaw;
      }
    }

    if (!cnTitle && engTitle) cnTitle = engTitle;
    if (!engTitle && cnTitle) engTitle = cnTitle;

    const cleanCnTitle = cnTitle.replace(/[:：]/g, ' ').trim();
    const cleanEngTitle = engTitle.replace(/[:：]/g, ' ').replace(/[^a-zA-Z0-9\s.-]/g, '').trim();

    return {
      doubanId,
      imdbId,
      rawFullTitle,
      year,
      isSeries,
      seasonNum,
      seasonMatched,
      seasonCode,
      seasonText,
      cleanCnTitle,
      cleanEngTitle
    };
  }

  /**
   * Inject Simkl favicon link right next to the title in H1
   */
  function injectSimkl(ctx) {
    if (!ctx.imdbId) return;
    const h1El = document.querySelector('#content > h1');
    if (!h1El || h1El.querySelector('.aio-simkl-btn')) return;

    const simklLink = document.createElement('a');
    simklLink.className = 'aio-simkl-btn';
    simklLink.href = `https://api.simkl.com/redirect?to=Simkl&imdb=${ctx.imdbId}`;
    simklLink.target = '_blank';
    simklLink.rel = 'noopener noreferrer';
    simklLink.title = 'View on Simkl';

    const simklImg = document.createElement('img');
    simklImg.src = 'https://simkl.com/favicon.ico';
    simklImg.alt = 'Simkl';

    simklLink.appendChild(simklImg);
    h1El.appendChild(simklLink);
  }

  /**
   * Declarative definition of all 4 resource groups
   */
  function getSiteGroups(ctx) {
    const enc = encodeURIComponent;

    return [
      {
        icon: '🍕🍔🍟🌭🍿🧂🍳🧀🥞',
        name: 'Torrents & Media',
        sites: [
          {
            name: 'Ext',
            url: ctx.isSeries
              ? `https://ext.to/browse/?sort=size&order=desc&q=${enc(ctx.cleanEngTitle + ' ' + ctx.seasonCode)}`
              : (ctx.imdbId ? `https://ext.to/browse/?sort=size&order=desc&imdb_id=${ctx.imdbId}` : `https://ext.to/browse/?sort=size&order=desc&q=${enc(ctx.cleanEngTitle)}`),
            check: true,
            selector: 'table.table-striped td.td, .table-torrents tr'
          },
          {
            name: 'DMM',
            url: `https://debridmediamanager.com/${ctx.isSeries ? 'show' : 'movie'}/${ctx.imdbId || enc(ctx.cleanEngTitle)}`,
            check: false
          },
          {
            name: 'TorrentLeech',
            url: ctx.isSeries
              ? `https://www.tlgetin.cc/torrents/browse/index/query/${enc(ctx.cleanEngTitle + ' ' + ctx.seasonCode)}/orderby/size/order/desc`
              : (ctx.imdbId ? `https://www.tlgetin.cc/torrents/browse/index/imdbID/${ctx.imdbId}/orderby/size/order/desc` : `https://www.tlgetin.cc/torrents/browse/index/query/${enc(ctx.cleanEngTitle)}`),
            check: false
          },
          {
            name: 'Milkie',
            url: ctx.isSeries
              ? `https://milkie.cc/browse?query=${enc(ctx.cleanEngTitle + ' ' + ctx.seasonCode)}&categories=1&categories=2`
              : `https://milkie.cc/browse?query=${enc(ctx.cleanEngTitle + (ctx.year ? ' ' + ctx.year : ''))}&categories=1&categories=2`,
            check: true,
            selector: 'table.table2 div.tt-name, table tbody tr'
          },
          {
            name: 'MovieboxPro',
            url: ctx.isSeries
              ? `https://www.movieboxpro.app/index/search?word=${enc(ctx.cleanEngTitle + ' ' + ctx.seasonCode)}`
              : `https://www.movieboxpro.app/index/search?word=${ctx.imdbId || enc(ctx.cleanEngTitle)}`,
            check: false
          },
          {
            name: 'Knaben',
            url: ctx.isSeries
              ? `https://knaben.eu/search/${enc(ctx.cleanEngTitle + ' ' + ctx.seasonCode)}`
              : `https://knaben.eu/search/${enc(ctx.cleanEngTitle + (ctx.year ? ' ' + ctx.year : ''))}`,
            check: true,
            selector: 'table.table.table-striped td.td, table tbody tr'
          },
          {
            name: '1337X',
            url: ctx.isSeries
              ? `https://www.1337x.to/search/${enc(ctx.cleanEngTitle + ' ' + ctx.seasonCode)}/1/`
              : `https://www.1337x.to/search/${enc(ctx.cleanEngTitle + (ctx.year ? ' ' + ctx.year : ''))}/1/`,
            check: true,
            selector: 'table.table-list td.coll-1.name, table tbody tr'
          },
          {
            name: 'Bt4g',
            url: ctx.isSeries
              ? `https://bt4gprx.com/search?q=${enc(ctx.cleanEngTitle + ' ' + ctx.seasonCode)}`
              : `https://bt4gprx.com/search?q=${enc(ctx.cleanEngTitle + (ctx.year ? ' ' + ctx.year : ''))}`,
            check: true,
            selector: 'table.table2 div.tt-name, h5.title, div.row h5'
          },
          {
            name: 'Nyaa',
            url: `https://nyaa.si/?q=${enc(ctx.cleanEngTitle || ctx.cleanCnTitle)}`,
            check: true,
            selector: 'div.table-responsive tr.default, table.torrent-list tbody tr'
          },
          {
            name: '动漫花园',
            url: `https://share.dmhy.org/topics/list?keyword=${enc(ctx.cleanCnTitle || ctx.cleanEngTitle)}`,
            check: true,
            selector: 'tbody span.btl_1, table#topic_list tbody tr'
          },
          {
            name: 'EZTV',
            url: `https://eztv.ag/search/${enc(ctx.cleanEngTitle)}`,
            check: true,
            selector: 'td.forum_thread_post > a'
          },
          {
            name: 'PianYuan',
            url: ctx.isSeries
              ? `http://pianyuan.org/search?q=${enc(ctx.cleanCnTitle + ' 第' + ctx.seasonNum + '季')}`
              : `http://pianyuan.org/search?q=${enc(ctx.cleanCnTitle + (ctx.year ? ' ' + ctx.year : ''))}`,
            check: true,
            selector: 'div.row ul.detail, div.media'
          }
        ]
      },
      {
        icon: '🕵️🥷🧑‍🏭🧑‍💻🧑‍🎨👩‍🚀🧙🧛‍♀️🦹‍♂️',
        name: 'Chinese Subtitles',
        sites: [
          {
            name: '字幕库',
            url: ctx.isSeries
              ? `https://zmk.pw/search?q=${enc(ctx.cleanEngTitle + ' ' + ctx.seasonCode)}`
              : (ctx.imdbId ? `https://zmk.pw/search?q=${ctx.imdbId}` : `https://zmk.pw/search?q=${enc(ctx.cleanCnTitle)}`),
            check: true,
            selector: 'h3 a, div.item'
          },
          {
            name: 'Sub HD',
            url: ctx.isSeries
              ? `https://subhd.tv/search/${enc(ctx.cleanEngTitle + ' ' + ctx.seasonCode)}`
              : (ctx.imdbId ? `https://subhd.tv/search/${ctx.imdbId}` : `https://subhd.tv/search/${enc(ctx.cleanCnTitle)}`),
            check: true,
            selector: '.position-relative .float-start, a.d-block'
          },
          {
            name: 'r3sub',
            url: ctx.isSeries
              ? `https://r3sub.com/search.php?s=${enc(ctx.cleanCnTitle + ' ' + ctx.seasonCode)}`
              : `https://r3sub.com/search.php?s=${enc(ctx.cleanCnTitle + (ctx.year ? ' ' + ctx.year : ''))}`,
            check: true,
            selector: 'div.movie.movie--preview'
          }
        ]
      },
      {
        icon: '🛹🏎️🛩️🪂✈️🚂🛸🛰️🚀',
        name: 'Cloud Drives',
        sites: [
          {
            name: 'T-REX',
            url: ctx.isSeries
              ? `https://t-rex.tzfile.com/?s=${enc(ctx.cleanCnTitle + ' 第' + ctx.seasonNum + '季')}`
              : `https://t-rex.tzfile.com/?s=${enc(ctx.cleanCnTitle)}`,
            check: false
          },
          {
            name: '秒搜',
            url: ctx.isSeries
              ? `https://miaosou.fun/info?searchKey=${enc(ctx.cleanCnTitle + ' 第' + ctx.seasonNum + '季')}`
              : `https://miaosou.fun/info?searchKey=${enc(ctx.cleanCnTitle)}`,
            check: false
          },
          {
            name: '盘友圈',
            url: 'https://panyq.com',
            check: false
          }
        ]
      },
      {
        icon: '🎉🎊🎎🎋🎍🎏🎐🎫🎞️',
        name: 'Overseas Subtitles',
        sites: [
          {
            name: 'OpenSub',
            url: ctx.isSeries
              ? `https://www.opensubtitles.org/zh/search/sublanguageid-all/moviename-${enc(ctx.cleanEngTitle + ' ' + ctx.seasonCode)}`
              : (ctx.imdbId ? `https://www.opensubtitles.org/zh/search/sublanguageid-all/imdbid-${ctx.imdbId}` : `https://www.opensubtitles.org/zh/search/sublanguageid-all/moviename-${enc(ctx.cleanEngTitle)}`),
            check: false
          },
          {
            name: 'Sub-Scene',
            url: ctx.isSeries
              ? `https://sub-scene.com/subtitles/title?q=${enc(ctx.cleanEngTitle + ' - ' + ctx.seasonText)}`
              : `https://sub-scene.com/subtitles/title?q=${enc(ctx.cleanEngTitle || ctx.cleanCnTitle)}`,
            check: false
          },
          {
            name: 'Subsource',
            url: ctx.isSeries
              ? `https://subsource.net/search?query=${enc(ctx.cleanEngTitle + ' ' + ctx.seasonCode)}`
              : `https://subsource.net/search?query=${enc(ctx.cleanEngTitle || ctx.cleanCnTitle)}`,
            check: false
          },
          {
            name: 'Subdl',
            url: ctx.isSeries
              ? `https://subdl.com/search/${enc(ctx.cleanEngTitle + ' ' + ctx.seasonText)}`
              : (ctx.imdbId ? `https://subdl.com/subtitle/${ctx.imdbId}` : `https://subdl.com/search/${enc(ctx.cleanEngTitle || ctx.cleanCnTitle)}`),
            check: false
          },
          {
            name: 'Addic7ed',
            url: `https://www.addic7ed.com/srch.php?search=${enc(ctx.cleanEngTitle || ctx.cleanCnTitle)}`,
            check: false
          }
        ]
      }
    ];
  }

  /**
   * LocalStorage cache management with 24-hour expiration
   */
  const CACHE_TTL = 24 * 60 * 60 * 1000;

  function getCache(doubanId) {
    try {
      const raw = localStorage.getItem(`aio_cache_${doubanId}`);
      if (!raw) return {};
      const data = JSON.parse(raw);
      if (Date.now() - (data._timestamp || 0) > CACHE_TTL) {
        localStorage.removeItem(`aio_cache_${doubanId}`);
        return {};
      }
      return data;
    } catch {
      return {};
    }
  }

  function setCacheItem(doubanId, siteName, exists) {
    try {
      const data = getCache(doubanId);
      data._timestamp = data._timestamp || Date.now();
      data[siteName] = exists;
      localStorage.setItem(`aio_cache_${doubanId}`, JSON.stringify(data));
    } catch (e) {
      console.warn('[Douban AIO] Cache write failed', e);
    }
  }

  /**
   * Perform asynchronous existence check using GM_xmlhttpRequest
   */
  function checkSiteResource(site, btnEl, doubanId) {
    // Check local cache first
    const cache = getCache(doubanId);
    if (typeof cache[site.name] === 'boolean') {
      applyStatus(btnEl, cache[site.name] ? 'exist' : 'not-exist');
      return;
    }

    applyStatus(btnEl, 'checking');

    GM_xmlhttpRequest({
      method: 'GET',
      url: site.url,
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      onload: function (res) {
        if (res.status >= 200 && res.status < 400) {
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(res.responseText, 'text/html');
            const found = Boolean(doc.querySelector(site.selector));
            applyStatus(btnEl, found ? 'exist' : 'not-exist');
            setCacheItem(doubanId, site.name, found);
          } catch (e) {
            applyStatus(btnEl, 'error');
          }
        } else {
          applyStatus(btnEl, 'error');
        }
      },
      onerror: function () {
        applyStatus(btnEl, 'error');
      },
      ontimeout: function () {
        applyStatus(btnEl, 'error');
      }
    });
  }

  /**
   * Update button CSS status
   */
  function applyStatus(btnEl, status) {
    btnEl.classList.remove('aio-exist', 'aio-not-exist', 'aio-checking', 'aio-error');
    if (status === 'exist') {
      btnEl.classList.add('aio-exist');
      btnEl.title = 'Resource available';
    } else if (status === 'not-exist') {
      btnEl.classList.add('aio-not-exist');
      btnEl.title = 'No resource found';
    } else if (status === 'checking') {
      btnEl.classList.add('aio-checking');
      btnEl.title = 'Checking availability...';
    } else if (status === 'error') {
      btnEl.classList.add('aio-error');
      btnEl.title = 'Check timed out or failed (Click to visit)';
    }
  }

  /**
   * Render the 4 resource groups in Douban's sidebar
   */
  function renderResourceGroups(ctx) {
    const aside = document.querySelector('#content div.aside');
    if (!aside) return;

    const existingPanel = document.querySelector('.aio-panel');
    if (existingPanel) existingPanel.remove();

    const panel = document.createElement('div');
    panel.className = 'aio-panel';

    const groups = getSiteGroups(ctx);

    for (const group of groups) {
      const groupEl = document.createElement('div');
      groupEl.className = 'aio-group';

      const titleEl = document.createElement('div');
      titleEl.className = 'aio-group-title';
      titleEl.textContent = group.icon;
      groupEl.appendChild(titleEl);

      const btnContainer = document.createElement('div');
      btnContainer.className = 'aio-btn-container';

      for (const site of group.sites) {
        const link = document.createElement('a');
        link.className = 'aio-btn';
        link.href = site.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = site.name;

        if (site.check) {
          checkSiteResource(site, link, ctx.doubanId);
        }

        btnContainer.appendChild(link);
      }

      groupEl.appendChild(btnContainer);
      panel.appendChild(groupEl);
    }

    aside.prepend(panel);
  }

  /**
   * Inject modern, adaptive styling for light and dark modes
   */
  function injectStyles() {
    GM_addStyle(`
      :root {
        --aio-bg: #f8fafc;
        --aio-border: #e2e8f0;
        --aio-btn-bg: #f1f5f9;
        --aio-btn-hover: #e2e8f0;
        --aio-btn-text: #1e293b;
        --aio-exist-bg: #ecfdf5;
        --aio-exist-border: #10b981;
        --aio-exist-text: #047857;
        --aio-none-bg: #f8fafc;
        --aio-none-border: #cbd5e1;
        --aio-none-text: #94a3b8;
        --aio-checking-border: #0ea5e9;
      }

      @media (prefers-color-scheme: dark), html[data-darkreader-scheme="dark"] {
        :root {
          --aio-bg: #18181b;
          --aio-border: #27272a;
          --aio-btn-bg: #27272a;
          --aio-btn-hover: #3f3f46;
          --aio-btn-text: #e4e4e7;
          --aio-exist-bg: rgba(16, 185, 129, 0.15);
          --aio-exist-border: #10b981;
          --aio-exist-text: #34d399;
          --aio-none-bg: #18181b;
          --aio-none-border: #3f3f46;
          --aio-none-text: #71717a;
          --aio-checking-border: #38bdf8;
        }
      }

      /* Simkl Button */
      .aio-simkl-btn {
        display: inline-flex;
        align-items: center;
        margin-left: 10px;
        vertical-align: middle;
        text-decoration: none;
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      .aio-simkl-btn:hover {
        transform: scale(1.2);
      }
      .aio-simkl-btn img {
        width: 16px;
        height: 16px;
        border-radius: 3px;
        display: block;
      }

      /* Resource Panel Container */
      .aio-panel {
        margin-bottom: 24px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }

      /* Group Title */
      .aio-group-title {
        font-size: 13px;
        margin: 10px 0 6px 0;
        letter-spacing: 2px;
        opacity: 0.9;
        user-select: none;
      }

      /* Button Grid */
      .aio-btn-container {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 8px;
      }

      /* Pill Button */
      .aio-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 66px;
        height: 26px;
        padding: 0 9px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        text-decoration: none !important;
        border: 1px solid var(--aio-border);
        background-color: var(--aio-btn-bg);
        color: var(--aio-btn-text) !important;
        box-sizing: border-box;
        transition: all 0.15s ease-in-out;
        position: relative;
        cursor: pointer;
      }

      .aio-btn:hover {
        background-color: var(--aio-btn-hover);
        transform: translateY(-1px);
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.08);
      }

      /* State: Exist */
      .aio-btn.aio-exist {
        background-color: var(--aio-exist-bg) !important;
        border-color: var(--aio-exist-border) !important;
        color: var(--aio-exist-text) !important;
      }

      /* State: Not Exist */
      .aio-btn.aio-not-exist {
        background-color: var(--aio-none-bg) !important;
        border-color: var(--aio-none-border) !important;
        color: var(--aio-none-text) !important;
        opacity: 0.65;
      }

      /* State: Error */
      .aio-btn.aio-error {
        opacity: 0.85;
      }

      /* State: Checking */
      .aio-btn.aio-checking::after {
        content: '';
        position: absolute;
        top: 3px;
        right: 3px;
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background-color: var(--aio-checking-border);
        animation: aio-pulse 1.2s infinite ease-in-out;
      }

      @keyframes aio-pulse {
        0% { transform: scale(0.8); opacity: 0.5; }
        50% { transform: scale(1.4); opacity: 1; }
        100% { transform: scale(0.8); opacity: 0.5; }
      }
    `);
  }

  /**
   * Main Initialization
   */
  function init() {
    const ctx = extractMetadata();
    if (!ctx) return;

    injectStyles();
    injectSimkl(ctx);
    renderResourceGroups(ctx);
  }

  init();
})();