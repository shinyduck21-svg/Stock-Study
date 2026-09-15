# YouTube audio upload setup

New audio posts are downloaded once, converted to a still-image MP4, and uploaded to YouTube as `unlisted`. Audio files are no longer uploaded to Google Drive. Existing Drive audio URLs, Drive video uploads, and Drive PDF uploads remain unchanged.

## Google Cloud and channel authorization

1. Enable **YouTube Data API v3** in the Google Cloud project used by `youtube-credentials.json`.
2. On a computer with a browser, run:

   ```powershell
   npm.cmd run auth:youtube
   ```

3. Sign in to the account that owns the target YouTube channel and approve access.
4. Copy the redirected URL back into the prompt. This creates the ignored file `youtube-token.json`.
5. Copy `youtube-token.json` to the repository root on the VPS. Do not commit it.

The YouTube credentials and token are intentionally separate from the existing Drive credentials and token. The YouTube token requests only the `youtube.upload` scope.

## VPS prerequisite

Install and verify ffmpeg:

```bash
sudo apt update
sudo apt install -y ffmpeg
ffmpeg -version
```

The default cover is `scripts/assets/youtube-audio-cover.png`. Override it with `YOUTUBE_COVER_PATH` if needed. Override token or registry locations with `YOUTUBE_TOKEN_PATH` and `YOUTUBE_REGISTRY_PATH`.

The local ignored registry `youtube-upload-registry.json` records source hashes and returned video IDs so retries do not upload the same audio twice. Back this file up together with the VPS credentials.

## First live check

Run the normal sync manually before relying on cron:

```bash
cd ~/Stock-Study
CHROME_HEADLESS=1 npm run sync:us-insight:new
```

Confirm that the new post has `youtubeUrl`, no new `audioUrl`, and that the video appears as **Unlisted** in YouTube Studio. A newer unaudited API project can force API uploads to Private; the sync logs a warning when the returned status is not Unlisted.
