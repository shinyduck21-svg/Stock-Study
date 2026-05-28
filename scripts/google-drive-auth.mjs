import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const credentialsPath = resolve(rootDir, 'credentials.json');
const tokenPath = resolve(rootDir, 'token.json');
const scope = 'https://www.googleapis.com/auth/drive.file';

const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8')).installed;

if (!credentials) {
  throw new Error('credentials.json must contain an "installed" OAuth client.');
}

const redirectUri = credentials.redirect_uris?.[0] || 'http://localhost';
const authUrl = new URL(credentials.auth_uri || 'https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', credentials.client_id);
authUrl.searchParams.set('redirect_uri', redirectUri);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', scope);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

console.log('\nOpen this URL in your browser and approve Google Drive access:\n');
console.log(authUrl.toString());
console.log('\nAfter approval, the browser may show a localhost error page.');
console.log('Copy the full redirected URL from the address bar, or copy only the code= value.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question('Redirected URL or code: ')).trim();
rl.close();

const code = extractCode(answer);
if (!code) {
  throw new Error('Could not find an authorization code.');
}

const response = await fetch(credentials.token_uri || 'https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: credentials.client_id,
    client_secret: credentials.client_secret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  }),
});

if (!response.ok) {
  throw new Error(`Token exchange failed: HTTP ${response.status} ${await response.text()}`);
}

const token = await response.json();
if (!token.refresh_token) {
  throw new Error('Google did not return a refresh_token. Re-run the script and make sure you approve the consent screen.');
}

const tokenFile = {
  client_id: credentials.client_id,
  client_secret: credentials.client_secret,
  refresh_token: token.refresh_token,
  token_uri: credentials.token_uri || 'https://oauth2.googleapis.com/token',
  scope,
};

writeFileSync(tokenPath, `${JSON.stringify(tokenFile, null, 2)}\n`, 'utf8');
console.log(`\nCreated ${tokenPath}`);

function extractCode(value) {
  if (!value) return '';
  if (!value.includes('://') && !value.includes('code=')) return value;

  try {
    const parsed = new URL(value);
    return parsed.searchParams.get('code') || '';
  } catch {
    const match = value.match(/[?&]code=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }
}
