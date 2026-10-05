import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  PendingSources,
  combineScanAndPendingLinks,
  parseSourceUrls,
  shouldUploadPdfForSource,
} from './sync-pending.mjs';

const first = 'https://us-insight.com/secrets/31991';
const second = 'https://us-insight.com/secrets/32402';
const third = 'https://us-insight.com/secrets/32424';

test('failed sources survive restart, retry beyond the latest page, and disappear only after success', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stock-sync-pending-'));
  try {
    const path = join(dir, 'pending.json');
    const pending = new PendingSources(path);
    pending.add(first);
    pending.add(second);
    pending.add(first);
    const restarted = new PendingSources(path);
    assert.deepEqual(restarted.list(), [first, second]);
    const links = combineScanAndPendingLinks(
      [{ url: third, title: 'newest' }],
      restarted.list(),
      new Set(),
    );
    assert.deepEqual(links.map((link) => link.url), [third, first, second]);
    restarted.remove(first);
    assert.deepEqual(new PendingSources(path).list(), [second]);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), [second]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pending retry preserves current-page ordering and does not duplicate or retry imported sources', () => {
  const links = combineScanAndPendingLinks(
    [{ url: first, title: 'current' }],
    [first, second, third],
    new Set([first, second]),
  );
  assert.deepEqual(links.map((link) => link.url), [first, third]);
});

test('manual backfill accepts only US Insight content pages', () => {
  assert.deepEqual(parseSourceUrls(`${first},${second}`), [first, second]);
  assert.deepEqual(parseSourceUrls('https://us-insight.com/club/13/contents/123'), ['https://us-insight.com/club/13/contents/123']);
  assert.deepEqual(parseSourceUrls(`${first}?token=private`), [first]);
  assert.throws(() => parseSourceUrls('https://example.com/secrets/1'), /US Insight/);
  assert.throws(() => parseSourceUrls('https://name:password@us-insight.com/secrets/1'), /US Insight/);
  assert.throws(() => parseSourceUrls('https://us-insight.com/signin'), /US Insight/);
});

test('PDF omission applies only to explicitly named source', () => {
  const allowMissingPdfSources = new Set([third]);
  assert.equal(shouldUploadPdfForSource(third, allowMissingPdfSources), false);
  assert.equal(shouldUploadPdfForSource(second, allowMissingPdfSources), true);
});
