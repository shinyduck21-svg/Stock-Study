import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dedupeMedia,
  driveFileLookupQueries,
  driveFolderForMediaKind,
  driveMediaDedupeKey,
  fetchWithAuthRefresh,
  isAnalysisPostTitle,
  isPdfBuffer,
  mediaFromUrl,
  redactSensitiveMediaUrl,
  retainSuccessfulItems,
  sanitizeMediaRequestHeaders,
} from './sync-us-insight.mjs';

test('ordinary external links are not classified as PDFs', () => {
  assert.equal(mediaFromUrl('https://www.reuters.com/', ''), null);
  assert.equal(mediaFromUrl('https://us-campus.co.kr/', 'text/html'), null);
});

test('only explicitly tagged enterprise-analysis titles enable broad PDF discovery', () => {
  assert.equal(isAnalysisPostTitle('\uacf5\uc9c0: \uae30\uc5c5\ubd84\uc11d\ub3c4\uac10\uc774 \ub354 \ub4e0\ub4e0\ud574\uc9d1\ub2c8\ub2e4'), false);
  assert.equal(isAnalysisPostTitle('12\ud654. [\uae30\uc5c5\ubd84\uc11d\ub3c4\uac10] \uc5ec\ub984\ud559\uae30 \uc790\ub8cc'), true);
  assert.equal(isAnalysisPostTitle('[ \uae30\uc5c5 \ubd84\uc11d\ub3c4\uac10 ] \uc790\ub8cc'), true);
});

test('PDF classification requires a PDF path or exact response MIME type', () => {
  assert.equal(mediaFromUrl('https://example.com/report.pdf?download=1', '')?.kind, 'pdf');
  assert.equal(mediaFromUrl('https://example.com/api/file/42', 'application/pdf; charset=binary')?.kind, 'pdf');
  assert.equal(mediaFromUrl('https://example.com/pdf-viewer/article', 'text/html'), null);
});

test('audio HLS paths remain audio even though the extension is m3u8', () => {
  const media = mediaFromUrl('https://video.example.com/audio/prod/hls/episode.mpeg.m3u8', '');
  assert.equal(media?.kind, 'audio');
});

test('PDF payload validation rejects HTML and accepts a PDF signature', () => {
  assert.equal(isPdfBuffer(Buffer.from('<!doctype html><title>Login</title>')), false);
  assert.equal(isPdfBuffer(Buffer.from('%PDF-1.7\n1 0 obj')), true);
  assert.equal(isPdfBuffer(Buffer.concat([Buffer.alloc(32), Buffer.from('%PDF-1.7')])), true);
});

test('Drive dedupe key is stable per source and media kind', () => {
  const first = driveMediaDedupeKey({ sourceUrl: 'https://us-insight.com/secrets/27466/' }, 'video');
  const retry = driveMediaDedupeKey({ sourceUrl: 'https://us-insight.com/secrets/27466' }, 'video');
  const audio = driveMediaDedupeKey({ sourceUrl: 'https://us-insight.com/secrets/27466' }, 'audio');
  assert.equal(first, retry);
  assert.notEqual(first, audio);
});

test('Drive media routing separates videos from audio', () => {
  const folders = { audioFolderId: 'audio-folder', videoFolderId: 'video-folder' };
  assert.equal(driveFolderForMediaKind('audio', folders), 'audio-folder');
  assert.equal(driveFolderForMediaKind('video', folders), 'video-folder');
});

test('Drive lookup checks the stable key before the legacy filename fallback', () => {
  const queries = driveFileLookupQueries({
    fileName: "Teacher's class.mp4",
    mimeType: 'video/mp4',
    folderId: 'folder-id',
    dedupeKey: 'stable-key',
  });
  assert.equal(queries.length, 2);
  assert.match(queries[0], /appProperties has/);
  assert.match(queries[0], /stable-key/);
  assert.match(queries[1], /name = 'Teacher\\'s class\.mp4'/);
  assert.match(queries[1], /mimeType = 'video\/mp4'/);
});

test('media request headers preserve signed cookies without forwarding unsafe headers', () => {
  const headers = sanitizeMediaRequestHeaders(
    { Cookie: 'session=old', Host: 'video.example.com', ':authority': 'video.example.com' },
    { cookie: 'CloudFront-Key-Pair-Id=key; CloudFront-Signature=sig', Origin: 'https://example.com' },
  );
  assert.deepEqual(headers, {
    cookie: 'CloudFront-Key-Pair-Id=key; CloudFront-Signature=sig',
    origin: 'https://example.com',
  });
});

test('signed media URLs are redacted before logging', () => {
  const redacted = redactSensitiveMediaUrl(
    'https://video.example.com/audio.m3u8?Policy=secret&Signature=sig&Key-Pair-Id=key&safe=1',
  );
  assert.doesNotMatch(redacted, /secret|sig|key/);
  assert.match(redacted, /safe=1/);
  assert.match(redacted, /%5Bredacted%5D/);
});

test('media dedupe retains request headers observed after DOM discovery', () => {
  const media = dedupeMedia([
    { kind: 'audio', url: 'https://video.example.com/audio.m3u8', mimeType: 'audio/mpegurl' },
    {
      kind: 'audio',
      url: 'https://video.example.com/audio.m3u8',
      mimeType: 'audio/mpegurl',
      requestHeaders: { cookie: 'CloudFront-Key-Pair-Id=key' },
    },
  ]);
  assert.equal(media.length, 1);
  assert.equal(media[0].requestHeaders.cookie, 'CloudFront-Key-Pair-Id=key');
});

test('authorization failures refresh browser headers exactly once', async () => {
  const calls = [];
  const result = await fetchWithAuthRefresh('https://video.example.com/audio.m3u8', { cookie: 'expired' }, {
    fetchImpl: async (_url, options) => {
      calls.push(options.headers.cookie);
      return { ok: calls.length > 1, status: calls.length > 1 ? 200 : 403 };
    },
    refreshHeaders: async () => ({ cookie: 'fresh' }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.retried, true);
  assert.deepEqual(calls, ['expired', 'fresh']);
});

test('non-authorization HTTP failures do not trigger a credential refresh', async () => {
  let refreshCount = 0;
  const result = await fetchWithAuthRefresh('https://video.example.com/missing.m3u8', {}, {
    fetchImpl: async () => ({ ok: false, status: 404 }),
    refreshHeaders: async () => {
      refreshCount += 1;
      return {};
    },
  });
  assert.equal(result.response.status, 404);
  assert.equal(result.retried, false);
  assert.equal(refreshCount, 0);
});

test('one media failure does not block other new posts', async () => {
  const failed = [];
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const successful = await retainSuccessfulItems(items, async (item) => {
    if (item.id === 2) throw new Error('HTTP 403');
  }, (item) => failed.push(item.id));
  assert.deepEqual(successful.map((item) => item.id), [1, 3]);
  assert.deepEqual(failed, [2]);
});
