# Pre-merge 리뷰 fix — audit-immediate-thisweek

12차원 감사본을 prod 머지 전, diff 대상 7레인 × 적대검증(24 에이전트)으로 재검토한 결과와 조치 기록.
**결과: 15 confirmed / 0 거짓양성. BLOCKER 1건 포함 결제·RLS correctness 이슈를 머지 전 수정.**

## 적용한 fix (이 커밋)

| ID | severity | 파일 | 내용 |
|---|---|---|---|
| WHK-01 | **BLOCKER** | `migrations/013` | 가드 트리거가 `auth.role()` 기준이라 SECURITY DEFINER 크레딧 RPC(`deduct_credits_atomic`/`record_thumbnail_generation`/`record_ai_fitting_generation`) 내부 `credits_left` UPDATE 도 OLD 로 되돌려 **모든 유료 생성이 무료**가 되는 회귀. → 판정을 `current_user`(DB 역할) 기준으로 교체. DEFINER RPC 내부는 `current_user=postgres` 라 통과, 직접 authenticated/anon UPDATE 만 차단. |
| WHK-01(webhook) | high | `webhooks/toss/route.ts` | 멱등성 키 폴백이 `data.paymentKey`(결제 단위)라 DONE↔CANCEL 이 같은 키로 충돌 → 환불 CANCEL 이 `duplicate_event` 로 무시되어 다운그레이드 안 됨. → 키에 생애주기(`status`)를 포함(`paymentKey:status`). |
| WHK-03(webhook) | medium | `webhooks/toss/route.ts` | `PARTIAL_CANCELED`(부분환불)가 플랜 전체를 free 로 다운그레이드. → `balanceAmount>0`(잔액 남음)이면 플랜 유지, 전액 취소만 다운그레이드. |
| WHK-02(webhook/015) | medium | `migrations/015` | `apply_payment_event` 가 event_id 를 **검증 전에** INSERT → 만료/불일치 시 정당 DONE 결제의 event 가 소각되어 영구 미적용. → event_id INSERT 를 검증 통과 뒤로 이동(성공 멱등성은 `consumed_at`+`FOR UPDATE` 가 보장). 추가로 `pending_orders.expires_at` 기본값 15분→24h(Toss 재전송/시계오차로 정당 결제가 만료 거부되는 것 방지). |
| WHK-04(webhook) | low | `webhooks/toss/route.ts` | `unknown_key` reason 미처리로 불필요한 500→재시도. → 200 종결 + 알람. |
| WHK-02(prepare) | medium | `payments/prepare/route.ts` | 가격표를 중복 하드코딩 → 가격 변경 시 청구/표시 불일치. → `plan-settings-shared` 의 `PLAN_PRICES`/`TOPUP_PRICES` import(단일 SoT). |

## 확인 후 조치 불필요 (거짓양성/이미 안전)

- **WHK-01(share) — shareUrl 호스트 화이트리스트**: `STATIC_ALLOWED_HOSTS` 에 실제 prod 도메인 `productcraft-ai.vercel.app` 이미 포함 → SMS 공유 정상. 회귀 아님.
- **BIZ-01 회귀 우려**: `apply_payment_event` 는 credits 를 SET 이 아니라 ADD(`credits_left + v_credits`) 함을 확인. 정상.

## 이월(별도 후속 PR — 이 돈-PR 범위 밖, 회귀 위험 최소화 위해 분리)

| ID | severity | 사유 |
|---|---|---|
| UIS-02 | medium | AI Fitting '취소' 버튼이 실제 fetch 를 abort 안 함(서버는 차감). AbortController 를 ResultCard→AIFittingPanel 로 배선하는 3파일 변경이라 분리. |
| UIS-01 | low | 결과화면 에러 배너 2중 렌더(page.tsx + result-card). ResultCard 배너 렌더 조건 검증 후 하나 제거 — 회귀 방지 위해 별도. |
| WHK-03(share) | low | banned 차단이 sms 분기에만. kakao/link 는 서버 미도달이라 실피해 적음. |
| WHK-02(share) | low | 일일 SMS cap 이 UTC 자정(=KST 09:00) 리셋. Asia/Seoul 오프셋 반영 필요. |
| WHK-04(share) | low | phone 정규식 010 전용(+82/레거시 거부). 2021 통합으로 실사용 회귀 거의 없음(의도된 tightening). |
| TYP-B-01/03 | low | `types/supabase.ts`·`<Database>` 제네릭·`env.ts` 가 dead — 광고된 컴파일 타입 안전망 미활성. TYP-01 후속(`supabase gen types` + 47 호출 사이트 cast)에서 재적용. |

## 머지 전 필수 (재확인)

1. **마이그레이션 013→014→015→016 을 prod 에 순서대로 적용** 후 코드 배포(특히 015 선행 — 미적용 시 결제 500).
2. 013 적용 직후 **quick 생성 1회로 `credits_left` 실제 감소** 확인(WHK-01 회귀 검증).
3. webhook smoke: DONE / 전액 CANCEL / PARTIAL_CANCELED(잔액>0) / duplicate / amount mismatch.
