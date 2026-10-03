# LawPower v28.6 — Meta CRM 최적화 패치

## 핵심 변경

이번 패치는 `Meta Instant Form → Google Sheet → LawPower → Meta CAPI for CRM`의
후속 품질신호 전송을 안정화합니다.

- Meta Instant Form의 `leadgen_id / lead_id`를 CRM 전환 피드백의 핵심 식별자로 사용
- 전화번호/이메일은 SHA-256 해시로만 전송
- 채무액, 소득, 상담메모, 사건내용 등 상세 상담정보는 Meta로 전송하지 않음
- `custom_data.event_source = crm`
- `custom_data.lead_event_source = LawPower` (환경변수로 변경 가능)
- `custom_data.lead_status` / `lead_stage` 전송
- Queue 생성 순간의 상태/단계를 스냅샷으로 저장
- 재시도 시 동일 `event_id` 유지
- 유입 당시 Meta Dataset/광고계정으로만 전송
- Meta Lead ID가 없으면 조용히 잘못 학습시키지 않고 명확한 실패로 남김

## 적용 순서

1. ZIP의 파일을 현재 `maeil` 프로젝트에 덮어쓰기
2. Supabase SQL Editor에서:
   `supabase/migrations/007_meta_crm_optimization.sql`
   전체 실행
3. `V28_6_POSTCHECK.sql` 실행
4. Vercel 환경변수 확인
5. `npm run build`
6. commit / push

## Vercel 환경변수

기존 필수:
- `LAWPOWER_INTEGRATION_ENCRYPTION_KEY`
- `META_GRAPH_API_VERSION`
- `META_QUEUE_SECRET`
- `CRON_SECRET`

신규 선택:
- `META_CRM_LEAD_EVENT_SOURCE`
  - 미입력 시 `LawPower`
  - 예: `LawPower`, `LawPower CRM`

## 매우 중요: Raw2 Meta Lead ID

Google Sheet의 Raw2에 아래 중 하나의 헤더가 실제로 존재해야 합니다.

- `leadgen_id`
- `leadgen id`
- `lead_id`
- `lead id`
- `id` (최후 fallback)

가능하면 `leadgen_id`를 명시적으로 유지하세요.

프로젝트의 기존 `docs/GOOGLE_APPS_SCRIPT_TEMPLATE.gs`는 이미 해당 컬럼을 읽어
`metaLeadId`로 LawPower API에 전송합니다.

## 기본 규칙

007 적용 후 각 로펌에는 다음 추천 규칙이 OFF 상태로 준비됩니다.

- 진행단계 `상담` → Meta Event `Lead`
- 진행단계 `착수금 안내` → Meta Event `Lead`
- 내부상태 `수임전환` → Meta Event `Lead`

처음부터 켜지 마세요.
Meta 광고계정 + Sheet + 광고소스 + Test Event Code 연결 후 테스트 DB 1건으로 확인한 뒤
필요한 규칙만 활성화합니다.

## Meta로 실제 전달되는 핵심 형태

```json
{
  "event_name": "Lead",
  "action_source": "system_generated",
  "event_id": "LP-CRM-...",
  "user_data": {
    "lead_id": "META_ORIGINAL_LEAD_ID",
    "ph": ["SHA256..."],
    "em": ["SHA256..."]
  },
  "custom_data": {
    "event_source": "crm",
    "lead_event_source": "LawPower",
    "lead_status": "상담완료",
    "lead_stage": "상담"
  }
}
```

전화번호/이메일이 없는 경우에도 원본 Meta Lead ID가 있으면 CRM 이벤트를 전송합니다.
반대로 Meta Lead ID가 없으면 Conversion Leads용 전송을 실패 처리합니다.

## 아직 하지 않을 것

- 자동규칙 ON
- Test Event Code 제거
- 실광고의 Conversion Leads 최적화 목표 변경

위 3개는 연결 테스트가 성공한 뒤 진행합니다.
