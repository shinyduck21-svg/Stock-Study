# Stock-Study 프로젝트 하네스

이 문서는 `Stock-Study`에서 공통 하네스와 루프를 적용할 때 사용하는 프로젝트별 기준이다. 기존 로컬 하네스인 `AGENTS.md`, `harness/rules.md`, `harness/workflows.md`, `.codex/skills/stock-study-web-harness/SKILL.md`를 보완한다.

## 1. 프로젝트 정보

- 프로젝트명: Stock-Study
- 목적: 주식 투자 학습 콘텐츠를 글, 오디오, 영상 형태로 제공하는 React/Vite 웹앱
- 최종 산출물: GitHub Pages 경로 `/Stock-Study/`에서 동작하는 정적 웹앱
- 주요 사용자: 투자 학습 콘텐츠를 소비하는 웹/모바일 사용자
- 주요 데이터: `public/data/posts.json`, `public/docs/*.md`, Google Drive/YouTube 등 외부 미디어 링크
- 주요 정적 앱 파일: `vite.config.js`, `public/manifest.webmanifest`, `public/sw.js`, `public/assets/*`

## 2. 기본 성공 기준

- 앱이 `/Stock-Study/` base path에서 정상 빌드되고 배포 가능한 상태를 유지한다.
- 사용자가 피드, 상세 콘텐츠, 카테고리, 미디어 재생 또는 fallback을 끊김 없이 사용할 수 있다.
- `public/data/posts.json`의 콘텐츠 id, 제목, 타입, 파일명, 미디어 URL이 실제 렌더링과 일치한다.
- Markdown 콘텐츠는 `public/docs/`의 실제 파일과 연결된다.
- Google Drive 미디어는 직접 재생 실패 시 preview fallback 또는 명확한 대체 경로를 제공한다.
- 모바일과 데스크톱에서 주요 UI가 겹치거나 깨지지 않는다.
- PWA manifest, service worker, 정적 아이콘 경로가 `/Stock-Study/` 기준으로 유지된다.
- 코드 변경 후 `npm.cmd run build`가 통과한다.

## 3. 기본 실패 기준

아래 중 하나라도 해당하면 최종 완료로 보지 않고 수정 루프를 돌린다.

- `npm.cmd run build` 실패
- `/Stock-Study/` base path 깨짐
- 기존 피드, 상세 화면, 카테고리 필터, 검색/탐색 흐름의 회귀
- `posts.json` 대량 재포맷 또는 요청과 무관한 콘텐츠 변경
- 게시글 id, `fileName`, `type`, `url`, `audioUrl`의 불일치
- Markdown 파일 누락 또는 잘못된 파일명 참조
- Google Drive 미디어 직접 재생 실패 후 fallback 부재
- 모바일에서 메뉴, 버튼, 오디오/비디오 플레이어, 카드 텍스트가 겹침
- 외부 공개 페이지에 깨진 링크, 깨진 이미지, 깨진 미디어가 생김
- `manifest.webmanifest`, `sw.js`, 앱 아이콘 경로 변경으로 설치형 앱이나 오프라인 fallback이 깨짐
- 민감한 토큰, 인증 파일, 개인 정보가 코드나 정적 산출물에 노출됨

## 4. 작업 유형별 기준

### 기능 구현

성공 기준:

- 기존 컴포넌트 구조와 스타일 패턴을 우선한다.
- 변경 범위가 요청한 기능에 직접 필요한 파일로 제한된다.
- 새 UI는 모바일과 데스크톱 모두에서 사용할 수 있다.
- 빌드가 통과하고, 가능하면 브라우저에서 영향 화면을 확인한다.

실패 기준:

- 기능 구현 중 관련 없는 리팩터링 또는 시각적 재설계를 동반함
- 기존 콘텐츠 렌더링, 미디어 재생, 필터링 동작을 깨뜨림
- 새 상태나 이벤트가 화면 전환 후 꼬임

### 콘텐츠 추가 또는 수정

성공 기준:

- `posts.json`에는 필요한 항목만 추가/수정한다.
- 새 콘텐츠는 안정적인 새 `id`와 실제 존재하는 `fileName`을 가진다.
- Markdown 본문은 `public/docs/`에 저장되고 앱에서 렌더링 가능하다.
- 미디어 URL이 있으면 타입과 fallback 경로를 함께 고려한다.

실패 기준:

- 기존 콘텐츠 순서, id, 파일명을 불필요하게 바꿈
- JSON 전체를 대량 재포맷함
- 파일명은 등록했지만 실제 Markdown 파일이 없음
- 인코딩이 깨진 항목을 임의로 대규모 수정함

### 미디어 재생 디버깅

성공 기준:

- 대상 게시글을 `id`, 제목, `type`, `url`, `audioUrl`, `fileName`으로 확인한다.
- Google Drive 파일 id를 추출해 직접 다운로드 URL과 preview URL을 모두 검토한다.
- 직접 재생 실패 시 사용자가 fallback을 사용할 수 있다.
- 관련 작업 후 진단 스크립트와 빌드를 실행한다.

권장 검증:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .codex\skills\stock-study-web-harness\scripts\diagnose.ps1 -PostId <게시글ID>
npm.cmd run build
```

실패 기준:

- Drive 링크를 HTML5 미디어 소스로 무조건 재생 가능하다고 가정함
- `play().catch` 또는 `onError` 실패 처리가 없음
- fallback 없이 재생 버튼만 실패함

### UI 변경

성공 기준:

- 기존 디자인 톤을 유지하되, 사용성 문제를 명확히 해결한다.
- 버튼, 메뉴, 카드, 플레이어는 안정적인 크기와 반응형 제약을 가진다.
- 모바일 폭과 데스크톱 폭에서 텍스트 겹침과 컨트롤 밀림이 없다.

권장 검증:

- 로컬 Vite 서버 또는 preview에서 영향 화면 확인
- 모바일 폭 약 390px, 데스크톱 폭 약 1440px 기준 확인
- 빌드 통과

실패 기준:

- 텍스트가 버튼/카드/플레이어 안에서 잘림 또는 겹침
- 모바일 메뉴나 그룹 선택 UI가 화면 밖으로 밀림
- 페이지 전체 색상/구조를 요청 없이 크게 바꿈

### PWA, 정적 자산, base path 변경

성공 기준:

- `vite.config.js`의 `base: '/Stock-Study/'` 의도를 유지한다.
- `public/manifest.webmanifest`의 `start_url`, `scope`, 아이콘 경로가 `/Stock-Study/` 기준과 일치한다.
- `public/sw.js`의 cache URL과 navigate fallback이 `/Stock-Study/` 기준과 일치한다.
- 아이콘, manifest, service worker 변경 후 빌드가 통과한다.

실패 기준:

- 루트 경로 `/` 기준으로 정적 경로를 바꿔 GitHub Pages 배포를 깨뜨림
- service worker 캐시 이름 또는 캐시 목록 변경 후 이전 캐시 정리나 fallback을 고려하지 않음
- manifest 아이콘 경로와 실제 파일 위치가 불일치함

### 배포 또는 릴리즈 점검

성공 기준:

- `npm.cmd run build` 통과
- `dist/` 산출물이 `/Stock-Study/` 경로 기준으로 생성됨
- GitHub Pages에서 필요한 정적 파일 경로가 깨지지 않음
- 변경 파일과 배포 영향이 명확히 정리됨

권장 검증:

```powershell
npm.cmd run build
git diff --check
```

실패 기준:

- base path 변경으로 정적 자산 경로가 깨짐
- 배포 산출물에는 반영됐지만 소스와 불일치
- 인증 파일이나 로컬 임시 파일이 배포 대상에 포함됨

### 자동화, 인증, 외부 연동 스크립트

성공 기준:

- `scripts/google-drive-auth.mjs`, `scripts/sync-us-insight.mjs`, `auto_publisher.py` 변경 시 인증 파일과 토큰 처리 방식을 명확히 확인한다.
- `credentials.json`, `token.json`, `chrome_profile/`, 임시 미디어 파일은 로컬 전용으로 유지한다.
- 외부 API, Google Drive, GitHub Pages와 관련된 변경은 실행 권한과 실패 시 복구 방법을 보고한다.

실패 기준:

- 인증 파일, 토큰, 브라우저 프로필, 다운로드된 미디어를 커밋 대상으로 추가함
- 외부 서비스에 쓰기 작업을 하면서 사용자 승인이나 영향 범위를 명확히 하지 않음
- 자동 게시나 동기화 스크립트 변경 후 dry-run 또는 제한된 검증 없이 성공으로 보고함

## 5. 자동 검증 기준

기본:

```powershell
npm.cmd run build
```

릴리즈 전 권장:

```powershell
git diff --check
```

미디어/콘텐츠 디버깅 시 권장:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .codex\skills\stock-study-web-harness\scripts\diagnose.ps1 -PostId <게시글ID>
```

정적 앱/PWA 변경 시 권장:

```powershell
npm.cmd run build
```

확인 대상:

- `vite.config.js`의 base path
- `public/manifest.webmanifest`의 `start_url`, `scope`, `icons[].src`
- `public/sw.js`의 `APP_SHELL`, navigate fallback

참고:

- `npm.cmd run lint`는 기존 오류를 포함할 수 있으므로 현재 좁은 수정의 차단 조건으로 보지 않는다.
- lint 정리 작업을 별도로 요청받은 경우에만 lint 실패를 직접 해결 대상으로 삼는다.

## 6. 사람 검토 필요 항목

- 투자 판단, 종목 추천, 수익률 표현 등 금융적 책임이 생길 수 있는 문구
- 외부 공개용 보도자료, 홍보 문구, 유료 콘텐츠 안내
- 대량 콘텐츠 정리 또는 `posts.json` 구조 변경
- Google Drive 권한, 계정, quota, 인증 범위와 관련된 문제
- 배포 권한, GitHub Pages 설정, 인증 파일 처리
- service worker 캐시 정책 변경
- 외부 API나 자동 게시 스크립트의 쓰기 작업

## 7. 루프 적용 기준

표준 루프를 적용할 작업:

- 새 기능 구현
- 미디어 재생 버그 수정
- 콘텐츠 등록 자동화 수정
- 모바일/데스크톱 UI 변경
- 배포 전 릴리즈 점검

엄격 루프를 적용할 작업:

- 외부 공개 직전 변경
- `posts.json` 대량 변경
- 인증, Google Drive, 자동 게시 스크립트 수정
- PWA/service worker/base path 수정
- 금융 정보 표현이나 투자 판단 문구가 들어가는 콘텐츠

루프 형식:

```text
목표 정의
→ 성공/실패 기준 확인
→ 구현 또는 초안 작성
→ 하네스 검토
→ 실패 항목 수정
→ 빌드/진단/화면 확인
→ 남은 리스크 보고
```

## 8. 최종 보고 형식

작업 완료 시 다음을 간단히 보고한다.

```text
결과:
검증:
하네스 통과 여부:
남은 리스크:
사람 검토 필요 항목:
```
