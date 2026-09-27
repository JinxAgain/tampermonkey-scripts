// ==UserScript==
// @name         Douban AIO (Refactored)
// @namespace    https://github.com/JinxAgain
// @version      1.0.1
// @description  Streamlined resource search and subtitle aggregator for Douban Movies & TV Series with Dark Reader support.
// @author       Jinx
// @match        https://movie.douban.com/subject/*
// @icon         https://img3.doubanio.com/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      *
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/JinxAgain/tampermonkey-scripts/main/Douban%20AIO.js
// @downloadURL  https://raw.githubusercontent.com/JinxAgain/tampermonkey-scripts/main/Douban%20AIO.js
// ==/UserScript==

(function () {
  'use strict';

  // Menu command to customize OMDb API key
  if (typeof GM_registerMenuCommand !== 'undefined') {
    GM_registerMenuCommand('设置 OMDb API Key', () => {
      const current = GM_getValue('apikey_omdb', 'thewdb');
      const val = prompt('请输入 OMDb API Key (默认为公共 Key: thewdb):', current);
      if (val !== null && val.trim() !== '') {
        GM_setValue('apikey_omdb', val.trim());
        location.reload();
      }
    });
  }

  /**
   * Helper to retrieve plain text following an element
   */
  function fetchAnchorText(el) {
    if (!el || !el.nextSibling) return '';
    let node = el.nextSibling;
    while (node && node.nodeType !== Node.TEXT_NODE) {
      if (node.nodeType === Node.ELEMENT_NODE && node.textContent.trim()) {
        return node.textContent.trim();
      }
      node = node.nextSibling;
    }
    return node ? node.textContent.trim() : '';
  }

  /**
   * Extract comprehensive metadata and compute all legacy search variables (commit 94341a7)
   */
  function extractMetadata() {
    const doubanMatch = location.pathname.match(/\/subject\/(\d+)/);
    const doubanId = doubanMatch ? doubanMatch[1] : '';
    if (!doubanId) return null;

    // Detect media types
    const isSeries = Boolean(
      document.querySelector('a.bn-sharing[data-type="电视剧"]') ||
      Array.from(document.querySelectorAll('#info span.pl')).some(
        el => el.textContent.includes('集数') || el.textContent.includes('单集片长')
      )
    );
    const isMovie = !isSeries;

    // Extract IMDb ID from #info
    let imdb_id = '';
    const infoSpans = document.querySelectorAll('#info span.pl');
    for (const span of infoSpans) {
      if (span.textContent.includes('IMDb')) {
        let node = span.nextSibling;
        while (node) {
          const text = (node.textContent || '').trim();
          const match = text.match(/tt\d+/i);
          if (match) {
            imdb_id = match[0];
            break;
          }
          node = node.nextSibling;
        }
        break;
      }
    }
    const has_imdb = Boolean(imdb_id);

    // Extract titles and akas exactly as in legacy script
    const chinese_title = document.title.replace('(豆瓣)', '').trim();
    const h1El = document.querySelector('#content > h1');
    const reviewedSpan = h1El ? h1El.querySelector('span[property="v:itemreviewed"]') || h1El.firstElementChild : null;
    const reviewedText = reviewedSpan ? reviewedSpan.textContent.trim() : chinese_title;
    const foreign_title = reviewedText.replace(chinese_title, '').trim();

    // Extract aka ("又名")
    let aka = '';
    const akaSpan = Array.from(infoSpans).find(el => el.textContent.includes('又名'));
    if (akaSpan) {
      const rawAka = fetchAnchorText(akaSpan);
      if (rawAka) {
        aka = rawAka.split(' / ').sort((a, b) => a.localeCompare(b)).join('/');
      }
    }

    let trans_title, this_title;
    if (foreign_title) {
      trans_title = chinese_title + (aka ? ('/' + aka) : '');
      this_title = foreign_title;
    } else {
      trans_title = aka ? aka : '';
      this_title = chinese_title;
    }

    const yearSpan = h1El ? h1El.querySelector('span.year') : null;
    const yearMatch = yearSpan ? yearSpan.textContent.match(/\d{4}/) : null;
    const year = yearMatch ? (' ' + yearMatch[0]) : '';

    // Legacy title: first word before space
    const title = reviewedText.split(' ').shift().replace(/[，]/g, ' ').replace(/：.*$/, '');

    // Legacy eng_title: first item containing at least two consecutive English letters
    let eng_title = [this_title, trans_title].join('/').split('/').filter(arr => /([a-zA-Z]){2,}/.test(arr))[0] || '';

    const is_chinese = Boolean(title.match(/[^\x00-\xff]/));
    const unititle = is_chinese ? title : eng_title;

    // Season correction for TV series
    eng_title = eng_title.match(/Season\s\d\d/) ? eng_title.replace(/Season\s/, 'S') : eng_title.replace(/Season\s/, 'S0');
    eng_title = eng_title.replace(/[:,!\-]/g, '').replace(/ [^a-z0-9]+$/, '').replace(/ +/g, ' ');
    let eng_title_clean = eng_title.replace(/ S\d\d*$/, '');
    const has_entitle = eng_title_clean;

    const nian = isMovie ? year : '';
    // Prevent duplicate year suffix if eng_title already ends with the year
    const isYearDuplicated = Boolean(year.trim() && eng_title.trim().endsWith(year.trim()));
    let ywm = eng_title ? (isYearDuplicated ? eng_title : (eng_title + nian)) : (unititle + nian);
    let zwm = chinese_title + nian;
    let entitle = eng_title_clean ? (isYearDuplicated ? eng_title_clean : (eng_title_clean + nian)) : (unititle + nian);
    let dbzw = has_imdb ? imdb_id : (unititle + nian);
    let series_exact = has_imdb ? imdb_id : (isSeries ? (eng_title || unititle) : (unititle + nian));
    if (isSeries) {
      series_exact = eng_title || unititle;
    }

    const temp = isMovie ? 'movie' : 'show';

    return {
      doubanId,
      has_imdb,
      imdb_id,
      isMovie,
      isSeries,
      chinese_title,
      foreign_title,
      aka,
      trans_title,
      this_title,
      year,
      nian,
      title,
      eng_title,
      eng_title_clean,
      has_entitle,
      unititle,
      ywm,
      zwm,
      entitle,
      dbzw,
      series_exact,
      temp
    };
  }

  /**
   * Fetch OMDb API to fix episode IMDb IDs and retrieve canonical English title
   */
  async function resolveOmdbData(ctx) {
    if (!ctx.has_imdb) return;

    const apikey = GM_getValue('apikey_omdb', 'thewdb');
    const url = `https://www.omdbapi.com/?apikey=${apikey}&i=${ctx.imdb_id}`;

    try {
      const res = await new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          timeout: 4000,
          onload: resolve,
          onerror: reject,
          ontimeout: reject
        });
      });

      if (res.status >= 200 && res.status < 400) {
        const json = JSON.parse(res.responseText);
        if (json && json.Response === 'True') {
          // 1. If Douban gave an episode ID, override with the series ID
          if (json.Type === 'episode' && json.seriesID) {
            console.log('[Douban AIO] OMDb: Override episode ID', ctx.imdb_id, 'with seriesID:', json.seriesID);
            ctx.imdb_id = json.seriesID;
            ctx.dbzw = ctx.imdb_id;
            if (!ctx.isSeries) {
              ctx.series_exact = ctx.imdb_id;
            }
          }

          // 2. If OMDb provides an authentic English/international title (e.g. "Villain" for 《恶人》)
          if (json.Title && /([a-zA-Z]){2,}/.test(json.Title)) {
            // For movies, or TV series when eng_title is missing/different
            if (ctx.isMovie || !ctx.eng_title) {
              ctx.eng_title = json.Title.replace(/[:,!\-]/g, '').replace(/ [^a-z0-9]+$/, '').replace(/ +/g, ' ');
              ctx.eng_title_clean = ctx.eng_title.replace(/ S\d\d*$/, '');
              const isYearDuplicated = Boolean(ctx.year.trim() && ctx.eng_title.trim().endsWith(ctx.year.trim()));
              ctx.ywm = isYearDuplicated ? ctx.eng_title : (ctx.eng_title + ctx.nian);
              ctx.entitle = isYearDuplicated ? ctx.eng_title_clean : (ctx.eng_title_clean + ctx.nian);
              if (ctx.isSeries) {
                ctx.series_exact = ctx.eng_title;
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Douban AIO] OMDb resolution skipped or timed out', e);
    }
  }

  /**
   * Inject Simkl favicon link right next to the title in H1
   */
  function injectSimkl(ctx) {
    if (!ctx.has_imdb) return;
    const h1El = document.querySelector('#content > h1');
    if (!h1El) return;

    let simklLink = h1El.querySelector('.aio-simkl-btn');
    if (!simklLink) {
      simklLink = document.createElement('a');
      simklLink.className = 'aio-simkl-btn';
      simklLink.target = '_blank';
      simklLink.rel = 'noopener noreferrer';
      simklLink.title = 'View on Simkl';

      const simklImg = document.createElement('img');
      simklImg.src = 'https://simkl.com/favicon.ico';
      simklImg.alt = 'Simkl';
      simklLink.appendChild(simklImg);

      h1El.appendChild(simklLink);
    }

    simklLink.href = `https://api.simkl.com/redirect?to=Simkl&imdb=${ctx.imdb_id}`;
  }

  /**
   * Declarative definition of all 4 resource groups (commit 94341a7 search logic)
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
            url: ctx.has_imdb
              ? `https://ext.to/browse/?sort=size&order=desc&imdb_id=${ctx.imdb_id}`
              : `https://ext.to/browse/?sort=size&order=desc&q=${enc(ctx.ywm)}`,
            check: true,
            selector: 'table.table-striped.table-bordered.table-hover.table-condensed td.td, table.table-striped td.td, .table-torrents tr'
          },
          {
            name: 'DMM',
            url: `https://debridmediamanager.com/${ctx.temp}/${ctx.imdb_id}`,
            check: false
          },
          {
            name: 'TorrentLeech',
            url: `https://www.tlgetin.cc/torrents/browse/index/imdbID/${ctx.imdb_id}/orderby/size/order/desc`,
            check: false
          },
          {
            name: 'Milkie',
            url: `https://milkie.cc/browse?query=${enc(ctx.ywm)}&categories=1&categories=2`,
            check: true,
            selector: 'table.table2 div.tt-name, table tbody tr'
          },
          {
            name: 'MovieboxPro',
            url: `https://www.movieboxpro.app/index/search?word=${ctx.imdb_id}`,
            check: false
          },
          {
            name: 'Knaben',
            url: `https://knaben.eu/search/${enc(ctx.ywm.replace(/S\d+$/g, ''))}`,
            check: true,
            selector: 'table.table-striped.table-bordered.table-hover.table-condensed td.td, table tbody tr'
          },
          {
            name: '1337X',
            url: `https://www.1337x.to/search/${enc(ctx.ywm)}/1/`,
            check: true,
            selector: 'table.table-list td.coll-1.name, table tbody tr'
          },
          {
            name: 'Bt4g',
            url: `https://bt4gprx.com/search?q=${enc(ctx.ywm)}`,
            check: true,
            selector: 'table.table2 div.tt-name, h5.title, div.row h5'
          },
          {
            name: 'Nyaa',
            url: `https://nyaa.si/?q=${enc(ctx.eng_title || ctx.unititle)}`,
            check: true,
            selector: 'div.table-responsive tr.default, table.torrent-list tbody tr'
          },
          {
            name: '动漫花园',
            url: `https://share.dmhy.org/topics/list?keyword=${enc(ctx.unititle)}`,
            check: true,
            selector: 'tbody span.btl_1, table#topic_list tbody tr'
          },
          {
            name: 'EZTV',
            url: `https://eztv.ag/search/${enc(ctx.ywm.replace(/S\d+$/g, ''))}`,
            check: true,
            selector: `td.forum_thread_post > a[title*='${ctx.ywm.replace(/S\d+$/g, '')}'], td.forum_thread_post > a`
          },
          {
            name: 'PianYuan',
            url: `http://pianyuan.org/search?q=${enc(ctx.dbzw)}`,
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
            url: `https://zmk.pw/search?q=${ctx.imdb_id || enc(ctx.unititle)}`,
            check: true,
            selector: 'h3 a, div.item'
          },
          {
            name: 'Sub HD',
            url: `https://subhd.tv/search/${enc(ctx.series_exact)}`,
            check: true,
            selector: '.position-relative .float-start, a.d-block'
          },
          {
            name: 'r3sub',
            url: `https://r3sub.com/search.php?s=${enc(ctx.dbzw)}`,
            check: true,
            selector: 'div.col-sm-8.col-md-9.col-lg-8 div.movie.movie--preview.ddd, div.movie.movie--preview'
          }
        ]
      },
      {
        icon: '🛹🏎️🛩️🪂✈️🚂🛸🛰️🚀',
        name: 'Cloud Drives',
        sites: [
          {
            name: 'T-REX',
            url: `https://t-rex.tzfile.com/?s=${enc(ctx.unititle)}`,
            check: false
          },
          {
            name: '秒搜',
            url: `https://miaosou.fun/info?searchKey=${enc(ctx.unititle)}`,
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
            url: ctx.has_imdb
              ? `https://www.opensubtitles.org/zh/search/sublanguageid-all/imdbid-${ctx.imdb_id}`
              : `https://www.opensubtitles.org/zh/search/sublanguageid-all/moviename-${enc(ctx.eng_title || ctx.unititle)}`,
            check: false
          },
          {
            name: 'Sub-Scene',
            url: `https://sub-scene.com/subtitles/title?q=${enc(ctx.eng_title_clean || ctx.unititle)}`,
            check: false
          },
          {
            name: 'Subsource',
            url: `https://subsource.net/search?query=${enc(ctx.eng_title_clean || ctx.unititle)}`,
            check: false
          },
          {
            name: 'Subdl',
            url: ctx.has_imdb
              ? `https://subdl.com/subtitle/${ctx.imdb_id}`
              : `https://subdl.com/search/${enc(ctx.eng_title_clean || ctx.unititle)}`,
            check: false
          },
          {
            name: 'Addic7ed',
            url: `https://www.addic7ed.com/srch.php?search=${enc(ctx.eng_title_clean + (ctx.year ? ctx.year : ''))}`,
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
  function renderResourceGroups(ctx, aside) {
    let panel = document.getElementById('douban-aio-panel');
    if (panel) panel.remove();

    panel = document.createElement('div');
    panel.id = 'douban-aio-panel';
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

    const ensureTop = () => {
      if (aside.firstElementChild !== panel) {
        aside.prepend(panel);
      }
    };

    ensureTop();

    // Maintain top position in sidebar even when other scripts (e.g. 豆瓣评分增强大师) asynchronously prepend modules
    const observer = new MutationObserver(() => {
      ensureTop();
    });
    observer.observe(aside, { childList: true });
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
  async function init() {
    const ctx = extractMetadata();
    if (!ctx) return;

    injectStyles();

    // Query OMDb to correct series episode IMDb IDs & retrieve official international Title
    await resolveOmdbData(ctx);

    injectSimkl(ctx);

    const tryRender = () => {
      const aside = document.querySelector('#content div.aside') || document.querySelector('.aside');
      if (aside) {
        renderResourceGroups(ctx, aside);
      } else {
        setTimeout(tryRender, 100);
      }
    };

    tryRender();
  }

  init();
})();