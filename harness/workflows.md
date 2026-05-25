# Stock-Study 워크플로

## 오디오 재생 디버깅

1. 게시글을 찾는다.
   - `public/data/posts.json`에서 제목 또는 id로 검색한다.
   - `type`, `audioUrl`, `url`, `fileName`을 확인한다.

2. Drive URL 형태를 확인한다.
   - Drive id를 추출한다.
   - 직접 재생 시도 URL을 만든다: `https://drive.google.com/uc?export=download&id=<id>`.
   - Preview URL을 만든다: `https://drive.google.com/file/d/<id>/preview`.

3. 앱 동작을 확인한다.
   - `PremiumAudioPlayer`는 먼저 직접 재생을 시도해야 한다.
   - `onError` 또는 `play().catch`는 fallback UI를 보여줘야 한다.
   - fallback은 Drive preview를 앱 안에 임베드하거나 새 창으로 열 수 있어야 한다.

4. 검증한다.
   - `.codex/skills/stock-study-web-harness/scripts/diagnose.ps1 -TitleContains "<제목 일부>"`를 실행한다.
   - `npm.cmd run build`를 실행한다.
   - 브라우저 사용이 가능하면 영향을 받은 페이지를 연다.

## 새 콘텐츠 등록

1. `public/docs/` 아래에 Markdown을 추가한다.
2. `public/data/posts.json`에 객체 하나를 추가한다.
3. 다음 안정적인 `id`를 사용한다.
4. 미디어 필드가 지원되는 URL 형태인지 확인한다.
5. 빌드한 뒤 피드/상세 화면 렌더링을 간단히 확인한다.

## 릴리즈 점검

1. `npm.cmd run build`
2. `git diff --check`로 변경 파일 확인
3. 콘텐츠가 바뀌었으면 `public/data/posts.json` 검토
4. UI가 바뀌었으면 Vite preview/dev 서버 실행
5. 남은 위험 요약
