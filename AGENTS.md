# Stock-Study 에이전트 하네스

이 저장소에서 작업하기 전에 프로젝트 전용 하네스를 먼저 참고한다.

## 기본 스킬

- `.codex/skills/stock-study-web-harness/SKILL.md`

디버깅, 기능 수정, 콘텐츠 업데이트, 미디어 재생 문제, 빌드 검증, 릴리즈 점검에 사용한다.

## 규칙과 워크플로

- `project-harness.md`
- `harness/rules.md`
- `harness/workflows.md`

## 필수 검증

- 코드 변경 후 `npm.cmd run build`를 실행한다.
- 미디어나 콘텐츠 디버깅 작업에서는 다음 진단 스크립트를 실행한다.

```powershell
powershell.exe -ExecutionPolicy Bypass -File .codex\skills\stock-study-web-harness\scripts\diagnose.ps1 -PostId 213
```

`213`은 확인할 게시글 id로 바꿔서 사용한다.

## 알려진 주의사항

- Google Drive 미디어 링크는 HTML5 오디오/비디오 소스로 직접 재생되지 않을 수 있으므로 preview fallback을 유지한다.
- `npm.cmd run lint`는 현재 기존 오류를 보고하므로, lint 정리 작업이 아닌 경우 참고 신호로만 본다.
- `public/data/posts.json`에는 오래된 잘못된 JSON 조각이나 인코딩이 깨진 항목이 있을 수 있으므로, 요청이 없는 한 대규모 재작성은 피한다.
