# Oracle VPS 매시간 자동 동기화

이 프로젝트는 Oracle VPS에서 새 US Insight 글을 가져온 뒤, 변경된 콘텐츠를 빌드하고 GitHub에 자동으로 커밋/푸시할 수 있습니다. 새 글이 실제로 올라간 경우 Telegram으로 성공 알림도 보낼 수 있습니다.

## 1. 서버 준비

저장소를 Oracle VPS에 clone한 뒤 아래 명령을 실행합니다.

```bash
sudo apt update
sudo apt install -y git curl ca-certificates chromium-browser
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

cd ~/Stock-Study
npm ci
```

`npm ci`에서 `package-lock.json`이 없다는 오류가 나면 저장소가 최신 상태인지 먼저 확인합니다. 이 프로젝트의 `package-lock.json`은 git 추적 대상입니다.

```bash
cd ~/Stock-Study
git status
git pull origin main
ls -l package-lock.json
```

그래도 `package-lock.json`이 없다면 임시로 아래 명령을 실행해 설치할 수 있습니다.

```bash
npm install
```

Chromium 또는 Chrome이 기본 경로가 아닌 곳에 설치되어 있다면 crontab 환경 변수에 `CHROME_PATH`를 지정합니다.

## 2. 인증 파일과 브라우저 세션

자동 동기화에는 아래 항목이 필요합니다.

- `credentials.json`
- `token.json`
- Naver 로그인이 완료된 `chrome_profile/`
- GitHub 저장소에 push할 수 있는 git 권한

`credentials.json`, `token.json`, `chrome_profile/`은 의도적으로 git에 포함하지 않습니다. `scp`로 VPS에 복사하거나 서버에서 직접 생성하세요. Naver 세션이 만료되면 비공개 콘텐츠를 다시 가져올 수 없으므로 `chrome_profile/`을 갱신해야 합니다.

### 로그인에 사용하는 Chrome 프로필 경로

동기화 프로그램은 작업 디렉터리와 관계없이 `/home/ubuntu/Stock-Study/chrome_profile`을 사용합니다. 수동 로그인에도 **같은 절대 경로**를 지정해야 합니다. 특히 `~/Stock-Study/logs`에서 `--user-data-dir="$PWD/chrome_profile"`을 실행하면 `logs/chrome_profile`에 로그인하게 되어 동기화에는 적용되지 않습니다.

cron 실행과 수동 로그인이 겹치지 않도록 로그인 중에는 해당 cron 항목을 잠시 비활성화합니다. VPS에서 화면을 띄울 수 있는 SSH/X11 세션을 사용하고, 기존 Chrome을 종료한 뒤 다음과 같이 실행합니다.

```bash
cd /home/ubuntu/Stock-Study
CHROME_BIN="$(command -v google-chrome-stable || command -v google-chrome || command -v chromium-browser || command -v chromium)"
XAUTHORITY="$HOME/.Xauthority" "$CHROME_BIN" \
  --user-data-dir=/home/ubuntu/Stock-Study/chrome_profile \
  --profile-directory=Default --disable-dev-shm-usage \
  'https://us-insight.com/club/13/contents?type=all'
```

사이트에 로그인해 목록이 보이는지 확인하고 Chrome을 정상 종료합니다. 그런 다음 cron을 켜기 전에 같은 프로필을 사용하는 비대화형 실행으로 확인합니다.

```bash
cd /home/ubuntu/Stock-Study
CHROME_HEADLESS=1 node scripts/sync-us-insight.mjs --since-last --dry-run --skip-media
```

여기에서도 로그인 화면이 나오면 Chrome 종료·프로필 저장 상태와 사이트 세션 만료를 확인해야 합니다. X11의 `No authorisation provided` 또는 `Missing X server or $DISPLAY` 오류는 로그인 상태가 아니라 화면 연결 문제입니다.

동기화에서 `Naver login is required`가 나오면 바로 앞의 `Login diagnostics` 줄을 확인합니다. `url`은 쿼리 문자열을 제외한 주소이며, `reason`, `passwordInput`, `contentLinkCount`는 실제 로그인 화면인지 구분하는 단서입니다. `reason=sign-in URL` 또는 `password form`이면 해당 프로필의 사이트 로그인 상태를 확인하고, URL이 콘텐츠 목록인데 링크 수가 0이면 페이지 로딩이나 사이트 변경 가능성을 먼저 확인합니다.

GitHub push 권한은 SSH deploy key 또는 GitHub token을 사용하는 HTTPS remote로 설정하면 됩니다. cron을 켜기 전에 아래 명령으로 push 권한을 먼저 확인합니다.

```bash
git push --dry-run origin HEAD:main
```

## 3. Telegram 알림 준비

새 글이 commit/push까지 성공했을 때 Telegram 메시지를 받으려면 봇 토큰과 chat id가 필요합니다.

1. Telegram에서 `@BotFather`에게 `/newbot`을 보내 봇을 만들고 bot token을 받습니다.
2. 만든 봇에게 아무 메시지나 한 번 보냅니다.
3. VPS에서 아래 명령으로 chat id를 확인합니다.

```bash
curl "https://api.telegram.org/bot<봇_토큰>/getUpdates"
```

응답 JSON에서 `chat` 안의 `id` 값을 사용합니다. 예를 들어 `"chat":{"id":123456789,...}`처럼 나오면 `TELEGRAM_CHAT_ID`는 `123456789`입니다.

알림 테스트는 아래처럼 할 수 있습니다.

```bash
curl -X POST "https://api.telegram.org/bot<봇_토큰>/sendMessage" \
  -d "chat_id=<chat_id>" \
  -d "text=Stock-Study Telegram 알림 테스트"
```

## 4. 수동 실행 테스트

cron에 등록하기 전에 VPS에서 한 번 직접 실행합니다.

```bash
cd ~/Stock-Study
CHROME_HEADLESS=1 \
TELEGRAM_BOT_TOKEN="<봇_토큰>" \
TELEGRAM_CHAT_ID="<chat_id>" \
bash scripts/vps-hourly-sync.sh
```

이 스크립트는 다음 순서로 실행됩니다.

1. `git pull --ff-only`
2. `npm run sync:us-insight:new`
3. 생성 콘텐츠가 바뀐 경우에만 `npm run build`
4. `git add public/data/posts.json public/docs`
5. `git commit`
6. `git push origin HEAD:main`
7. 새 글이 push된 경우 Telegram 성공 알림 전송

Telegram 메시지는 아래 형식으로 전송됩니다.

```text
[담샘 여름학기] 새 글 2개가 올라왔습니다.

1. 7화. [기업분석도감] 여름학기 일곱번째 기업분석도감이 도착했습니다!
2. 1061화.  7월4 일 담쌤의 언제나 데이트
```

실행 로그는 `logs/vps-hourly-sync.log`에 기록됩니다.

## 5. 매시간 cron 등록

crontab을 엽니다.

```bash
crontab -e
```

아래 내용을 추가합니다.

```cron
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
CHROME_HEADLESS=1
TELEGRAM_BOT_TOKEN=봇_토큰
TELEGRAM_CHAT_ID=chat_id

7 * * * * cd /home/ubuntu/Stock-Study && bash scripts/vps-hourly-sync.sh
```

저장소 경로가 다르면 `/home/ubuntu/Stock-Study`를 실제 경로로 바꿉니다. `7 * * * *`는 매시간 7분에 실행한다는 뜻입니다.

## 운영 참고사항

### 누락 게시물 다시 가져오기

동기화 중 오디오가 준비되지 않았거나 미디어 업로드가 실패한 원본 URL은 VPS의 `.sync-pending-sources.json`에 보관됩니다. 다음 실행에서는 원본 사이트의 최신 목록(현재 한 페이지에 약 10개)에서 사라져도 이 URL을 다시 시도합니다. 이 파일은 Git에 포함되지 않으므로 VPS 백업에 포함하세요. 성공적으로 등록된 URL과 이미 등록된 URL은 목록에서 제거됩니다.

과거에 실패해 목록에서 이미 사라진 글은 최신 코드가 VPS에 반영된 뒤 수동으로 재시도 목록에 넣을 수 있습니다. cron 실행 시간과 겹치지 않게 아래 명령을 실행하세요. `--allow-missing-pdf-sources`는 지정한 원본 하나에만 PDF 업로드를 생략하며, 게시글에는 `pdfUrl`을 넣지 않습니다.

```bash
cd /home/ubuntu/Stock-Study
flock -n .sync-us-insight.lock node scripts/sync-us-insight.mjs --since-last \
  --backfill-sources https://us-insight.com/secrets/31991,https://us-insight.com/secrets/32402,https://us-insight.com/secrets/32424 \
  --allow-missing-pdf-sources https://us-insight.com/secrets/32424
bash scripts/vps-hourly-sync.sh </dev/null
```

10월 1일 굿모닝 글은 원본 오디오가 계속 없으면 재시도 목록에 남습니다. 6회차 녹화본은 YouTube 업로드가 성공해야 등록됩니다. PDF 없이 먼저 등록한 글의 ID는 `posts.json`에서 원본 URL `https://us-insight.com/secrets/32424`로 찾을 수 있습니다. Drive 용량을 확보한 뒤 해당 ID로 PDF만 복구하고, 다시 동기화 스크립트를 실행해 커밋/푸시합니다.

```bash
POST_ID=566  # 실제 게시글 ID로 변경
flock -n .sync-us-insight.lock node scripts/sync-us-insight.mjs --repair-pdf-ids "$POST_ID"
bash scripts/vps-hourly-sync.sh </dev/null
```

PDF가 누락된 새 게시글에도 위 PDF 복구 명령을 사용할 수 있습니다. Drive 용량이 부족한 동안 일반 PDF 게시글은 기존처럼 보류되고 재시도 목록에 남습니다.

- Telegram 알림은 새 글이 실제로 commit/push된 경우에만 전송됩니다.
- `TELEGRAM_BOT_TOKEN` 또는 `TELEGRAM_CHAT_ID`가 없으면 알림만 건너뛰고 동기화는 계속 진행됩니다.
- Telegram 전송이 실패해도 이미 성공한 동기화와 push를 실패로 처리하지 않습니다. 실패 여부는 로그에 남습니다.
- 새 글에 PDF가 있으면 Google Drive 폴더 `10. 서재형 투자학교 여름학기(26년) -> 기업분석도감`에 업로드하고, 게시글의 `pdfUrl`에 Drive 링크를 저장합니다.
- PDF 파일명은 `서재형 투자학교 여름학기 X번째 기업분석도감.pdf` 형식을 사용합니다. X는 게시글 제목의 한글 순번을 우선 사용하고, 없으면 기존 여름학기 기업분석도감 PDF 개수 기준으로 계산합니다.
- 스크립트는 `flock`을 사용하므로 이전 실행이 끝나지 않았으면 새 실행은 조용히 종료됩니다.
- 자동 커밋 대상은 생성 콘텐츠인 `public/data/posts.json`, `public/docs`로 제한됩니다.
- `main` 브랜치에 push되면 GitHub Pages 배포는 `.github/workflows/deploy.yml`이 처리합니다.
- 커밋 전에 동기화가 실패하면 `logs/vps-hourly-sync.log`를 확인하고, 세션 또는 인증 파일을 고친 뒤 수동으로 한 번 다시 실행합니다.
