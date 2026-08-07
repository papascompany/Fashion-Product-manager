# ProductCraft 렌더 서비스 (VPS Playwright — PRD §5)

상세페이지 HTML 을 **섹션 경계 스냅 세로 슬라이스 이미지 ZIP** 으로 변환하는 마이크로서비스.
클라이언트 `html-to-image` 래스터화(Phase 1)의 서버 승격판 — 결정론적·픽셀 정확 (2x 슈퍼샘플).

## API

- `POST /render` — body `{ html, width, maxSliceHeight, format?: 'jpeg'|'png', quality?: 0.5~1, baseUrl? }`
  - 응답 `application/zip` (`detail_01.jpg`, `detail_02.jpg`, …)
  - 헤더 `Authorization: Bearer $RENDER_TOKEN` 필수
  - `baseUrl` 전달 시 `<base>` 주입 → `/fonts/...` 자체호스팅 폰트 해석
- `GET /healthz` — 상태 확인

## VPS 배포 (Vultr — 워커 오프로드 패턴)

```bash
# 1) 소스 업로드 (repo 의 render-service/ 폴더만)
scp -r render-service deploy@<VPS_HOST>:~/productcraft-render

# 2) 빌드 & 실행 (토큰은 강한 랜덤 값으로)
ssh deploy@<VPS_HOST>
cd ~/productcraft-render
docker build -t productcraft-render .
docker run -d --name productcraft-render --restart unless-stopped \
  -p 127.0.0.1:8791:8791 \
  -e RENDER_TOKEN="$(openssl rand -hex 32)" \
  productcraft-render
# 토큰 값은 출력하지 말고 곧바로 Vercel env 에 등록

# 3) 리버스 프록시(권장) — 기존 nginx/caddy 에 /render 경로 추가 + HTTPS
#    (또는 방화벽에서 Vercel 아웃바운드만 허용)
```

## Vercel 연결 (Next 프록시 `/api/render/detail-page`)

Vercel 프로젝트 env 에 추가:

| 키 | 값 |
|---|---|
| `DETAIL_RENDER_URL` | `https://<render-host>/render` |
| `DETAIL_RENDER_TOKEN` | VPS 에 넣은 RENDER_TOKEN 과 동일 값 |

- 미설정 시 프록시가 501 을 반환하고 편집기는 자동으로 **클라이언트 래스터화로 폴백**한다.
- 토큰·호스트 실값은 커밋 금지 — Vercel env / `CLAUDE.local.md` 에만.

## 제약

- HTML 요청 3MB 상한 (Vercel 프록시 요청 한도 이내)
- 전체 높이 40,000px 가드
- 이미지 URL 은 공개 접근 가능해야 함 (Supabase public URL OK)
