# Oracle VPS 매시간 자동 동기화

이 프로젝트는 Oracle VPS에서 새 US Insight 글을 가져온 뒤, 변경된 콘텐츠를 빌드하고 GitHub에 자동으로 커밋/푸시할 수 있습니다.

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

GitHub push 권한은 SSH deploy key 또는 GitHub token을 사용하는 HTTPS remote로 설정하면 됩니다. cron을 켜기 전에 아래 명령으로 push 권한을 먼저 확인합니다.

```bash
git push --dry-run origin HEAD:main
```

## 3. 수동 실행 테스트

cron에 등록하기 전에 VPS에서 한 번 직접 실행합니다.

```bash
cd ~/Stock-Study
CHROME_HEADLESS=1 bash scripts/vps-hourly-sync.sh
```

이 스크립트는 다음 순서로 실행됩니다.

1. `git pull --ff-only`
2. `npm run sync:us-insight:new`
3. 생성 콘텐츠가 바뀐 경우에만 `npm run build`
4. `git add public/data/posts.json public/docs`
5. `git commit`
6. `git push origin HEAD:main`

실행 로그는 `logs/vps-hourly-sync.log`에 기록됩니다.

## 4. 매시간 cron 등록

crontab을 엽니다.

```bash
crontab -e
```

아래 내용을 추가합니다.

```cron
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
CHROME_HEADLESS=1

7 * * * * cd /home/ubuntu/Stock-Study && bash scripts/vps-hourly-sync.sh
```

저장소 경로가 다르면 `/home/ubuntu/Stock-Study`를 실제 경로로 바꿉니다. `7 * * * *`는 매시간 7분에 실행한다는 뜻입니다.

## 운영 참고사항

- 스크립트는 `flock`을 사용하므로 이전 실행이 끝나지 않았으면 새 실행은 조용히 종료됩니다.
- 자동 커밋 대상은 생성 콘텐츠인 `public/data/posts.json`, `public/docs`로 제한됩니다.
- `main` 브랜치에 push되면 GitHub Pages 배포는 `.github/workflows/deploy.yml`이 처리합니다.
- 커밋 전에 동기화가 실패하면 `logs/vps-hourly-sync.log`를 확인하고, 세션 또는 인증 파일을 고친 뒤 수동으로 한 번 다시 실행합니다.
