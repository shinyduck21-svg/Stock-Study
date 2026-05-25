# Stock-Study 패턴

## 앱 구조

- React/Vite 단일 페이지 앱이다.
- 주요 구현은 `src/App.jsx`에 집중되어 있다.
- 콘텐츠 인덱스는 `public/data/posts.json`에 있다.
- 텍스트 콘텐츠는 `public/docs/` 아래 Markdown 파일로 저장된다.
- Vite base path는 앱이 `/Stock-Study/` 아래에서 제공되는 것을 전제로 한다.

## 게시글 메타데이터

`public/data/posts.json`의 주요 필드:

- `id`: 안정적인 숫자 콘텐츠 id.
- `title`: 화면에 표시되는 제목.
- `type`: 보통 `text`, `audio`, `video`.
- `category`: 피드/카테고리 라벨.
- `fileName`: `public/docs/` 아래 Markdown 파일명.
- `url`: 비디오 또는 기본 미디어 URL.
- `audioUrl`: 오디오 미디어 URL.
- `thumbnail`: 선택적인 표시 이미지.

게시글 하나만 수정할 때는 필요한 경우가 아니라면 JSON 파일 전체를 재포맷하지 않는다.

## Google Drive 미디어

데이터에 있는 Drive URL은 보통 다음 형태다.

- `https://drive.google.com/file/d/<id>`
- `https://drive.google.com/file/d/<id>/view?usp=drive_link`
- `https://docs.google.com/uc?export=open&id=<id>`

지원하는 id 추출 방식:

- 쿼리 id: `[?&]id=([^&#]+)`
- 파일 경로 id: `/file/d/([^/]+)`

HTML5 미디어 소스로 먼저 시도할 주소:

```text
https://drive.google.com/uc?export=download&id=<id>
```

Preview fallback 주소:

```text
https://drive.google.com/file/d/<id>/preview
```

## 알려진 검증 참고사항

- `npm.cmd run build`가 기본 컴파일 검증이다.
- `npm.cmd run lint`에는 현재 좁은 범위의 버그 수정과 무관한 기존 문제가 포함되어 있다. 예: React hook lint, `vite.config.js` global 관련 오류.
- fallback UI가 맞더라도 자동화 브라우저에서는 원격 Drive 오디오가 재생되지 않을 수 있다. Drive가 사용자 세션이나 상호작용을 요구할 수 있기 때문이다.
