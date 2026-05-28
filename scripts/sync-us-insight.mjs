import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import TurndownService from 'turndown';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const DEFAULT_SOURCE = 'https://us-insight.com/club/13/contents?type=all';
const DEFAULT_CATEGORY = 'US Insight';
const DEFAULT_TERM = '26년 여름학기';
const DEFAULT_PROFILE_DIR = resolve(rootDir, 'chrome_profile');
const DEFAULT_PORT = 9222;
const DEFAULT_GDRIVE_FOLDER_ID = '1v9H6SxCxIelFLW_nfDkOYjZFX3t_3nNC';

const args = parseArgs(process.argv.slice(2));
const sourceUrl = args.source || DEFAULT_SOURCE;
const allNew = Boolean(args.sinceLast || args.allNew || args.new);
const limit = allNew && !args.limit ? Number.POSITIVE_INFINITY : Number.parseInt(args.limit || '10', 10);
const category = args.category || DEFAULT_CATEGORY;
const term = args.term || DEFAULT_TERM;
const profileDir = resolve(rootDir, args.profileDir || DEFAULT_PROFILE_DIR);
const port = Number.parseInt(args.port || String(DEFAULT_PORT), 10);
const dryRun = Boolean(args.dryRun);
const debug = Boolean(args.debug);
const force = Boolean(args.force);
const skipMedia = Boolean(args.skipMedia);
const gdriveFolderId = args.gdriveFolderId || DEFAULT_GDRIVE_FOLDER_ID;
const updateIds = parseIdList(args.updateIds || args.updateId || '');

const postsPath = resolve(rootDir, 'public/data/posts.json');
const docsDir = resolve(rootDir, 'public/docs');
const tempDir = resolve(rootDir, 'temp_media');

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

turndown.remove(['script', 'style', 'noscript']);
turndown.addRule('images', {
  filter: 'img',
  replacement(content, node) {
    const alt = (node.getAttribute('alt') || '').replace(/\n/g, ' ');
    const src = node.getAttribute('src') || node.getAttribute('data-src') || '';
    const title = node.getAttribute('title');
    if (!src) return '';
    return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
  },
});

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

async function main() {
  if ((!Number.isFinite(limit) && !allNew) || limit < 1) {
    throw new Error('--limit must be a positive number.');
  }

  ensureDir(profileDir);
  launchChrome({ port, profileDir, url: sourceUrl });

  const browser = await waitForBrowser(port);
  const tabInfo = await openTab(port, sourceUrl);
  const cdp = await CDPClient.connect(tabInfo.webSocketDebuggerUrl);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await waitForPage(cdp);

  if (await isLoginPage(cdp)) {
    console.log('\nNaver login is required.');
    console.log('Finish the login in the Chrome window that opened, return here, then press Enter.');
    await promptEnter();
    await cdp.send('Page.navigate', { url: sourceUrl });
    await waitForPage(cdp);
  }

  await autoScroll(cdp);
  const links = await extractContentLinks(cdp, sourceUrl);
  if (links.length === 0) {
    const diagnostics = await collectPageDiagnostics(cdp);
    console.log('\nNo content links were found. Page diagnostics:');
    console.log(`- url: ${diagnostics.url}`);
    console.log(`- title: ${diagnostics.title}`);
    console.log(`- body text length: ${diagnostics.textLength}`);
    console.log(`- anchor count: ${diagnostics.anchorCount}`);
    console.log('- sample anchors:');
    diagnostics.anchors.forEach((anchor) => console.log(`  - ${anchor.text} -> ${anchor.href}`));
    console.log('- visible text sample:');
    console.log(diagnostics.textSample);
    throw new Error('No content links were found. The list page may still be logged out, or its cards do not use normal links.');
  }

  const posts = readJson(postsPath);

  if (updateIds.length > 0) {
    await updateExistingPosts({ cdp, posts, ids: updateIds });
    await cdp.close();
    return;
  }

  const existingSources = new Set(posts.map((post) => normalizeUrl(post.sourceUrl)).filter(Boolean));
  const existingTitles = new Set(posts.map((post) => normalizeTitle(post.title)).filter(Boolean));
  const targetLinks = selectTargetLinks(links, existingSources);

  if (debug && allNew) {
    console.log(`Selected ${targetLinks.length} links after last imported source.`);
  }

  const newItems = [];
  for (const link of targetLinks) {
    if (newItems.length >= limit) break;
    if (!force && existingSources.has(normalizeUrl(link.url))) {
      if (debug) console.log(`Skipped existing source: ${link.url}`);
      continue;
    }

    console.log(`Reading: ${link.title || link.url}`);
    const item = await scrapeContent(cdp, link.url, link.title);
    if (debug) {
      console.log(`Scraped title="${item.title}" markdownLength=${item.markdown.length} media=${item.media.length}`);
      if (!item.markdown) console.log(`Text sample: ${item.text?.slice(0, 500) || ''}`);
    }
    if (!item.title || !item.markdown) {
      console.warn(`Skipped because title/content was empty: ${link.url}`);
      continue;
    }

    const titleKey = normalizeTitle(item.title);
    if (!force && !item.sourceUrl && titleKey && existingTitles.has(titleKey)) {
      if (debug) console.log(`Skipped existing title: ${item.title}`);
      continue;
    }
    if (dryRun && item.media.length > 0) {
      console.log(`Detected media: ${item.media.map((media) => media.url).join(', ')}`);
    }
    newItems.push(item);
  }

  if (newItems.length === 0) {
    console.log('No new posts to import.');
    await cdp.close();
    return;
  }

  if (!dryRun && !skipMedia) {
    ensureDir(tempDir);
    for (const item of newItems) {
      await uploadDetectedMedia(item, cdp);
    }
  }

const nextIdStart = Math.max(0, ...posts.map((post) => Number(post.id) || 0)) + 1;
  const additions = newItems.map((item, index) => {
    const id = nextIdStart + index;
    const fileName = `briefing_${id}.md`;
    const postType = detectType(item);
    const post = {
      id,
      title: item.title,
      time: '방금 전',
      term,
      type: postType,
      category: classifyCategory(item, postType, category),
      likes: 0,
      isRead: false,
      isNew: true,
      fileName,
      sourceUrl: item.sourceUrl,
    };
    if (item.driveVideoUrl) post.url = item.driveVideoUrl;
    if (item.driveAudioUrl) post.audioUrl = item.driveAudioUrl;

    return {
      post: {
        ...post,
      },
      fileName,
      markdown: buildMarkdown(item),
    };
  });

  if (dryRun) {
    console.log(`Dry run: ${additions.length} posts would be imported.`);
    additions.forEach(({ post }) => console.log(`- #${post.id} ${post.title}`));
    await cdp.close();
    return;
  }

  for (const addition of additions) {
    writeFileSync(resolve(docsDir, addition.fileName), addition.markdown, 'utf8');
  }

  writeFileSync(postsPath, `${JSON.stringify([...additions.map((x) => x.post), ...posts], null, 4)}\n`, 'utf8');
  console.log(`Imported ${additions.length} posts.`);
  additions.forEach(({ post }) => console.log(`- #${post.id} ${post.title}`));

  await cdp.close();
}

async function updateExistingPosts({ cdp, posts, ids }) {
  let updated = 0;
  for (const id of ids) {
    const post = posts.find((item) => Number(item.id) === id);
    if (!post) {
      console.warn(`Skipped missing post id: ${id}`);
      continue;
    }
    if (!post.sourceUrl) {
      console.warn(`Skipped post id ${id}: sourceUrl is missing.`);
      continue;
    }

    console.log(`Updating #${id}: ${post.sourceUrl}`);
    const item = await scrapeContent(cdp, post.sourceUrl, post.title);
    if (debug) {
      console.log(`Scraped title="${item.title}" markdownLength=${item.markdown.length} media=${item.media.length}`);
      if (!item.markdown) console.log(`Text sample: ${item.text?.slice(0, 500) || ''}`);
    }
    if (!item.markdown) {
      console.warn(`Skipped post id ${id}: scraped markdown was empty.`);
      continue;
    }

    if (item.title) post.title = item.title;
    post.time = '방금 전';
    post.term = post.term || term;
    const postType = detectType({
      ...item,
      driveAudioUrl: post.audioUrl,
      driveVideoUrl: post.url,
    });
    post.type = postType;
    post.category = classifyCategory(item, postType, post.category);
    writeFileSync(resolve(docsDir, post.fileName), buildMarkdown(item), 'utf8');
    updated += 1;
  }

  if (!dryRun && updated > 0) {
    writeFileSync(postsPath, `${JSON.stringify(posts, null, 4)}\n`, 'utf8');
  }
  console.log(`${dryRun ? 'Dry run: ' : ''}Updated ${updated} existing posts.`);
}

function parseIdList(value) {
  if (!value) return [];
  const ids = [];
  for (const part of String(value).split(',')) {
    const trimmed = part.trim();
    const range = trimmed.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      for (let id = start; id <= end; id += 1) ids.push(id);
      continue;
    }
    const id = Number(trimmed);
    if (Number.isFinite(id)) ids.push(id);
  }
  return [...new Set(ids)];
}

function selectTargetLinks(links, existingSources) {
  if (!allNew || force) return links.slice(0, Number.isFinite(limit) ? limit * 3 : links.length);

  if (existingSources.size === 0) {
    console.log('No existing sourceUrl found in posts.json. Importing all links on the current list page.');
    return links;
  }

  const selected = [];
  for (const link of links) {
    if (existingSources.has(normalizeUrl(link.url))) {
      console.log(`Reached last imported post: ${link.url}`);
      break;
    }
    selected.push(link);
  }
  return selected;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = toCamel(arg.slice(2));
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function launchChrome({ port, profileDir, url }) {
  const chromePath = findChrome();
  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--profile-directory=Default',
    '--disable-blink-features=AutomationControlled',
    url,
  ];

  const child = spawn(chromePath, chromeArgs, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error('Chrome was not found. Set CHROME_PATH to chrome.exe and retry.');
  }
  return found;
}

async function waitForBrowser(port) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  const deadline = Date.now() + 20_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }

  throw new Error(`Chrome did not open its debugging port on ${port}: ${lastError?.message || 'timeout'}`);
}

async function openTab(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  });
  if (!response.ok) throw new Error(`Failed to open Chrome tab: HTTP ${response.status}`);
  return response.json();
}

async function waitForPage(cdp) {
  await cdp.send('Page.getNavigationHistory').catch(() => {});
  await delay(2500);
}

async function isLoginPage(cdp) {
  const result = await evaluate(cdp, () => ({
    url: location.href,
    title: document.title,
    text: document.body?.innerText?.slice(0, 2000) || '',
  }));
  return /nid\.naver\.com|login/i.test(result.url) || /네이버\s*로그인|NAVER\s*로그인|로그인/.test(result.text);
}

async function promptEnter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('');
  rl.close();
}

async function autoScroll(cdp) {
  for (let i = 0; i < 6; i += 1) {
    await evaluate(cdp, () => window.scrollTo(0, document.body.scrollHeight));
    await delay(800);
  }
  await evaluate(cdp, () => window.scrollTo(0, 0));
  await delay(500);
}

async function extractContentLinks(cdp, sourceUrl) {
  const source = new URL(sourceUrl);
  const links = await evaluate(cdp, (sourceHref) => {
    const sourceUrlObj = new URL(sourceHref);
    const seen = new Set();
    const html = document.documentElement.innerHTML || '';
    const hrefs = Array.from(document.querySelectorAll('a[href]'))
      .map((anchor) => {
        const href = new URL(anchor.getAttribute('href'), location.href).href;
        const text = (anchor.innerText || anchor.textContent || '').replace(/\s+/g, ' ').trim();
        const rect = anchor.getBoundingClientRect();
        return { href, text, top: rect.top + window.scrollY };
      });

    const regexMatches = Array.from(html.matchAll(/["'`](\/club\/13\/[^"'`<>\s]+)["'`]/g))
      .map((match) => ({
        href: new URL(match[1].replace(/\\u002F/g, '/'), location.href).href,
        text: '',
        top: Number.MAX_SAFE_INTEGER,
      }));

    return [...hrefs, ...regexMatches]
      .map((item) => ({ ...item, href: item.href.replace(/&amp;/g, '&') }))
      .filter((item) => isLikelyContentUrl(item.href, sourceUrlObj))
      .filter((item) => {
        if (seen.has(item.href)) return false;
        seen.add(item.href);
        return true;
      })
      .sort((a, b) => a.top - b.top)
      .map((item) => ({ url: item.href, title: item.text || item.href }));

    function isLikelyContentUrl(href, listUrl) {
      const url = new URL(href);
      if (url.host !== listUrl.host) return false;
      if (url.href === listUrl.href) return false;
      const isClubContent = url.pathname.includes('/club/13/');
      const isSecretContent = /^\/secrets\/\d+\/?$/.test(url.pathname);
      if (!isClubContent && !isSecretContent) return false;
      if (/login|sign|auth|notice|members|profile|payment|setting/i.test(url.pathname)) return false;
      if (url.pathname.endsWith('/contents') && url.searchParams.get('type')) return false;
      return isSecretContent || /\/contents?\/|contentId=|contentsId=|postId=|articleId=|\/contents\/?\d|\/\d+(?:\/)?$/.test(url.pathname + url.search);
    }
  }, source.href);

  if (debug) {
    console.log(`Found ${links.length} candidate links.`);
    links.slice(0, 20).forEach((link) => console.log(`- ${link.title} -> ${link.url}`));
  }

  return links;
}

async function collectPageDiagnostics(cdp) {
  return evaluate(cdp, () => {
    const anchors = Array.from(document.querySelectorAll('a[href]')).slice(0, 25).map((anchor) => ({
      text: (anchor.innerText || anchor.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      href: new URL(anchor.getAttribute('href'), location.href).href,
    }));

    const text = document.body?.innerText || '';
    return {
      url: location.href,
      title: document.title,
      textLength: text.length,
      textSample: text.replace(/\s+/g, ' ').trim().slice(0, 1200),
      anchorCount: document.querySelectorAll('a[href]').length,
      anchors,
    };
  });
}

async function scrapeContent(cdp, url, fallbackTitle = '') {
  const networkMedia = [];
  const networkHandler = (event) => {
    const media = mediaFromUrl(event?.response?.url || '', event?.response?.mimeType || '');
    if (media && !networkMedia.some((item) => item.url === media.url)) networkMedia.push(media);
  };
  cdp.on('Network.responseReceived', networkHandler);
  await cdp.send('Page.navigate', { url });
  await waitForPage(cdp);
  await autoScroll(cdp);
  const transcriptOpened = await openTranscriptIfAvailable(cdp);
  if (debug && transcriptOpened) console.log('Opened transcript panel.');

  const data = await evaluate(cdp, (fallbackTitleText) => {
    const bodyText = document.body?.innerText || '';
    const bodyTitle = extractContentTitle(bodyText);
    const provisionalTitle =
      textOf('article h1') ||
      textOf('main h1') ||
      textOf('h1') ||
      textOf('[class*="title" i]') ||
      cleanTitleFromListText(fallbackTitleText) ||
      document.querySelector('meta[property="og:title"]')?.content ||
      document.title;

    const candidates = Array.from(document.querySelectorAll('article, main, [class*="content" i], [class*="post" i], [class*="article" i], section'))
      .map((el) => ({
        html: el.innerHTML,
        text: (el.innerText || '').trim(),
        score: scoreContent(el),
      }))
      .filter((item) => item.score > 120)
      .sort((a, b) => b.score - a.score);

    const fallback = document.body ? { html: document.body.innerHTML, text: document.body.innerText || '' } : { html: '', text: '' };
    const contentTitle = bodyTitle || extractContentTitle(fallback.text || '');
    const title = contentTitle || clean(provisionalTitle);
    const selected = sliceContent(candidates, fallback, title);

    const media = Array.from(document.querySelectorAll('audio[src], video[src], source[src], iframe[src], a[href]'))
      .map((el) => el.getAttribute('src') || el.getAttribute('href'))
      .filter(Boolean)
      .map((src) => new URL(src, location.href).href)
      .filter((src) => /\.(mp3|m4a|aac|wav|mp4|m3u8|pdf)(\?|$)|audio|video|stream|pdf/i.test(src));

    return {
      sourceUrl: location.href,
      title: clean(title),
      html: selected.html,
      text: clean(selected.text),
      media,
    };

    function textOf(selector) {
      return clean(document.querySelector(selector)?.innerText || '');
    }

    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function cleanTitleFromListText(value) {
      let text = clean(value);
      if (!text) return '';
      text = text.replace(/^(약\s*)?\d+\s*(시간|일|분)\s*전\s*/i, '');
      text = text.replace(/^(방금\s*전|어제|오늘)\s*/i, '');
      text = text.replace(/\s+(글|오디오|영상)\s+.+$/, '');
      text = text.replace(/\s+\d+\s*(읽음|안읽음)\s*$/, '');
      return text.trim();
    }

    function extractContentTitle(text) {
      const lines = String(text || '')
        .split(/\r?\n/)
        .map((line) => clean(line))
        .filter(Boolean);

      const episodeTitle = lines.find((line) => new RegExp('^\\d+\\s*\\uD654\\.\\s+').test(line));
      if (episodeTitle) return episodeTitle;

      const compact = clean(text);
      const episodeMatch = compact.match(new RegExp('(\\d+\\s*\\uD654\\.\\s+.*?)(?=\\s+(?:\\uC624\\uB514\\uC624|\\uC601\\uC0C1|\\uAE00|\\uC2A4\\uD06C\\uB9BD\\uD2B8\\s*\\uBCF4\\uAE30|Beta|\\uD22C\\uC790\\s*\\uC720\\uC758\\uC0AC\\uD56D)|$)'));
      if (episodeMatch) return clean(episodeMatch[1]);

      return '';
    }

    function scoreContent(el) {
      const text = (el.innerText || '').trim();
      let score = text.length;
      if (extractContentTitle(text)) score += 20000;
      if (new RegExp('\\uD22C\\uC790\\s*\\uC720\\uC758\\uC0AC\\uD56D\\s*\\uD3BC\\uCE58\\uAE30').test(text)) score += 5000;
      if (el.querySelector('audio, video, source, iframe')) score += 1500;
      if (el.querySelector('img')) score += 750;
      return score;
    }

    function sliceContent(candidateContents, fallbackContent, titleText) {
      const rangeContent = extractRangeContent(titleText);
      if (rangeContent.text.length > 20 || rangeContent.html.includes('<img')) return rangeContent;

      const selectedContent = candidateContents.find((candidate) => extractContentTitle(candidate.text)) || candidateContents[0] || fallbackContent;
      const host = document.createElement('div');
      host.innerHTML = selectedContent.html || '';
      normalizeImages(host);

      const titleNeedle = clean(titleText);
      const nodes = Array.from(host.querySelectorAll('h1,h2,h3,h4,p,div,span,section,article,button'));
      const episodePattern = new RegExp('^\\d+\\s*\\uD654\\.\\s+');
      const titleNode = nodes.find((node) => {
        const text = clean(node.innerText || node.textContent || '');
        return text === titleNeedle || episodePattern.test(text);
      });
      if (titleNode) {
        trimBeforeAndIncluding(host, titleNode);
      }

      const cautionPattern = new RegExp('\\uD22C\\uC790\\s*\\uC720\\uC758\\uC0AC\\uD56D\\s*\\uD3BC\\uCE58\\uAE30');
      const cautionNode = Array.from(host.querySelectorAll('*')).find((node) => cautionPattern.test(clean(node.innerText || node.textContent || '')));
      if (cautionNode) {
        trimFromNode(host, cautionNode);
      }

      let html = host.innerHTML;
      let text = clean(host.innerText || host.textContent || '');
      if (text.length < 20 && !host.querySelector('img')) {
        const slicedText = extractExactTextContent(document.body?.innerText || '', titleNeedle) || sliceText(selectedContent.text || '', titleNeedle);
        html = escapeHtml(slicedText).replace(/\n/g, '<br>');
        text = clean(slicedText);
      }
      return { html, text };
    }

    function extractExactTextContent(fullText, titleText) {
      let text = String(fullText || '').replace(/\r\n/g, '\n');
      const titleNeedle = clean(titleText);
      let start = titleNeedle ? text.indexOf(titleNeedle) : -1;
      if (start >= 0) {
        text = text.slice(start + titleNeedle.length);
      } else {
        const titleMatch = text.match(new RegExp('\\d+\\s*\\uD654\\.\\s+[^\\n]+'));
        if (!titleMatch) return '';
        text = text.slice((titleMatch.index || 0) + titleMatch[0].length);
      }

      text = text.replace(/^[\s\n]*(?:\\uC624\\uB514\\uC624|\\uC601\\uC0C1|\\uAE00)?[\s\n]*/u, '');

      const stopPatterns = [
        '\\uD22C\\uC790\\s*\\uC720\\uC758\\uC0AC\\uD56D\\s*\\uD3BC\\uCE58\\uAE30',
        '\\n\\s*\\uB313\\uAE00\\b',
        '\\n\\s*\\uC751\\uC6D0\\b',
        '\\n\\s*\\uC88B\\uC544\\uC694\\b',
        '\\n\\s*\\uBD81\\uB9C8\\uD06C\\b',
        '\\n\\s*Source:',
      ];
      const stopIndexes = stopPatterns
        .map((pattern) => {
          const match = text.match(new RegExp(pattern));
          return match ? match.index : -1;
        })
        .filter((index) => index >= 0);
      if (stopIndexes.length > 0) text = text.slice(0, Math.min(...stopIndexes));

      text = text
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (text.length < 20) return '';
      if (/\\uCD94\\uCC9C\\uC0C1\\uD488|\\uAD6C\\uB3C5\\s*\\uC911\\uC778|\\uC804\\uCCB4\\uBCF4\\uAE30/u.test(text.slice(0, 300))) return '';
      return text;
    }

    function textToHtml(text) {
      return String(text)
        .split(/\n{2,}/)
        .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
        .join('\n');
    }

    function extractRangeContent(titleText) {
      const allNodes = Array.from(document.querySelectorAll('h1,h2,h3,h4,p,div,span,strong,b'));
      const episodePattern = new RegExp('^\\d+\\s*\\uD654\\.\\s+');
      const titleNode = allNodes
        .map((node) => ({ node, text: clean(node.innerText || node.textContent || '') }))
        .filter((item) => item.text === titleText || episodePattern.test(item.text))
        .sort((a, b) => a.text.length - b.text.length)[0]?.node;
      if (!titleNode) return { html: '', text: '' };

      const stopPattern = new RegExp([
        '\\uD22C\\uC790\\s*\\uC720\\uC758\\uC0AC\\uD56D\\s*\\uD3BC\\uCE58\\uAE30',
        '^\\uB313\\uAE00',
        '^\\uC751\\uC6D0',
        '^\\uC88B\\uC544\\uC694',
        '^\\uBAA9\\uB85D',
        '^\\uACF5\\uC720',
        '^\\uBD81\\uB9C8\\uD06C',
      ].join('|'));
      const ordered = Array.from(document.body.querySelectorAll('h1,h2,h3,h4,p,div,span,section,article,img,figure,video,audio,iframe'));
      const titleIndex = ordered.indexOf(titleNode);
      const likeBodyStart = findBodyStartAfterLikeImage(ordered, titleIndex);
      const stopNode = ordered.slice(Math.max(titleIndex + 1, 0)).find((node) => {
        if (node.tagName === 'IMG') return false;
        return stopPattern.test(clean(node.innerText || node.textContent || ''));
      });

      const range = document.createRange();
      if (likeBodyStart) {
        range.setStartBefore(likeBodyStart);
      } else {
        range.setStartAfter(titleNode);
      }
      if (stopNode) {
        range.setEndBefore(stopNode);
      } else {
        const root = closestContentRoot(titleNode);
        range.setEndAfter(root);
      }

      const wrapper = document.createElement('div');
      wrapper.appendChild(range.cloneContents());
      normalizeImages(wrapper);
      removeAudioPlayerControls(wrapper);
      removeNoise(wrapper);
      removeMetaLines(wrapper);
      removeTitleLikeNodes(wrapper);
      return {
        html: wrapper.innerHTML,
        text: clean(wrapper.innerText || wrapper.textContent || ''),
      };
    }

    function findBodyStartAfterLikeImage(ordered, titleIndex) {
      const searchStart = Math.max(titleIndex + 1, 0);
      const afterTitle = ordered.slice(searchStart);
      const likeIndex = afterTitle.findIndex((node) => {
        if (node.tagName !== 'IMG') return false;
        const src = node.getAttribute('src') || '';
        const alt = node.getAttribute('alt') || '';
        return /heart_gradient\.svg/i.test(src) || /^like$/i.test(alt);
      });
      if (likeIndex < 0) return null;

      for (const node of afterTitle.slice(likeIndex + 1)) {
        if (node.tagName === 'IMG') {
          const src = node.getAttribute('src') || node.getAttribute('data-src') || node.getAttribute('data-original') || '';
          const alt = node.getAttribute('alt') || '';
          if (!src) continue;
          if (/\.svg(\?|$)/i.test(src)) continue;
          if (/^(like|bookmark|window top scroll button|more|arrow|heart)$/i.test(alt)) continue;
          return node;
        }

        const text = clean(node.innerText || node.textContent || '');
        if (text && !/^\d{1,6}$/.test(text) && !/^(like|읽음|안읽음)$/i.test(text)) {
          return node;
        }
      }
      return null;
    }

    function closestContentRoot(node) {
      let current = node;
      while (current.parentElement && current.parentElement !== document.body) {
        const text = clean(current.parentElement.innerText || '');
        if (text.length > 300 && text.length < 20000) return current.parentElement;
        current = current.parentElement;
      }
      return current;
    }

    function removeNoise(root) {
      const noisePattern = new RegExp([
        '\\uD22C\\uC790\\s*\\uC720\\uC758\\uC0AC\\uD56D\\s*\\uD3BC\\uCE58\\uAE30',
        '^\\uB313\\uAE00',
        '^\\uC751\\uC6D0',
        '^\\uC88B\\uC544\\uC694',
        '^\\uBD81\\uB9C8\\uD06C',
        '^\\uCC3D\\s*\\uB2EB\\uAE30',
      ].join('|'));
      Array.from(root.querySelectorAll('*')).forEach((node) => {
        const text = clean(node.innerText || node.textContent || '');
        if (noisePattern.test(text)) trimFromNode(root, node);
      });
    }

    function removeMetaLines(root) {
      const metaPattern = new RegExp([
        '^\\uC11C\\uC7AC\\uD615\\uC758\\s*\\uD22C\\uC790\\uD559\\uAD50$',
        '^(?:\\uC57D\\s*)?\\d+\\s*(?:\\uBD84|\\uC2DC\\uAC04|\\uC77C)\\s*\\uC804$',
        '^like$',
        '^\\d{1,6}$',
        '^\\uC77D\\uC74C$',
        '^\\uC548\\uC77D\\uC74C$',
      ].join('|'), 'i');

      Array.from(root.querySelectorAll('h1,h2,h3,h4,p,div,span,strong,b,button')).forEach((node) => {
        if (node.querySelector('img, video, audio, iframe')) return;
        const text = clean(node.innerText || node.textContent || '');
        if (metaPattern.test(text)) node.remove();
      });

      root.innerHTML = root.innerHTML
        .replace(/(?:^|<br\s*\/?>)\s*서재형의 투자학교\s*(?=<br\s*\/?>|$)/g, '')
        .replace(/(?:^|<br\s*\/?>)\s*(?:약\s*)?\d+\s*(?:분|시간|일)\s*전\s*(?=<br\s*\/?>|$)/g, '')
        .replace(/(?:^|<br\s*\/?>)\s*like\s*(?=<br\s*\/?>|$)/gi, '')
        .replace(/(?:^|<br\s*\/?>)\s*\d{1,6}\s*(?=<br\s*\/?>|$)/g, '');
    }

    function removeAudioPlayerControls(root) {
      const playerImagePattern = /IC_(?:skip|rewind|AudioPlay|forward)|speedometer\.svg/i;
      const playerTextPattern = /^(?:\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}|속도\s*\([^)]*\)|스크립트\s*보기\s*Beta)$/i;

      Array.from(root.querySelectorAll('img')).forEach((img) => {
        const src = img.getAttribute('src') || '';
        const alt = img.getAttribute('alt') || '';
        if (playerImagePattern.test(src) || /skip|rewind|play\/pause|forward|speed/i.test(alt)) {
          img.remove();
        }
      });

      Array.from(root.querySelectorAll('h1,h2,h3,h4,p,div,span,strong,b,button')).forEach((node) => {
        if (node.querySelector('img, video, audio, iframe')) return;
        const text = clean(node.innerText || node.textContent || '');
        if (playerTextPattern.test(text)) node.remove();
      });
    }

    function removeTitleLikeNodes(root) {
      const episodePattern = new RegExp('^\\d+\\s*\\uD654\\.\\s+');
      Array.from(root.querySelectorAll('h1,h2,h3,h4,p,div,span,strong,b')).forEach((node) => {
        const text = clean(node.innerText || node.textContent || '');
        if (episodePattern.test(text)) node.remove();
      });
    }

    function sliceText(text, titleNeedle) {
      let sliced = String(text || '');
      const titleIndex = titleNeedle ? sliced.indexOf(titleNeedle) : -1;
      if (titleIndex >= 0) sliced = sliced.slice(titleIndex + titleNeedle.length);
      if (titleIndex < 0) {
        const episodeMatch = sliced.match(new RegExp('\\d+\\s*\\uD654\\.\\s+.*?(?:\\r?\\n|$)'));
        if (episodeMatch) sliced = sliced.slice((episodeMatch.index || 0) + episodeMatch[0].length);
      }
      const cautionMatch = sliced.match(new RegExp('\\uD22C\\uC790\\s*\\uC720\\uC758\\uC0AC\\uD56D\\s*\\uD3BC\\uCE58\\uAE30'));
      if (cautionMatch) sliced = sliced.slice(0, cautionMatch.index);
      return sliced.trim();
    }

    function trimBeforeAndIncluding(root, node) {
      let current = node;
      while (current && current.parentElement && current.parentElement !== root) {
        current = current.parentElement;
      }
      while (current && current.previousSibling) current.previousSibling.remove();
      if (current) current.remove();
    }

    function trimFromNode(root, node) {
      let current = node;
      while (current && current.parentElement && current.parentElement !== root) {
        current = current.parentElement;
      }
      while (current) {
        const next = current.nextSibling;
        current.remove();
        current = next;
      }
    }

    function normalizeImages(root) {
      root.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original') || '';
        if (src) img.setAttribute('src', new URL(src, location.href).href);
        img.removeAttribute('srcset');
      });
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  }, fallbackTitle);
  await delay(2000);
  cdp.off('Network.responseReceived', networkHandler);

  const markdown = cleanupMarkdown(turndown.turndown(data.html || data.text || ''));
  const domMedia = data.media.map((url) => mediaFromUrl(url, '')).filter(Boolean);
  return {
    ...data,
    title: cleanupTitle(data.title),
    markdown,
    media: dedupeMedia([...domMedia, ...networkMedia]),
  };
}

async function openTranscriptIfAvailable(cdp) {
  const result = await evaluate(cdp, () => {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, div, span'))
      .filter((node) => /스크립트\s*보기|script/i.test((node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim()))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          node,
          text: (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(),
          visible: rect.width > 0 && rect.height > 0,
          area: rect.width * rect.height,
        };
      })
      .filter((item) => item.visible)
      .sort((a, b) => a.area - b.area);

    const target = candidates[0]?.node;
    if (!target) return false;
    target.scrollIntoView({ block: 'center', inline: 'center' });
    target.click();
    return true;
  });

  if (!result) return false;
  await delay(2500);
  await autoScroll(cdp);
  return true;
}

function buildMarkdown(item) {
  return `${item.markdown}`.trimEnd() + '\n';
}

function cleanupTitle(title) {
  return String(title || '')
    .replace(/\s*[-|:]\s*(US-?Insight|us-insight).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanupMarkdown(markdown) {
  return String(markdown || '')
    .replace(/^\s*\d{1,2}:\d{2}\\?-\d{1,2}:\d{2}\s*$/gm, '')
    .replace(/^!\[[^\]]*(?:skip to start|rewind|play\/pause|forward|speed)[^\]]*\]\([^)]+\)\s*$/gim, '')
    .replace(/^!\[[^\]]*\]\([^)]*(?:IC_(?:skip|rewind|AudioPlay|forward)|speedometer\.svg)[^)]*\)\s*$/gim, '')
    .replace(/^\s*속도\s*\([^)]*\)\s*$/gm, '')
    .replace(/^\s*스크립트\s*보기\s*Beta\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s*(login|sign up|notification|menu|NAVER)\s*$/gim, '')
    .trim();
}

function detectType(item) {
  if (item.driveVideoUrl) return 'video';
  if (item.driveAudioUrl) return 'audio';
  const mediaText = item.media.map((media) => `${media.kind}:${media.url}`).join('\n');
  if (/\.(mp4|m3u8)(\?|$)|video/i.test(mediaText)) return 'video';
  if (/\.(mp3|m4a|aac|wav)(\?|$)|audio/i.test(mediaText)) return 'audio';
  return 'text';
}

function classifyCategory(item, postType, fallbackCategory) {
  const haystack = [
    item.title,
    item.sourceUrl,
    item.markdown,
    ...item.media.map((media) => `${media.kind}:${media.url}:${media.mimeType}`),
  ].join('\n');

  if (postType === 'video' || hasPdf(item) || /\.pdf(\?|$)|pdf/i.test(haystack)) {
    return '기업분석도감';
  }
  if (postType === 'audio') return '굿모닝 담샘';
  if (postType === 'text') return '언제나 데이트';
  return fallbackCategory || '언제나 데이트';
}

function hasPdf(item) {
  return item.media.some((media) => media.kind === 'pdf' || /\.pdf(\?|$)/i.test(media.url) || /pdf/i.test(media.mimeType));
}

function mediaFromUrl(url, mimeType) {
  if (!url || /^blob:/i.test(url) || /^data:/i.test(url)) return null;
  const cleanUrl = String(url);
  if (/\.(mp3|m4a|aac|wav)(\?|$)|audio\//i.test(`${cleanUrl} ${mimeType}`)) {
    return { kind: 'audio', url: cleanUrl, mimeType: mimeType || guessMimeType(cleanUrl) || 'audio/mpeg' };
  }
  if (/\.(mp4|m3u8)(\?|$)|video\//i.test(`${cleanUrl} ${mimeType}`)) {
    return { kind: 'video', url: cleanUrl, mimeType: mimeType || guessMimeType(cleanUrl) || 'video/mp4' };
  }
  if (/\.pdf(\?|$)|application\/pdf|pdf/i.test(`${cleanUrl} ${mimeType}`)) {
    return { kind: 'pdf', url: cleanUrl, mimeType: mimeType || 'application/pdf' };
  }
  return null;
}

function dedupeMedia(media) {
  const seen = new Set();
  return media.filter((item) => {
    if (!item || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

async function uploadDetectedMedia(item, cdp) {
  const media = item.media.find((entry) => entry.kind === 'video') || item.media.find((entry) => entry.kind === 'audio');
  if (!media) return;

  console.log(`Downloading media for upload: ${media.url}`);
  const headers = await browserHeaders(cdp, item.sourceUrl);
  const extension = extensionForMedia(media);
  const localPath = resolve(tempDir, `${sanitizeFilename(item.title).slice(0, 80) || 'media'}-${Date.now()}${extension}`);
  const mimeType = media.mimeType.includes('mpegurl') || media.url.includes('.m3u8')
    ? 'video/mp2t'
    : media.mimeType || guessMimeType(localPath) || 'application/octet-stream';

  if (media.url.includes('.m3u8')) {
    await downloadHls(media.url, localPath, headers);
  } else {
    await downloadBinary(media.url, localPath, headers);
  }

  const drive = await uploadToDrive(localPath, `${sanitizeFilename(item.title)}${extension}`, mimeType);
  if (media.kind === 'video') item.driveVideoUrl = `https://drive.google.com/file/d/${drive.id}/preview`;
  if (media.kind === 'audio') item.driveAudioUrl = `https://drive.google.com/file/d/${drive.id}`;
  rmSync(localPath, { force: true });
}

async function browserHeaders(cdp, referer) {
  const cookiesResult = await cdp.send('Network.getAllCookies').catch(() => ({ cookies: [] }));
  const userAgent = await evaluate(cdp, () => navigator.userAgent);
  return {
    Cookie: cookiesResult.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
    Referer: referer,
    'User-Agent': userAgent,
  };
}

async function downloadBinary(url, outputPath, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Media download failed: HTTP ${response.status} ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(outputPath, buffer);
}

async function downloadHls(url, outputPath, headers) {
  const firstResponse = await fetch(url, { headers });
  if (!firstResponse.ok) throw new Error(`HLS playlist download failed: HTTP ${firstResponse.status} ${url}`);
  let playlistUrl = url;
  let playlist = await firstResponse.text();
  const variant = chooseVariant(playlist, playlistUrl);
  if (variant) {
    playlistUrl = variant;
    const variantResponse = await fetch(playlistUrl, { headers });
    if (!variantResponse.ok) throw new Error(`HLS variant download failed: HTTP ${variantResponse.status} ${playlistUrl}`);
    playlist = await variantResponse.text();
  }

  const segmentUrls = playlist
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => new URL(line, playlistUrl).href);

  const buffers = [];
  for (const segmentUrl of segmentUrls) {
    const response = await fetch(segmentUrl, { headers });
    if (!response.ok) throw new Error(`HLS segment download failed: HTTP ${response.status} ${segmentUrl}`);
    buffers.push(Buffer.from(await response.arrayBuffer()));
  }
  writeFileSync(outputPath, Buffer.concat(buffers));
}

function chooseVariant(playlist, playlistUrl) {
  const lines = playlist.split(/\r?\n/);
  let best = null;
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const bandwidth = Number(lines[i].match(/BANDWIDTH=(\d+)/)?.[1] || 0);
    const next = lines.slice(i + 1).find((line) => line.trim() && !line.startsWith('#'));
    if (next && (!best || bandwidth > best.bandwidth)) {
      best = { bandwidth, url: new URL(next.trim(), playlistUrl).href };
    }
  }
  return best?.url || null;
}

async function uploadToDrive(filePath, fileName, mimeType) {
  const accessToken = await getGoogleAccessToken();
  const metadata = { name: fileName };
  if (gdriveFolderId) metadata.parents = [gdriveFolderId];

  const boundary = `stock-study-${Date.now()}`;
  const fileBuffer = readFileSync(filePath);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  });
  if (!response.ok) throw new Error(`Google Drive upload failed: HTTP ${response.status} ${await response.text()}`);
  const file = await response.json();

  await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'anyone', role: 'reader' }),
  });
  return file;
}

async function getGoogleAccessToken() {
  const tokenPath = resolve(rootDir, 'token.json');
  const token = readJson(tokenPath);
  const response = await fetch(token.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: token.client_id,
      client_secret: token.client_secret,
      refresh_token: token.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) throw new Error(`Google token refresh failed: HTTP ${response.status} ${await response.text()}`);
  const refreshed = await response.json();
  return refreshed.access_token;
}

function extensionForMedia(media) {
  if (media.url.includes('.m3u8')) return '.mp4';
  const match = new URL(media.url).pathname.match(/\.(mp3|m4a|aac|wav|mp4)$/i);
  if (match) return `.${match[1].toLowerCase()}`;
  return media.kind === 'audio' ? '.mp3' : '.mp4';
}

function guessMimeType(pathOrUrl) {
  const value = String(pathOrUrl).toLowerCase();
  if (value.includes('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (value.endsWith('.mp4')) return 'video/mp4';
  if (value.endsWith('.m4a')) return 'audio/mp4';
  if (value.endsWith('.aac')) return 'audio/aac';
  if (value.endsWith('.wav')) return 'audio/wav';
  if (value.endsWith('.mp3')) return 'audio/mpeg';
  return '';
}

function sanitizeFilename(value) {
  return String(value || 'media').replace(/[\/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function normalizeUrl(url) {
  if (!url) return '';
  const parsed = new URL(url);
  parsed.hash = '';
  parsed.searchParams.sort();
  return parsed.href.replace(/\/$/, '');
}

function normalizeTitle(title) {
  return String(title || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function evaluate(cdp, fn, ...args) {
  const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

class CDPClient {
  static connect(url) {
    return new Promise((resolveConnect, reject) => {
      const ws = new WebSocket(url);
      const client = new CDPClient(ws);
      ws.addEventListener('open', () => resolveConnect(client), { once: true });
      ws.addEventListener('error', (event) => reject(event.error || new Error('WebSocket connection failed')), { once: true });
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();

    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method) {
        const listeners = this.listeners.get(message.method) || [];
        listeners.forEach((listener) => listener(message.params || {}));
      }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result || {});
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject });
      this.ws.send(payload);
    });
  }

  close() {
    this.ws.close();
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  off(method, listener) {
    const listeners = this.listeners.get(method) || [];
    this.listeners.set(method, listeners.filter((item) => item !== listener));
  }
}
