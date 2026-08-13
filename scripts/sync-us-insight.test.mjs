import assert from 'node:assert/strict';
import test from 'node:test';

import {
  driveFileLookupQueries,
  driveFolderForMediaKind,
  driveMediaDedupeKey,
  isAnalysisPostTitle,
  isPdfBuffer,
  mediaFromUrl,
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
