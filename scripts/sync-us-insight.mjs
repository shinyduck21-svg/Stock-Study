import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
const DEFAULT_SCAN_LIMIT = 15;
const DEFAULT_GDRIVE_FOLDER_ID = '1v9H6SxCxIelFLW_nfDkOYjZFX3t_3nNC';
const DEFAULT_PDF_GDRIVE_FOLDER_ID = '1EkXlDqs50uyvS-UHcOP9RtoiCY-7Yg1L';

const args = parseArgs(process.argv.slice(2));
const sourceUrl = args.source || DEFAULT_SOURCE;
const allNew = Boolean(args.sinceLast || args.allNew || args.new);
const limit = allNew && !args.limit ? Number.POSITIVE_INFINITY : Number.parseInt(args.limit || '10', 10);
const scanLimit = Number.parseInt(args.scanLimit || String(DEFAULT_SCAN_LIMIT), 10);
const category = args.category || DEFAULT_CATEGORY;
const term = args.term || DEFAULT_TERM;
const profileDir = resolve(rootDir, args.profileDir || DEFAULT_PROFILE_DIR);
const port = Number.parseInt(args.port || String(DEFAULT_PORT), 10);
const headless = parseBooleanFlag(
  args.headless,
  process.env.CHROME_HEADLESS || process.env.HEADLESS_CHROME,
  process.platform !== 'win32',
);
const dryRun = Boolean(args.dryRun);
const debug = Boolean(args.debug);
const force = Boolean(args.force);
const skipMedia = Boolean(args.skipMedia);
const updateTranscripts = Boolean(args.updateTranscripts || args.updateTranscript);
const gdriveFolderId = args.gdriveFolderId || DEFAULT_GDRIVE_FOLDER_ID;
const pdfGdriveFolderId = args.pdfGdriveFolderId || process.env.PDF_GDRIVE_FOLDER_ID || DEFAULT_PDF_GDRIVE_FOLDER_ID;
const publicBaseUrl = normalizePublicBaseUrl(args.publicBaseUrl || process.env.PUBLIC_SITE_URL || 'https://shinyduck21-svg.github.io/Stock-Study/');
const updateIds = parseIdList(args.updateIds || args.updateId || '');
const probeMediaIds = parseIdList(args.probeMediaIds || args.probeMediaId || '');

const postsPath = resolve(rootDir, 'public/data/posts.json');
const docsDir = resolve(rootDir, 'public/docs');
const tempDir = resolve(rootDir, 'temp_media');
const TRANSCRIPT_HEADING = '## \uC2A4\uD06C\uB9BD\uD2B8';

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
  if (!Number.isFinite(scanLimit) || scanLimit < 1) {
    throw new Error('--scan-limit must be a positive number.');
  }

  let chromeChild = null;
  let cdp = null;
  try {
  ensureDir(profileDir);
  chromeChild = launchChrome({ port, profileDir, url: sourceUrl, headless });

  const browser = await waitForBrowser(port);
  const tabInfo = await openTab(port, sourceUrl);
  cdp = await CDPClient.connect(tabInfo.webSocketDebuggerUrl);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await waitForPage(cdp);

  if (await isLoginPage(cdp)) {
    if (headless || !process.stdin.isTTY) {
      throw new Error('Naver login is required, but this run is non-interactive. Refresh chrome_profile on the VPS or run with CHROME_HEADLESS=0 and complete login manually.');
    }
    console.log('\nNaver login is required.');
    console.log('Finish the login in the Chrome window that opened, return here, then press Enter.');
    await promptEnter();
    await cdp.send('Page.navigate', { url: sourceUrl });
    await waitForPage(cdp);
  }

  const posts = readJson(postsPath);

  if (probeMediaIds.length > 0) {
    await probeExistingPostMedia({ cdp, posts, ids: probeMediaIds });
    return;
  }

  if (updateTranscripts) {
    await updateTranscriptSections({ cdp, posts });
    return;
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

  if (updateIds.length > 0) {
    await updateExistingPosts({ cdp, posts, ids: updateIds });
    return;
  }

  const existingSources = new Set(posts.map((post) => normalizeUrl(post.sourceUrl)).filter(Boolean));
  const existingTitles = new Set(posts.map((post) => normalizeTitle(post.title)).filter(Boolean));
  const targetLinks = selectTargetLinks(links, existingSources);

  if (!dryRun && !skipMedia) {
    const postsBySource = new Map(posts
      .filter((post) => post.sourceUrl)
      .map((post) => [normalizeUrl(post.sourceUrl), post]));
    const missingMorningAudioIds = targetLinks
      .map((link) => postsBySource.get(normalizeUrl(link.url)))
      .filter((post) => post && isGoodMorningEpisodeTitle(post.title) && !post.audioUrl)
      .map((post) => Number(post.id));
    if (missingMorningAudioIds.length > 0) {
      console.log(`Retrying missing Good Morning audio for posts: ${missingMorningAudioIds.join(', ')}`);
      await updateExistingPosts({ cdp, posts, ids: missingMorningAudioIds });
    }
  }

  if (debug && allNew) {
    console.log(`Selected ${targetLinks.length} links from the latest scan window.`);
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
      item.media.forEach((media) => console.log(`Detected ${media.kind} media: ${media.url}`));
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
    if (isGoodMorningEpisodeTitle(item.title) && !item.media.some((media) => media.kind === 'audio')) {
      console.warn(`Deferred Good Morning post because audio is not ready: ${item.sourceUrl}`);
      continue;
    }
    newItems.push(item);
  }

  if (newItems.length === 0) {
    console.log('No new posts to import.');
    return;
  }

  if (!dryRun && !skipMedia) {
    ensureDir(tempDir);
    const existingAnalysisPdfCount = countSummerAnalysisPdfPosts(posts);
    let pdfUploadIndex = 0;
    for (const item of newItems) {
      if (hasPdf(item)) pdfUploadIndex += 1;
      await uploadDetectedMedia(item, cdp, {
        pdfOrdinal: koreanOrdinalFromTitle(item.title) || koreanOrdinal(existingAnalysisPdfCount + pdfUploadIndex),
        requiredKind: isGoodMorningEpisodeTitle(item.title) ? 'audio' : undefined,
      });
      if (isGoodMorningEpisodeTitle(item.title) && !item.driveAudioUrl) {
        throw new Error(`Good Morning audio upload did not complete: ${item.sourceUrl}`);
      }
      if (isRegularClassRecordingTitle(item.title) && !item.driveVideoUrl) {
        throw new Error(`Regular class recording video was not detected: ${item.sourceUrl}`);
      }
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
    if (item.drivePdfUrl) post.pdfUrl = item.drivePdfUrl;

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
    printImportNotification(additions, { dryRun: true });
    return;
  }

  for (const addition of additions) {
    writeFileSync(resolve(docsDir, addition.fileName), addition.markdown, 'utf8');
  }

  const nextPosts = mergePostsInScanOrder({ posts, additions, targetLinks });
  writeFileSync(postsPath, `${JSON.stringify(nextPosts, null, 4)}\n`, 'utf8');
  console.log(`Imported ${additions.length} posts.`);
  additions.forEach(({ post }) => console.log(`- #${post.id} ${post.title}`));
  printImportNotification(additions);
  } finally {
    await closeBrowser(cdp, chromeChild);
  }
}

function printImportNotification(additions, { dryRun: isPreview = false } = {}) {
  const posts = additions.map((addition) => addition.post);
  const prefix = isPreview ? '[미리보기] ' : '';
  const lines = [
    '',
    '----- 알림 복사용 메시지 -----',
    `${prefix}[주식 투자 고수방] 새 글 ${posts.length}개가 올라왔습니다.`,
    '',
  ];

  posts.forEach((post, index) => {
    lines.push(`${index + 1}. ${post.title}`);
    lines.push(postUrl(post.id));
    if (index < posts.length - 1) lines.push('');
  });

  lines.push('-----------------------------');
  console.log(lines.join('\n'));
}

function postUrl(postId) {
  const hash = `#post-${postId}`;
  if (!publicBaseUrl) return hash;
  return `${publicBaseUrl}${hash}`;
}

function normalizePublicBaseUrl(value) {
  const baseUrl = String(value || '').trim();
  if (!baseUrl) return '';
  if (baseUrl.endsWith('/')) return baseUrl;
  return `${baseUrl}/`;
}

async function updateTranscriptSections({ cdp, posts }) {
  const candidates = posts
    .filter((post) => post?.sourceUrl && post?.fileName)
    .filter((post) => updateIds.length === 0 || updateIds.includes(Number(post.id)))
    .filter((post) => force || !hasTranscriptSection(readDocIfExists(post.fileName)));
  const targetPosts = candidates.slice(0, Number.isFinite(limit) ? limit : candidates.length);

  let checked = 0;
  let found = 0;
  let updated = 0;
  let skippedExisting = 0;
  let missingDoc = 0;
  const failures = [];

  console.log(`${dryRun ? 'Dry run: ' : ''}checking ${targetPosts.length} posts for transcript sections.`);

  for (const post of targetPosts) {
    checked += 1;
    const docPath = resolve(docsDir, post.fileName);
    if (!existsSync(docPath)) {
      missingDoc += 1;
      console.warn(`- #${post.id} missing markdown file: ${post.fileName}`);
      continue;
    }

    const currentMarkdown = readFileSync(docPath, 'utf8');
    if (!force && hasTranscriptSection(currentMarkdown)) {
      skippedExisting += 1;
      if (debug) console.log(`- #${post.id} already has transcript`);
      continue;
    }

    console.log(`Checking #${post.id}: ${post.title || post.sourceUrl}`);
    try {
      const transcriptMarkdown = await scrapeTranscriptOnly(cdp, post.sourceUrl);
      if (!transcriptMarkdown) {
        if (debug) console.log(`- #${post.id} no transcript`);
        continue;
      }

      found += 1;
      const nextMarkdown = upsertTranscriptSection(currentMarkdown, transcriptMarkdown);
      if (nextMarkdown === currentMarkdown) {
        if (debug) console.log(`- #${post.id} transcript unchanged`);
        continue;
      }

      if (dryRun) {
        console.log(`- #${post.id} would update transcript (${transcriptMarkdown.length} chars)`);
      } else {
        writeFileSync(docPath, nextMarkdown, 'utf8');
        console.log(`- #${post.id} updated transcript (${transcriptMarkdown.length} chars)`);
      }
      updated += 1;
    } catch (error) {
      failures.push({ id: post.id, sourceUrl: post.sourceUrl, message: error?.message || String(error) });
      console.warn(`- #${post.id} failed: ${error?.message || error}`);
    }
  }

  console.log('');
  console.log(`${dryRun ? 'Dry run: ' : ''}checked=${checked} found=${found} updated=${updated} skippedExisting=${skippedExisting} missingDoc=${missingDoc} failed=${failures.length}`);
  if (failures.length > 0) {
    console.log('Failures:');
    failures.forEach((failure) => console.log(`- #${failure.id} ${failure.sourceUrl}: ${failure.message}`));
  }
}

async function scrapeTranscriptOnly(cdp, url) {
  await cdp.send('Page.navigate', { url });
  await waitForPage(cdp);
  await autoScroll(cdp);
  const beforeTranscriptText = await evaluate(cdp, () => document.body?.innerText || '');
  const transcriptOpened = await openTranscriptIfAvailableStable(cdp);
  if (!transcriptOpened) return '';
  if (debug) console.log('Opened transcript panel.');
  return extractTranscriptMarkdown(cdp, beforeTranscriptText);
}

function readDocIfExists(fileName) {
  const docPath = resolve(docsDir, fileName);
  if (!existsSync(docPath)) return '';
  return readFileSync(docPath, 'utf8');
}

function hasTranscriptSection(markdown) {
  return /^##\s*\uC2A4\uD06C\uB9BD\uD2B8\s*$/m.test(String(markdown || ''));
}

function upsertTranscriptSection(markdown, transcriptMarkdown) {
  const body = String(markdown || '').trimEnd();
  const transcript = String(transcriptMarkdown || '').trim();
  if (!transcript) return `${body}\n`;

  const headingPattern = /^##\s*\uC2A4\uD06C\uB9BD\uD2B8\s*$/m;
  const match = body.match(headingPattern);
  const nextSection = `${TRANSCRIPT_HEADING}\n\n${transcript}`;
  if (!match) return `${body}\n\n${nextSection}\n`;

  const before = body.slice(0, match.index).trimEnd();
  const afterStart = match.index + match[0].length;
  const after = body.slice(afterStart);
  const nextHeading = after.match(/\n##\s+/);
  const suffix = nextHeading ? after.slice(nextHeading.index).trimStart() : '';
  return [before, nextSection, suffix].filter(Boolean).join('\n\n').trimEnd() + '\n';
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
      item.media.forEach((media) => console.log(`Detected ${media.kind} media: ${media.url}`));
      if (!item.markdown) console.log(`Text sample: ${item.text?.slice(0, 500) || ''}`);
    }
    if (!item.markdown) {
      console.warn(`Skipped post id ${id}: scraped markdown was empty.`);
      continue;
    }

    if (!dryRun && !skipMedia && isGoodMorningEpisodeTitle(item.title || post.title) && !post.audioUrl) {
      if (!item.media.some((media) => media.kind === 'audio')) {
        console.warn(`Good Morning audio is still not ready for post ${id}; retrying on the next sync.`);
        continue;
      }
      await uploadDetectedMedia(item, cdp, { uploadPdf: false, requiredKind: 'audio' });
      if (!item.driveAudioUrl) {
        throw new Error(`Good Morning audio upload did not complete: ${post.sourceUrl}`);
      }
      post.audioUrl = item.driveAudioUrl;
    }

    if (!dryRun && !skipMedia && isRegularClassRecordingTitle(item.title || post.title) && !post.url) {
      await uploadDetectedMedia(item, cdp, { uploadPdf: false });
      if (!item.driveVideoUrl) {
        throw new Error(`Regular class recording video was not detected: ${post.sourceUrl}`);
      }
      post.url = item.driveVideoUrl;
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
    if (!dryRun) writeFileSync(resolve(docsDir, post.fileName), buildMarkdown(item), 'utf8');
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

  const windowSize = Math.min(scanLimit, links.length);
  console.log(`Scanning latest ${windowSize} links for missing posts.`);
  return links.slice(0, windowSize);
}

function mergePostsInScanOrder({ posts, additions, targetLinks }) {
  if (!allNew || force) return [...additions.map((addition) => addition.post), ...posts];

  const existingBySource = new Map();
  for (const post of posts) {
    const sourceKey = normalizeUrl(post.sourceUrl);
    if (sourceKey && !existingBySource.has(sourceKey)) existingBySource.set(sourceKey, post);
  }

  const additionsBySource = new Map();
  for (const addition of additions) {
    const sourceKey = normalizeUrl(addition.post.sourceUrl);
    if (sourceKey) additionsBySource.set(sourceKey, addition.post);
  }

  const scanSources = new Set(targetLinks.map((link) => normalizeUrl(link.url)).filter(Boolean));
  const orderedScanPosts = targetLinks
    .map((link) => {
      const sourceKey = normalizeUrl(link.url);
      return additionsBySource.get(sourceKey) || existingBySource.get(sourceKey) || null;
    })
    .filter(Boolean);
  const remainingPosts = posts.filter((post) => !scanSources.has(normalizeUrl(post.sourceUrl)));

  return [...orderedScanPosts, ...remainingPosts];
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

function launchChrome({ port, profileDir, url, headless }) {
  const chromePath = findChrome();
  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--profile-directory=Default',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1440,1000',
  ];

  if (headless) {
    chromeArgs.push('--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage');
  }

  chromeArgs.push(url);

  const child = spawn(chromePath, chromeArgs, {
    detached: true,
    stdio: 'ignore',
    windowsHide: headless,
  });
  child.unref();
  return child;
}

async function closeBrowser(cdp, chromeChild) {
  if (cdp) {
    try {
      await cdp.send('Browser.close');
    } catch {
      try {
        cdp.close();
      } catch {
        // Ignore cleanup errors; the original sync result is more important.
      }
    }
  }

  if (chromeChild && !chromeChild.killed) {
    try {
      chromeChild.kill();
    } catch {
      // Ignore cleanup errors; Chrome may have already exited.
    }
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    'google-chrome-stable',
    'google-chrome',
    'chromium-browser',
    'chromium',
  ].filter(Boolean);

  const found = candidates.find((candidate) => (
    candidate.includes('/') || candidate.includes('\\') ? existsSync(candidate) : commandExists(candidate)
  ));
  if (!found) {
    throw new Error('Chrome was not found. Install Chrome/Chromium or set CHROME_PATH and retry.');
  }
  return found;
}

function commandExists(command) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { stdio: 'ignore' });
  return result.status === 0;
}

function parseBooleanFlag(argValue, envValue, defaultValue) {
  const value = argValue ?? envValue;
  if (value === undefined) return defaultValue;
  if (typeof value === 'boolean') return value;
  return !/^(0|false|no|off)$/i.test(String(value).trim());
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
  let links = await evaluate(cdp, (sourceHref) => {
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

  if (links.length === 0) {
    links = await extractContentLinksByRoleLinkClicking(cdp, source.href);
  }

  if (debug) {
    console.log(`Found ${links.length} candidate links.`);
    links.slice(0, 20).forEach((link) => console.log(`- ${link.title} -> ${link.url}`));
  }

  return links;
}

async function extractContentLinksByRoleLinkClicking(cdp, sourceHref) {
  const clickedLinks = [];
  const seen = new Set();
  const maxCandidates = Number.isFinite(limit) ? Math.min(Math.max(limit * 4, 10), 30) : 30;

  for (let index = 0; index < maxCandidates; index += 1) {
    await cdp.send('Page.navigate', { url: sourceHref });
    await waitForPage(cdp);

    const candidateCount = await evaluate(cdp, () => {
      return getRoleLinkCandidates().length;

      function getRoleLinkCandidates() {
        const seen = new Set();
        return Array.from(document.body?.querySelectorAll('[role="link"], .cursor-pointer') || [])
          .map((element) => {
            const rect = element.getBoundingClientRect();
            const text = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
            return { element, rect, text, top: rect.top + window.scrollY };
          })
          .filter((item) => {
            if (item.rect.width < 120 || item.rect.height < 24) return false;
            if (item.text.length < 20 || item.text.length > 700) return false;
            if (!/(\uC77D\uC74C|\uC548\uC77D\uC74C)/.test(item.text)) return false;
            if (!/(\uAE00|\uC624\uB514\uC624|\uC601\uC0C1)/.test(item.text)) return false;
            if (/(\uACE0\uC815\uAE00|\uCD94\uCC9C\uC0C1\uD488|\uAD6C\uB3C5\s*\uC911\uC778|\uC774\uC6A9\uC57D\uAD00|\uAC1C\uC778\uC815\uBCF4\uCC98\uB9AC\uBC29\uCE68|\uD658\uBD88\uC815\uCC45)/.test(item.text)) return false;
            return true;
          })
          .filter((item) => {
            if (seen.has(item.element)) return false;
            seen.add(item.element);
            return true;
          })
          .sort((a, b) => a.top - b.top);
      }
    });
    if (index >= candidateCount) break;

    const beforeUrls = await getOpenContentTabUrls(sourceHref);
    const clickResult = await evaluate(cdp, (candidateIndex) => {
      const candidates = getRoleLinkCandidates();
      const item = candidates[candidateIndex];
      if (!item) return { clicked: false, count: candidates.length };

      item.element.scrollIntoView({ block: 'center', inline: 'center' });
      item.element.click();
      return {
        clicked: true,
        count: candidates.length,
        title: cleanTitle(item.text),
      };

      function getRoleLinkCandidates() {
        const seen = new Set();
        return Array.from(document.body?.querySelectorAll('[role="link"], .cursor-pointer') || [])
          .map((element) => {
            const rect = element.getBoundingClientRect();
            const text = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
            return { element, rect, text, top: rect.top + window.scrollY };
          })
          .filter((candidate) => {
            if (candidate.rect.width < 120 || candidate.rect.height < 24) return false;
            if (candidate.text.length < 20 || candidate.text.length > 700) return false;
            if (!/(\uC77D\uC74C|\uC548\uC77D\uC74C)/.test(candidate.text)) return false;
            if (!/(\uAE00|\uC624\uB514\uC624|\uC601\uC0C1)/.test(candidate.text)) return false;
            if (/(\uACE0\uC815\uAE00|\uCD94\uCC9C\uC0C1\uD488|\uAD6C\uB3C5\s*\uC911\uC778|\uC774\uC6A9\uC57D\uAD00|\uAC1C\uC778\uC815\uBCF4\uCC98\uB9AC\uBC29\uCE68|\uD658\uBD88\uC815\uCC45)/.test(candidate.text)) return false;
            return true;
          })
          .filter((candidate) => {
            if (seen.has(candidate.element)) return false;
            seen.add(candidate.element);
            return true;
          })
          .sort((a, b) => a.top - b.top);
      }

      function cleanTitle(text) {
        return String(text || '')
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/^(?:\uC57D\s*)?\d+\s*(?:\uBD84|\uC2DC\uAC04|\uC77C)\s*\uC804\s*/u, '')
          .replace(/\s+(\uAE00|\uC624\uB514\uC624|\uC601\uC0C1)\s+.+$/u, '')
          .replace(/\s+\d+\s*(\uC77D\uC74C|\uC548\uC77D\uC74C)\s*$/u, '')
          .trim();
      }
    }, index);

    if (!clickResult.clicked) break;
    await delay(1500);

    const current = await evaluate(cdp, (listHref) => {
      const url = location.href;
      return {
        url,
        isContent: isLikelyContentUrl(url, new URL(listHref)),
      };

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
    }, sourceHref);

    const openedUrl = (await getOpenContentTabUrls(sourceHref)).find((url) => !beforeUrls.includes(url));
    const detectedUrl = current.isContent ? current.url : openedUrl;
    if (detectedUrl && !seen.has(detectedUrl)) {
      seen.add(detectedUrl);
      clickedLinks.push({ url: detectedUrl, title: clickResult.title || detectedUrl });
    }

    if (clickResult.count < maxCandidates && index >= clickResult.count - 1) break;
  }

  await cdp.send('Page.navigate', { url: sourceHref }).catch(() => {});
  await waitForPage(cdp).catch(() => {});
  return clickedLinks;
}

async function getOpenContentTabUrls(sourceHref) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json`);
    if (!response.ok) return [];
    const tabs = await response.json();
    const listUrl = new URL(sourceHref);
    return tabs
      .filter((tab) => tab.type === 'page' && isLikelyContentHref(tab.url, listUrl))
      .map((tab) => tab.url);
  } catch {
    return [];
  }
}

function isLikelyContentHref(href, listUrl) {
  try {
    const url = new URL(href);
    if (url.host !== listUrl.host) return false;
    if (url.href === listUrl.href) return false;
    const isClubContent = url.pathname.includes('/club/13/');
    const isSecretContent = /^\/secrets\/\d+\/?$/.test(url.pathname);
    if (!isClubContent && !isSecretContent) return false;
    if (/login|sign|auth|notice|members|profile|payment|setting/i.test(url.pathname)) return false;
    if (url.pathname.endsWith('/contents') && url.searchParams.get('type')) return false;
    return isSecretContent || /\/contents?\/|contentId=|contentsId=|postId=|articleId=|\/contents\/?\d|\/\d+(?:\/)?$/.test(url.pathname + url.search);
  } catch {
    return false;
  }
}

function getRoleLinkCandidates() {
  const seen = new Set();
  return Array.from(document.body?.querySelectorAll('[role="link"], .cursor-pointer') || [])
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const text = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
      return { element, rect, text, top: rect.top + window.scrollY };
    })
    .filter((item) => {
      if (item.rect.width < 120 || item.rect.height < 24) return false;
      if (item.text.length < 20 || item.text.length > 700) return false;
      if (!/(\uC77D\uC74C|\uC548\uC77D\uC74C)/.test(item.text)) return false;
      if (!/(\uAE00|\uC624\uB514\uC624|\uC601\uC0C1)/.test(item.text)) return false;
      if (/(\uACE0\uC815\uAE00|\uCD94\uCC9C\uC0C1\uD488|\uAD6C\uB3C5\s*\uC911\uC778|\uC774\uC6A9\uC57D\uAD00|\uAC1C\uC778\uC815\uBCF4\uCC98\uB9AC\uBC29\uCE68|\uD658\uBD88\uC815\uCC45)/.test(item.text)) return false;
      return true;
    })
    .filter((item) => {
      if (seen.has(item.element)) return false;
      seen.add(item.element);
      return true;
    })
    .sort((a, b) => a.top - b.top);
}

function cleanTitle(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:\uC57D\s*)?\d+\s*(?:\uBD84|\uC2DC\uAC04|\uC77C)\s*\uC804\s*/u, '')
    .replace(/\s+(\uAE00|\uC624\uB514\uC624|\uC601\uC0C1)\s+.+$/u, '')
    .replace(/\s+\d+\s*(\uC77D\uC74C|\uC548\uC77D\uC74C)\s*$/u, '')
    .trim();
}

async function extractContentLinksByClicking(cdp, sourceHref) {
  const clickedLinks = [];
  const seen = new Set();
  const maxCandidates = Number.isFinite(limit) ? Math.min(Math.max(limit * 4, 10), 30) : 30;

  for (let index = 0; index < maxCandidates; index += 1) {
    await cdp.send('Page.navigate', { url: sourceHref });
    await waitForPage(cdp);

    const candidateCount = await evaluate(cdp, () => {
      return Array.from(document.body?.querySelectorAll('*') || [])
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
          return { rect, text };
        })
        .filter((item) => {
          if (item.rect.width < 120 || item.rect.height < 24) return false;
          if (item.text.length < 20 || item.text.length > 700) return false;
          if (!/(읽음|안읽음)/.test(item.text)) return false;
          if (!/(글|오디오|영상)/.test(item.text)) return false;
          if (/고정글|추천상품|구독 중인|이용약관|개인정보처리방침|환불정책/.test(item.text)) return false;
          return true;
        }).length;
    });
    if (index >= candidateCount) break;

    const clickResult = await evaluate(cdp, (candidateIndex) => {
      const candidates = getClickableContentCandidates();
      const item = candidates[candidateIndex];
      if (!item) return { clicked: false, count: candidates.length };

      item.element.scrollIntoView({ block: 'center', inline: 'center' });
      item.element.click();
      return {
        clicked: true,
        count: candidates.length,
        title: item.title,
        beforeUrl: location.href,
      };

      function getClickableContentCandidates() {
        const seenElements = new Set();
        return Array.from(document.body?.querySelectorAll('*') || [])
          .map((element) => {
            const rect = element.getBoundingClientRect();
            const text = clean(element.innerText || element.textContent || '');
            return { element, rect, text };
          })
          .filter((item) => {
            if (item.rect.width < 120 || item.rect.height < 24) return false;
            if (item.text.length < 20 || item.text.length > 700) return false;
            if (!/(읽음|안읽음)/.test(item.text)) return false;
            if (!/(글|오디오|영상)/.test(item.text)) return false;
            if (/고정글|추천상품|구독 중인|이용약관|개인정보처리방침|환불정책/.test(item.text)) return false;
            return true;
          })
          .map((item) => {
            const element = findClickableElement(item.element);
            return {
              element,
              top: element.getBoundingClientRect().top + window.scrollY,
              title: cleanTitle(item.text),
            };
          })
          .filter((item) => {
            if (seenElements.has(item.element)) return false;
            seenElements.add(item.element);
            return true;
          })
          .sort((a, b) => a.top - b.top);
      }

      function findClickableElement(element) {
        let current = element;
        let best = element;
        while (current && current !== document.body) {
          const style = window.getComputedStyle(current);
          const role = current.getAttribute('role') || '';
          const className = String(current.className || '');
          if (
            style.cursor === 'pointer' ||
            role === 'button' ||
            current.tabIndex >= 0 ||
            typeof current.onclick === 'function' ||
            /card|item|content|post|cursor|click/i.test(className)
          ) {
            best = current;
          }
          current = current.parentElement;
        }
        return best;
      }

      function cleanTitle(text) {
        return clean(text)
          .replace(/^(?:약\s*)?\d+\s*(?:분|시간|일)\s*전\s*/u, '')
          .replace(/\s+(글|오디오|영상)\s+.+$/u, '')
          .replace(/\s+\d+\s*(읽음|안읽음)\s*$/u, '')
          .trim();
      }

      function clean(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
      }
    }, index);

    if (!clickResult.clicked) break;
    await delay(1500);

    const current = await evaluate(cdp, (listHref) => {
      const url = location.href;
      return {
        url,
        isContent: isLikelyContentUrl(url, new URL(listHref)),
      };

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
    }, sourceHref);

    if (current.isContent && !seen.has(current.url)) {
      seen.add(current.url);
      clickedLinks.push({ url: current.url, title: clickResult.title || current.url });
    }

    if (clickResult.count < maxCandidates && index >= clickResult.count - 1) break;
  }

  await cdp.send('Page.navigate', { url: sourceHref }).catch(() => {});
  await waitForPage(cdp).catch(() => {});
  return clickedLinks;
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
  ensureDir(tempDir);
  const networkMedia = [];
  const downloadMedia = [];
  const networkHandler = (event) => {
    const media = mediaFromUrl(event?.response?.url || '', event?.response?.mimeType || '');
    if (media && !networkMedia.some((item) => item.url === media.url)) networkMedia.push(media);
  };
  const requestHandler = (event) => {
    const media = mediaFromUrl(event?.request?.url || '', '');
    if (media && !networkMedia.some((item) => item.url === media.url)) networkMedia.push(media);
  };
  const downloadHandler = (event) => {
    const url = event?.url || '';
    const fileName = event?.suggestedFilename || '';
    if (!url) return;
    const media = /\.pdf$/i.test(fileName)
      ? { kind: 'pdf', url, mimeType: 'application/pdf' }
      : mediaFromUrl(url, /\.pdf$/i.test(fileName) ? 'application/pdf' : '');
    if (media && !downloadMedia.some((item) => item.url === media.url)) downloadMedia.push(media);
  };
  cdp.on('Network.requestWillBeSent', requestHandler);
  cdp.on('Network.responseReceived', networkHandler);
  cdp.on('Browser.downloadWillBegin', downloadHandler);
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: tempDir,
    eventsEnabled: true,
  }).catch(() => {});
  await cdp.send('Page.navigate', { url });
  await waitForPage(cdp);
  await autoScroll(cdp);
  const beforeTranscriptText = await evaluate(cdp, () => document.body?.innerText || '');

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

    return {
      sourceUrl: location.href,
      title: clean(title),
      html: selected.html,
      text: clean(selected.text),
      media: collectMediaUrls(),
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

    function collectMediaUrls() {
      const attrs = [
        'src',
        'href',
        'data-src',
        'data-url',
        'data-href',
        'data-download-url',
        'data-file-url',
      ];

      const urls = [];
      Array.from(document.querySelectorAll('audio, video, source, iframe, a, button, [role="button"], [data-src], [data-url], [data-href]'))
        .forEach((el) => {
          attrs.forEach((attr) => {
            const value = el.getAttribute(attr);
            if (value) urls.push(value);
          });
        });

      const html = document.documentElement.innerHTML || '';
      Array.from(html.matchAll(/https?:\\?\/\\?\/[^"'`<>\\\s]+(?:pdf|mp3|m4a|aac|wav|mp4|m3u8)[^"'`<>\\\s]*/gi))
        .forEach((match) => urls.push(match[0].replace(/\\\//g, '/')));

      return [...new Set(urls)]
        .map((src) => {
          try {
            return new URL(src.replace(/&amp;/g, '&'), location.href).href;
          } catch {
            return '';
          }
        })
        .filter((src) => /\.(mp3|m4a|aac|wav|mp4|m3u8|pdf)(\?|#|$)|audio|video|stream|pdf/i.test(src));
    }
  }, fallbackTitle);
  const recordingMedia = await activateRegularClassRecording(cdp, data.title || fallbackTitle);
  const tabsBeforeAnalysisClick = await listBrowserTargets(port).catch(() => []);
  const analysisTrigger = await openAnalysisPdfIfAvailable(cdp, data.title || fallbackTitle);
  if (debug && analysisTrigger.opened) console.log(`Opened analysis/PDF trigger: ${analysisTrigger.text}`);
  if (debug && !analysisTrigger.opened && /기업분석도감|기업분석/.test(`${data.title} ${fallbackTitle}`)) {
    console.log(`No analysis/PDF trigger opened. Candidates: ${analysisTrigger.candidates?.join(' | ') || '(none)'}`);
  }
  const clickedMedia = analysisTrigger.opened ? await collectVisibleMediaUrls(cdp) : [];
  const analysisMedia = analysisTrigger.url ? [{ kind: 'pdf', url: analysisTrigger.url, mimeType: 'application/pdf' }] : [];
  const browserPdfMedia = analysisTrigger.opened ? await collectNewBrowserPdfViewerMedia(port, tabsBeforeAnalysisClick) : [];
  if (debug && browserPdfMedia.length > 0) {
    browserPdfMedia.forEach((media) => console.log(`Detected PDF viewer media: ${media.url}`));
  }
  if (debug && analysisTrigger.opened && clickedMedia.length === 0 && analysisMedia.length === 0 && browserPdfMedia.length === 0) {
    const diagnostics = await collectAnalysisPdfDiagnostics(cdp);
    console.log('Analysis/PDF diagnostics:');
    diagnostics.forEach((item) => console.log(`- ${item}`));
  }
  const transcriptOpened = await openTranscriptIfAvailableStable(cdp);
  if (debug && transcriptOpened) console.log('Opened transcript panel.');
  const transcriptMarkdown = transcriptOpened
    ? await extractTranscriptMarkdown(cdp, beforeTranscriptText)
    : '';
  if (debug && transcriptOpened) console.log(`Transcript markdownLength=${transcriptMarkdown.length}`);

  await delay(2000);
  cdp.off('Network.requestWillBeSent', requestHandler);
  cdp.off('Network.responseReceived', networkHandler);
  cdp.off('Browser.downloadWillBegin', downloadHandler);

  const markdown = appendTranscriptMarkdown(
    cleanupMarkdown(turndown.turndown(data.html || data.text || '')),
    transcriptMarkdown,
  );
  const domMedia = [...data.media, ...recordingMedia, ...clickedMedia].map((url) => mediaFromUrl(url, '')).filter(Boolean);
  return {
    ...data,
    title: cleanupTitle(data.title),
    markdown,
    media: dedupeMedia([...domMedia, ...analysisMedia, ...browserPdfMedia, ...networkMedia, ...downloadMedia]),
  };
}

async function activateRegularClassRecording(cdp, title) {
  if (!isRegularClassRecordingTitle(title)) return [];

  const activation = await evaluate(cdp, () => {
    const videos = Array.from(document.querySelectorAll('video'));
    videos.forEach((video) => {
      video.muted = true;
      video.preload = 'auto';
      video.play().catch(() => {});
    });

    const playPattern = /^(?:\uC7AC\uC0DD|play|play video)$/i;
    const playImages = Array.from(document.querySelectorAll('img'))
      .filter((image) => /(?:IC_play|play)/i.test(`${image.getAttribute('src') || ''} ${image.getAttribute('alt') || ''}`))
      .map((image) => {
        image.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = image.getBoundingClientRect();
        return {
          label: image.getAttribute('alt') || image.getAttribute('src') || '',
          rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        };
      })
      .filter((item) => item.rect.width > 0 && item.rect.height > 0);
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], [aria-label], [title]'))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const label = [
          node.innerText,
          node.textContent,
          node.getAttribute('aria-label'),
          node.getAttribute('title'),
        ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        return { node, label, rect, visible: rect.width > 0 && rect.height > 0 };
      })
      .filter((item) => item.visible && playPattern.test(item.label))
      .sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));

    candidates[0]?.node.click();
    return {
      videoCount: videos.length,
      clicked: candidates[0]?.label || '',
      playImages,
      videos: videos.map((video) => ({
        src: video.getAttribute('src') || '',
        currentSrc: video.currentSrc || '',
        readyState: video.readyState,
        networkState: video.networkState,
        rect: (() => {
          const rect = video.getBoundingClientRect();
          return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        })(),
      })),
    };
  });

  const visibleVideo = activation.videos.find((video) => video.rect.width > 0 && video.rect.height > 0);
  const clickTarget = activation.playImages[0] || visibleVideo;
  if (clickTarget) {
    const x = clickTarget.rect.x + clickTarget.rect.width / 2;
    const y = clickTarget.rect.y + clickTarget.rect.height / 2;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  if (debug) {
    console.log(`Activated regular class recording player: videos=${activation.videoCount} control="${activation.clicked}"`);
    activation.playImages.forEach((image) => console.log(`Play image: ${JSON.stringify(image)}`));
    activation.videos.forEach((video) => console.log(`Video element: ${JSON.stringify(video)}`));
  }
  await delay(4000);
  if (debug) {
    const resources = await evaluate(cdp, () => performance.getEntriesByType('resource')
      .map((entry) => ({ name: entry.name, initiatorType: entry.initiatorType }))
      .filter((entry) => /video|media|stream|\.mpd|\.m3u8|\.mp4|cloudfront/i.test(`${entry.initiatorType} ${entry.name}`))
      .slice(-30));
    resources.forEach((resource) => console.log(`Video resource candidate: ${resource.initiatorType} ${resource.name}`));
  }
  return collectVisibleMediaUrls(cdp);
}

function isRegularClassRecordingTitle(title) {
  return /\uC815\uADDC\s*\uC218\uC5C5\s*\uB179\uD654\uBCF8/.test(String(title || ''));
}

function isGoodMorningEpisodeTitle(title) {
  return /^\d+\s*\uD654\.\s*(?:\uD83C\uDF1E\s*)?\d{1,2}\s*\uC6D4\s*\d{1,2}\s*\uC77C.*\uAD7F\uBAA8\uB2DD\s*\uB2F4[\uC3D8\uC0D8]/.test(String(title || ''));
}

async function openTranscriptIfAvailableStable(cdp) {
  const result = await evaluate(cdp, () => {
    const transcriptButtonPattern = /(?:\uC2A4\uD06C\uB9BD\uD2B8\s*\uBCF4\uAE30|transcript|script)/i;
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, div, span'))
      .filter((node) => transcriptButtonPattern.test((node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim()))
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
  await waitForTranscriptRender(cdp);
  await autoScroll(cdp);
  return true;
}

async function openAnalysisPdfIfAvailable(cdp, title = '') {
  const result = await evaluate(cdp, (titleText) => {
    const pageText = `${titleText || ''}\n${document.body?.innerText || ''}`;
    if (!/기업분석도감|기업분석|pdf|PDF|자료|다운로드|첨부/.test(pageText)) {
      return { opened: false, text: '' };
    }

    const triggerPattern = /(?:기업\s*분석|기업분석도감|PDF|pdf|자료|다운로드|첨부|파일)/i;
    const candidates = Array.from(document.querySelectorAll('button, a[href], [role="button"], [tabindex], div, span'))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const childImageText = Array.from(node.querySelectorAll?.('img') || [])
          .map((img) => clean(img.getAttribute('alt') || img.getAttribute('title') || ''))
          .filter(Boolean)
          .join(' ');
        const text = clean(node.innerText || node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || childImageText);
        const rawUrl = collectNearbyUrl(node);
        let url = '';
        try {
          if (rawUrl) url = new URL(rawUrl.replace(/&amp;/g, '&'), location.href).href;
        } catch {
          url = rawUrl;
        }
        return {
          node,
          text,
          href: rawUrl,
          url,
          visible: rect.width > 0 && rect.height > 0,
          area: rect.width * rect.height,
          top: rect.top + window.scrollY,
          tag: node.tagName,
          clickable: isLikelyClickable(node),
        };
      })
      .filter((item) => item.visible)
      .filter((item) => item.area > 20 && item.area < 250000)
      .filter((item) => item.href || item.text.length <= 120)
      .filter((item) => !/^\d+\s*화\./.test(item.text))
      .filter((item) => triggerPattern.test(`${item.text} ${item.href} ${item.url}`))
      .sort((a, b) => score(b) - score(a) || a.area - b.area || a.top - b.top);

    const target = candidates[0];
    if (!target) {
      return {
        opened: false,
        text: '',
        candidates: candidates.slice(0, 10).map((item) => item.text || item.url || item.href || item.tag),
      };
    }

    const clickNode = findClickableTarget(target.node);
    clickNode.scrollIntoView({ block: 'center', inline: 'center' });
    const clickRect = clickNode.getBoundingClientRect();
    clickNode.click();
    return {
      opened: true,
      text: target.text || target.url || target.href || target.tag,
      url: target.url,
      html: target.node.outerHTML.slice(0, 1000),
      x: clickRect.left + clickRect.width / 2,
      y: clickRect.top + clickRect.height / 2,
      candidates: candidates.slice(0, 10).map((item) => item.text || item.url || item.href || item.tag),
    };

    function score(item) {
      const haystack = `${item.text} ${item.href} ${item.url}`;
      let value = 0;
      if (/\.pdf(?:[?#]|$)|pdf/i.test(haystack)) value += 100;
      if (/기업\s*분석|기업분석도감/.test(haystack)) value += 80;
      if (/다운로드|첨부|파일|자료/.test(haystack)) value += 40;
      if (item.tag === 'A') value += 20;
      if (item.tag === 'BUTTON') value += 20;
      if (item.clickable) value += 30;
      return value;
    }

    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function collectNearbyUrl(node) {
      const attrs = ['href', 'src', 'data-url', 'data-href', 'data-download-url', 'data-file-url', 'data-file', 'data-link'];
      const values = [];
      const addAttrs = (target) => {
        if (!target?.getAttribute) return;
        attrs.forEach((attr) => {
          const value = target.getAttribute(attr);
          if (value) values.push(value);
        });
      };

      addAttrs(node);
      Array.from(node.querySelectorAll?.('a[href], iframe[src], [data-url], [data-href], [data-download-url], [data-file-url], [data-file], [data-link]') || [])
        .forEach(addAttrs);

      let parent = node.parentElement;
      for (let depth = 0; parent && depth < 3; depth += 1) {
        addAttrs(parent);
        Array.from(parent.querySelectorAll?.('a[href], iframe[src], [data-url], [data-href], [data-download-url], [data-file-url], [data-file], [data-link]') || [])
          .slice(0, 5)
          .forEach(addAttrs);
        parent = parent.parentElement;
      }

      return values.find((value) => /pdf|download|file|attachment|api|secret|secrets/i.test(value)) || values[0] || '';
    }

    function isLikelyClickable(node) {
      const style = window.getComputedStyle(node);
      return node.tagName === 'A' ||
        node.tagName === 'BUTTON' ||
        node.getAttribute('role') === 'button' ||
        node.hasAttribute('tabindex') ||
        node.hasAttribute('onclick') ||
        style.cursor === 'pointer';
    }

    function findClickableTarget(node) {
      if (isLikelyClickable(node)) return node;

      const direct = node.closest?.('a[href], button, [role="button"], [tabindex], [onclick]');
      if (direct) return direct;

      let parent = node.parentElement;
      for (let depth = 0; parent && depth < 5; depth += 1) {
        if (isLikelyClickable(parent)) return parent;
        const siblingButton = parent.querySelector?.('a[href], button, [role="button"], [tabindex], [onclick]');
        if (siblingButton) return siblingButton;
        parent = parent.parentElement;
      }

      return node;
    }
  }, title);

  if (!result.opened) return result;
  if (Number.isFinite(result.x) && Number.isFinite(result.y)) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: result.x,
      y: result.y,
      button: 'none',
    }).catch(() => {});
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: result.x,
      y: result.y,
      button: 'left',
      clickCount: 1,
    }).catch(() => {});
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: result.x,
      y: result.y,
      button: 'left',
      clickCount: 1,
    }).catch(() => {});
  }
  await delay(6000);
  await autoScroll(cdp);
  await delay(3000);
  return result;
}

async function collectVisibleMediaUrls(cdp) {
  return evaluate(cdp, () => {
    const attrs = [
      'src',
      'href',
      'data-src',
      'data-url',
      'data-href',
      'data-download-url',
      'data-file-url',
    ];
    const urls = [];

    Array.from(document.querySelectorAll('audio, video, source, iframe, a, button, [role="button"], [data-src], [data-url], [data-href]'))
      .forEach((el) => {
        attrs.forEach((attr) => {
          const value = el.getAttribute(attr);
          if (value) urls.push(value);
        });
      });

    const html = document.documentElement.innerHTML || '';
    Array.from(html.matchAll(/https?:\\?\/\\?\/[^"'`<>\\\s]+(?:pdf|mp3|m4a|aac|wav|mp4|m3u8)[^"'`<>\\\s]*/gi))
      .forEach((match) => urls.push(match[0].replace(/\\\//g, '/')));

    return [...new Set(urls)]
      .map((src) => {
        try {
          return new URL(String(src).replace(/&amp;/g, '&'), location.href).href;
        } catch {
          return '';
        }
      })
      .filter((src) => /\.(mp3|m4a|aac|wav|mp4|m3u8|pdf)(\?|#|$)|audio|video|stream|pdf/i.test(src));
  });
}

async function collectAnalysisPdfDiagnostics(cdp) {
  return evaluate(cdp, () => {
    const pattern = /기업분석|기업분석도감|pdf/i;
    return Array.from(document.querySelectorAll('a, button, [role="button"], [tabindex], div, span, iframe'))
      .map((node) => {
        const text = clean(node.innerText || node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || '');
        const attrs = Array.from(node.attributes || [])
          .filter((attr) => /href|src|url|file|download|data|aria|title|onclick/i.test(attr.name + attr.value))
          .map((attr) => `${attr.name}=${attr.value}`)
          .slice(0, 8)
          .join(' ');
        return {
          tag: node.tagName,
          text,
          attrs,
        };
      })
      .filter((item) => pattern.test(`${item.text} ${item.attrs}`))
      .slice(0, 12)
      .map((item) => `${item.tag} text="${item.text.slice(0, 140)}" attrs="${item.attrs.slice(0, 500)}"`);

    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }
  });
}

async function listBrowserTargets(browserPort) {
  const response = await fetch(`http://127.0.0.1:${browserPort}/json/list`);
  if (!response.ok) throw new Error(`Failed to list browser targets: HTTP ${response.status}`);
  return response.json();
}

async function collectNewBrowserPdfViewerMedia(browserPort, previousTargets) {
  await delay(1000);
  const previousIds = new Set(previousTargets.map((target) => target.id));
  const targets = await listBrowserTargets(browserPort);
  const newTargets = targets.filter((target) => !previousIds.has(target.id));
  const candidates = newTargets.length > 0 ? newTargets : targets;

  return candidates
    .map((target) => pdfMediaFromViewerUrl(target.url || ''))
    .filter(Boolean);
}

function pdfMediaFromViewerUrl(viewerUrl) {
  if (!viewerUrl) return null;
  const match = String(viewerUrl).match(/\/pdf-viewer\/([^/?#]+)/);
  if (!match) {
    const directMedia = mediaFromUrl(viewerUrl, '');
    return directMedia?.kind === 'pdf' ? directMedia : null;
  }

  try {
    const encoded = decodeURIComponent(match[1]);
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const media = mediaFromUrl(decoded, 'application/pdf');
    return media?.kind === 'pdf' ? media : null;
  } catch {
    return null;
  }
}

async function waitForTranscriptRender(cdp) {
  const before = await evaluate(cdp, () => document.body?.innerText?.length || 0);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await delay(500);
    const state = await evaluate(cdp, (initialLength) => {
      const text = document.body?.innerText || '';
      return {
        grew: text.length > initialLength + 200,
        hasTranscriptText: /\uC2A4\uD06C\uB9BD\uD2B8|\uC790\uB9C9|transcript/i.test(text),
      };
    }, before);
    if (state.grew || state.hasTranscriptText) return;
  }
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

async function extractTranscriptMarkdown(cdp, beforeTranscriptText) {
  const transcriptText = await evaluate(cdp, (beforeText) => {
    const beforeKeys = new Set(toLines(beforeText).map(lineKey));
    const afterLines = toLines(document.body?.innerText || '');
    const picked = [];
    const seen = new Set();

    for (const line of afterLines) {
      const key = lineKey(line);
      if (!key || beforeKeys.has(key) || seen.has(key) || isTranscriptNoise(line)) continue;
      seen.add(key);
      picked.push(line);
    }

    const pickedTranscript = trimTranscriptLines(picked);
    if (pickedTranscript.join('\n').length >= 80) return pickedTranscript.join('\n');

    const candidates = Array.from(document.querySelectorAll('article, main, section, [role="dialog"], [class*="script" i], [class*="transcript" i], [class*="modal" i], [class*="content" i]'))
      .map((node) => toLines(node.innerText || node.textContent || '').filter((line) => !isTranscriptNoise(line)))
      .map((lines) => lines.filter((line) => !beforeKeys.has(lineKey(line))))
      .map((lines) => trimTranscriptLines(lines))
      .filter((lines) => lines.join('\n').length >= 80)
      .sort((a, b) => b.join('\n').length - a.join('\n').length);

    return candidates[0]?.join('\n') || '';

    function toLines(value) {
      return String(value || '')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    }

    function lineKey(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function isTranscriptNoise(value) {
      const text = String(value || '').trim();
      if (!text || text.length < 2) return true;
      if (/^\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?$/.test(text)) return true;
      if (/^(like|\d{1,6}|login|sign up|notification|menu|NAVER)$/i.test(text)) return true;
      if (/^(AI\s*\uC2A4\uD06C\uB9BD\uD2B8|\uC804\uCCB4\s*\uC2A4\uD06C\uB9BD\uD2B8|\uC694\uC57D\s*[·ㆍ]\s*\uD0A4\uC6CC\uB4DC)$/i.test(text)) return true;
      if (/^(?:\uC18D\uB3C4\s*\([^)]*\)|\uC2A4\uD06C\uB9BD\uD2B8\s*\uBCF4\uAE30\s*Beta)$/i.test(text)) return true;
      if (/^(?:\uB313\uAE00|\uC751\uC6D0|\uC88B\uC544\uC694|\uBD81\uB9C8\uD06C|\uBAA9\uB85D|\uACF5\uC720)/.test(text)) return true;
      return false;
    }

    function trimTranscriptLines(lines) {
      const cleaned = lines.filter((line) => !isTranscriptNoise(line));
      const stopIndex = cleaned.findIndex((line) => {
        const text = String(line || '').trim();
        return /^(?:\d+\s*(?:\uC77C|\uC2DC\uAC04|\uBD84)\s*\uC804|\d+\s*\uD68C\uCC28|(?:\uD22C\uC790(?:\uC655|\uCD08\uBCF4|\uD559\uC2B5))[_-])/u.test(text);
      });
      const trimmedAtComment = stopIndex < 0 ? cleaned : cleaned.slice(0, Math.max(0, stopIndex - 1));
      const thanksIndex = findTrailingThanksIndex(trimmedAtComment);
      if (thanksIndex < 0) return trimmedAtComment;
      return trimmedAtComment.slice(0, thanksIndex + 1);
    }

    function findTrailingThanksIndex(lines) {
      const searchStart = Math.max(0, lines.length - 12);
      for (let index = lines.length - 1; index >= searchStart; index -= 1) {
        const text = String(lines[index] || '').trim();
        if (/\uAC10\uC0AC(?:\uD569\uB2C8\uB2E4|\uB4DC\uB9BD\uB2C8\uB2E4)|\uACE0\uB9D9\uC2B5\uB2C8\uB2E4|媛먯궗/.test(text)) return index;
      }
      return -1;
    }
  }, beforeTranscriptText);

  return cleanupMarkdown(turndown.turndown(textToHtml(transcriptText)));
}

function appendTranscriptMarkdown(markdown, transcriptMarkdown) {
  const body = String(markdown || '').trim();
  const transcript = String(transcriptMarkdown || '').trim();
  if (!transcript || body.includes(transcript)) return body;

  return [
    body,
    '## 스크립트',
    transcript,
  ].filter(Boolean).join('\n\n');
}

function textToHtml(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
    .replace(/^\s*\uC18D\uB3C4\s*\([^)]*\)\s*$/gm, '')
    .replace(/^\s*\uC2A4\uD06C\uB9BD\uD2B8\s*\uBCF4\uAE30\s*Beta\s*$/gm, '')
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

function countSummerAnalysisPdfPosts(posts) {
  return posts.filter((post) => (
    /기업분석도감/.test(`${post.title || ''} ${post.category || ''}`) &&
    /여름학기/.test(`${post.title || ''} ${post.term || ''}`) &&
    post.pdfUrl
  )).length;
}

function koreanOrdinalFromTitle(title) {
  const text = String(title || '');
  const koreanMatch = text.match(/([가-힣]+번째)\s*기업분석도감/);
  if (koreanMatch) return koreanMatch[1];

  const episodeMatch = text.match(/(\d+)\s*화/);
  if (episodeMatch) return koreanOrdinal(Number(episodeMatch[1]));

  return '';
}

function koreanOrdinal(number) {
  const value = Number(number);
  if (!Number.isFinite(value) || value < 1) return '';

  const nativeOrdinals = [
    '',
    '첫번째',
    '두번째',
    '세번째',
    '네번째',
    '다섯번째',
    '여섯번째',
    '일곱번째',
    '여덟번째',
    '아홉번째',
    '열번째',
  ];
  if (nativeOrdinals[value]) return nativeOrdinals[value];

  return `${sinoKoreanNumber(value)}번째`;
}

function sinoKoreanNumber(number) {
  const digits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const units = [
    { value: 1000, label: '천' },
    { value: 100, label: '백' },
    { value: 10, label: '십' },
  ];
  let remaining = Number(number);
  let result = '';

  for (const unit of units) {
    const digit = Math.floor(remaining / unit.value);
    if (digit > 0) {
      result += `${digit === 1 ? '' : digits[digit]}${unit.label}`;
      remaining %= unit.value;
    }
  }

  if (remaining > 0) result += digits[remaining];
  return result || digits[number] || String(number);
}

function mediaFromUrl(url, mimeType) {
  if (!url || /^blob:/i.test(url) || /^data:/i.test(url)) return null;
  const cleanUrl = String(url);
  if (/\.(mp3|m4a|aac|wav)(\?|$)|audio\//i.test(`${cleanUrl} ${mimeType}`)) {
    return { kind: 'audio', url: cleanUrl, mimeType: mimeType || guessMimeType(cleanUrl) || 'audio/mpeg' };
  }
  if (/\.(mp4|m3u8)(\?|$)|video\/|application\/(?:vnd\.apple\.mpegurl|x-mpegurl)/i.test(`${cleanUrl} ${mimeType}`)) {
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

async function uploadDetectedMedia(item, cdp, { pdfOrdinal, uploadPdf = true, requiredKind } = {}) {
  const media = selectMediaForUpload(item, requiredKind);
  const pdf = uploadPdf ? item.media.find((entry) => entry.kind === 'pdf') : null;
  if (!media && !pdf) return;

  const headers = await browserHeaders(cdp, item.sourceUrl);

  if (media) {
    console.log(`Downloading media for upload: ${media.url}`);
    const extension = extensionForMedia(media);
    const localPath = resolve(tempDir, `${sanitizeFilename(item.title).slice(0, 80) || 'media'}-${Date.now()}${extension}`);
    const mimeType = isHlsMedia(media)
      ? 'video/mp2t'
      : media.mimeType || guessMimeType(localPath) || 'application/octet-stream';

    if (isHlsMedia(media)) {
      await downloadHls(media.url, localPath, headers);
    } else {
      await downloadBinary(media.url, localPath, headers);
    }

    const drive = await uploadToDrive(localPath, `${sanitizeFilename(item.title)}${extension}`, mimeType);
    if (media.kind === 'video') item.driveVideoUrl = `https://drive.google.com/file/d/${drive.id}/preview`;
    if (media.kind === 'audio') item.driveAudioUrl = `https://drive.google.com/file/d/${drive.id}`;
    rmSync(localPath, { force: true });
  }

  if (pdf) {
    console.log(`Downloading PDF for upload: ${pdf.url}`);
    const localPath = resolve(tempDir, `${sanitizeFilename(item.title).slice(0, 80) || 'analysis'}-${Date.now()}.pdf`);
    await downloadBinary(pdf.url, localPath, headers);
    const fileName = `서재형 투자학교 여름학기 ${pdfOrdinal || '다음'} 기업분석도감.pdf`;
    const drive = await uploadToDrive(localPath, fileName, 'application/pdf', { folderId: pdfGdriveFolderId });
    item.drivePdfUrl = drive.webViewLink || `https://drive.google.com/file/d/${drive.id}/view?usp=drive_link`;
    rmSync(localPath, { force: true });
  }
}

function selectMediaForUpload(item, requiredKind) {
  const candidates = item.media
    .filter((media) => !requiredKind || media.kind === requiredKind)
    .map((media, index) => ({ media, index, score: mediaUploadScore(media, item.title) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0]?.media || null;
}

function mediaUploadScore(media, title) {
  if (!media || !['video', 'audio'].includes(media.kind)) return 0;
  const descriptor = `${media.url || ''} ${media.mimeType || ''}`;
  if (/\.ts(?:\?|$)|video\/mp2t/i.test(descriptor)) return 0;

  if (media.kind === 'video') {
    if (/\.m3u8(?:\?|$)|application\/(?:vnd\.apple\.mpegurl|x-mpegurl)/i.test(descriptor)) return 400;
    if (/\.mp4(?:\?|$)|video\/mp4/i.test(descriptor)) return 300;
    return 200;
  }

  return isRegularClassRecordingTitle(title) ? 0 : 100;
}

async function probeExistingPostMedia({ cdp, posts, ids }) {
  ensureDir(tempDir);

  for (const id of ids) {
    const post = posts.find((item) => Number(item.id) === id);
    if (!post?.sourceUrl) throw new Error(`Post ${id} or its sourceUrl was not found.`);

    console.log(`Probing media for #${id}: ${post.sourceUrl}`);
    const item = await scrapeContent(cdp, post.sourceUrl, post.title);
    const media = selectMediaForUpload(item);
    if (!media || media.kind !== 'video') {
      const diagnostics = await evaluate(cdp, () => Array.from(document.querySelectorAll('button, a[href], [role="button"], iframe'))
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            tag: node.tagName,
            text: (node.innerText || node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 160),
            href: node.getAttribute('href') || node.getAttribute('src') || '',
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            top: Math.round(rect.top + window.scrollY),
            className: String(node.className || '').slice(0, 120),
          };
        })
        .filter((entry) => entry.width > 0 && entry.height > 0)
        .filter((entry) => entry.top < 3500 || /\uB179\uD654|\uC601\uC0C1|\uC7AC\uC0DD|video|play|media|stream/i.test(`${entry.text} ${entry.href}`))
        .slice(0, 80));
      diagnostics.forEach((entry) => console.log(`Visible media control: ${JSON.stringify(entry)}`));
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      const screenshotPath = resolve(tempDir, `probe-${id}-page.png`);
      writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
      console.log(`Media probe screenshot: ${screenshotPath}`);
      throw new Error(`Video media was not detected for post ${id}.`);
    }

    const extension = extensionForMedia(media);
    const localPath = resolve(tempDir, `probe-${id}-${Date.now()}${extension}`);
    const headers = await browserHeaders(cdp, post.sourceUrl);
    console.log(`Downloading probe video: ${media.url}`);

    try {
      if (isHlsMedia(media)) {
        await downloadHls(media.url, localPath, headers);
      } else {
        await downloadBinary(media.url, localPath, headers);
      }
      const bytes = statSync(localPath).size;
      if (bytes === 0) throw new Error(`Downloaded video for post ${id} was empty.`);
      console.log(`Media probe succeeded for #${id}: ${(bytes / 1024 / 1024).toFixed(1)} MB downloaded.`);
    } finally {
      rmSync(localPath, { force: true });
    }
  }
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

  writeFileSync(outputPath, Buffer.alloc(0));
  for (const segmentUrl of segmentUrls) {
    const response = await fetch(segmentUrl, { headers });
    if (!response.ok) throw new Error(`HLS segment download failed: HTTP ${response.status} ${segmentUrl}`);
    appendFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
  }
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

async function uploadToDrive(filePath, fileName, mimeType, { folderId = gdriveFolderId } = {}) {
  const accessToken = await getGoogleAccessToken();
  const metadata = { name: fileName };
  if (folderId) metadata.parents = [folderId];

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
  if (isHlsMedia(media)) return '.mp4';
  const match = new URL(media.url).pathname.match(/\.(mp3|m4a|aac|wav|mp4)$/i);
  if (match) return `.${match[1].toLowerCase()}`;
  return media.kind === 'audio' ? '.mp3' : '.mp4';
}

function isHlsMedia(media) {
  return /\.m3u8(?:\?|$)|application\/(?:vnd\.apple\.mpegurl|x-mpegurl)/i.test(`${media?.url || ''} ${media?.mimeType || ''}`);
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
