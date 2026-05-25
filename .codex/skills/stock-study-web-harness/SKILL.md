---
name: stock-study-web-harness
description: Stock-Study React/Vite 웹앱을 위한 프로젝트 하네스. Codex가 이 프로젝트의 디버깅, 수정, 검증, 배포 준비를 맡을 때 사용한다. 특히 미디어 재생, Google Drive 링크, 게시글 메타데이터, Markdown 콘텐츠, 빌드 문제, UI 회귀, 릴리즈 점검에 사용한다.
---

# Stock-Study 웹 하네스

이 스킬은 Stock-Study 웹앱을 반복 가능한 절차로 다루기 위한 기준이다. 로컬 데이터를 확인하고, 작은 범위로 수정하고, 빌드/런타임 검증을 수행한 뒤 남은 위험을 명확히 보고한다.

## 작업 루프

1. 편집하기 전에 관련 파일을 읽는다.
   - 앱 동작: `src/App.jsx`
   - 스타일: `src/App.css`, `src/index.css`
   - 콘텐츠 메타데이터: `public/data/posts.json`
   - Markdown 본문: `public/docs/*.md`
   - 빌드 설정: `vite.config.js`, `package.json`

2. 안정적인 필드로 콘텐츠 항목을 식별한다.
   - `id`, `title`, `type`, `url`, `audioUrl`, `fileName`을 우선한다.
   - Google Drive 미디어는 `/file/d/<id>` 또는 `?id=<id>`에서 파일 id를 추출한다.

3. 사용자에게 보이는 문제를 고치는 가장 작은 수정을 한다.
   - 버그 수정 중에는 관련 없는 인코딩 정리, 문구 재작성, 대규모 리팩터링을 하지 않는다.
   - 정렬 관련 작업이 아니라면 기존 데이터 순서를 유지한다.

4. 검증한다.
   - `npm.cmd run build`를 실행한다.
   - 미디어/데이터 빠른 확인에는 `.codex/skills/stock-study-web-harness/scripts/diagnose.ps1`를 실행한다.
   - 로컬 앱이 실행 중이거나 실행 경로가 명확하면 브라우저에서 영향을 받은 화면을 확인한다.

5. 무엇을 바꿨는지, 어떤 검증이 통과했는지, 무엇을 확인하지 못했는지 정확히 보고한다.

## 미디어 규칙

- Google Drive `file/d/...` URL이 유효한 HTML5 `<audio>` 또는 `<video>` 소스라고 가정하지 않는다.
- 직접 다운로드 URL은 첫 시도로만 사용한다.
  - `https://drive.google.com/uc?export=download&id=<id>`
- Drive 미디어에는 항상 preview fallback을 유지한다.
  - `https://drive.google.com/file/d/<id>/preview`
- 직접 재생이 실패하면 재생 버튼이 조용히 실패하게 두지 말고, 앱 안에서 사용할 수 있는 fallback 경로를 보여준다.
- 크거나 비공개인 Drive 파일은 로그인, 바이러스 검사, quota, CORS 관련 실패가 발생할 수 있다고 본다.

## 검증 기준

- 사용자가 분석만 요청한 경우가 아니라면 코드 변경에는 빌드 성공이 필요하다.
- `npm.cmd run lint`는 현재 프로젝트의 기존 문제를 보고한다. 좁은 범위의 미디어 수정 실패 증거로 보지 말고, 실행했다면 별도로 언급한다.
- UI 변경이 반응형 영역에 닿으면 데스크톱과 좁은 모바일 레이아웃을 모두 확인한다.

## 참고 자료

- 콘텐츠 로딩, Drive 미디어, 게시글 메타데이터를 바꿀 때는 `references/stock-study-patterns.md`를 읽는다.
- 미디어/디버깅 작업을 마무리하기 전에 `scripts/diagnose.ps1`를 실행한다.
