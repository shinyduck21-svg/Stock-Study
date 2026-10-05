import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export function parseSourceUrls(value) {
  if (!value) return [];
  return [...new Set(String(value).split(',').map((part) => {
    const raw = part.trim();
    let url;
    try { url = new URL(raw); } catch { throw new Error(`Expected a US Insight content URL: ${raw}`); }
    const isSecret = /^\/secrets\/\d+\/?$/.test(url.pathname);
    const isClubContent = /^\/club\/13\/(?:contents?|[^/]+\/)*\d+\/?$/.test(url.pathname)
      || (/^\/club\/13\/contents\/?$/.test(url.pathname)
        && ['contentId', 'contentsId', 'postId', 'articleId'].some((name) => url.searchParams.has(name)));
    if (url.protocol !== 'https:' || url.hostname !== 'us-insight.com'
      || url.username || url.password || (!isSecret && !isClubContent)) {
      throw new Error(`Expected a US Insight content URL: ${raw}`);
    }
    if (url.search) {
      const idParam = ['contentId', 'contentsId', 'postId', 'articleId']
        .find((name) => url.searchParams.has(name));
      const idValue = idParam ? url.searchParams.get(idParam) : null;
      url.search = '';
      if (!isSecret && idParam) url.searchParams.set(idParam, idValue);
    }
    url.hash = '';
    return url.href.replace(/\/$/, '');
  }))];
}

export function combineScanAndPendingLinks(scanLinks, pendingUrls, existingSources) {
  const seen = new Set();
  const current = scanLinks.filter((link) => {
    const key = link.url.replace(/\/$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const pending = pendingUrls.filter((url) => {
    const key = url.replace(/\/$/, '');
    if (seen.has(key) || existingSources.has(key)) return false;
    seen.add(key);
    return true;
  }).map((url) => ({ url, title: url }));
  return [...current, ...pending];
}

export function shouldUploadPdfForSource(sourceUrl, allowMissingPdfSources) {
  return !allowMissingPdfSources.has(String(sourceUrl || '').replace(/\/$/, ''));
}

export class PendingSources {
  constructor(filePath) {
    this.filePath = filePath;
    const contents = existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : [];
    if (!Array.isArray(contents)) throw new Error(`Pending sources file must be an array: ${filePath}`);
    this.urls = parseSourceUrls(contents.join(','));
  }

  list() {
    return [...this.urls];
  }

  add(url) {
    const [normalized] = parseSourceUrls(url);
    if (this.urls.includes(normalized)) return;
    this.urls.push(normalized);
    this.save();
  }

  remove(url) {
    const [normalized] = parseSourceUrls(url);
    const next = this.urls.filter((item) => item !== normalized);
    if (next.length === this.urls.length) return;
    this.urls = next;
    this.save();
  }

  save() {
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(this.urls, null, 2)}\n`, 'utf8');
    renameSync(temporaryPath, this.filePath);
  }
}
