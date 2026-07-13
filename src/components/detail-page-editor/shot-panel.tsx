'use client'

/**
 * ShotOrchestrationPanel — Phase 2 컷 오케스트레이션 (detail-page-engine)
 *
 * 섹션의 빈 촬영 슬롯을 스캔해 "AI 컷 생성" 배치를 실행한다.
 * - 기존 /api/generate/thumbnail · /api/generate/ai-fitting 엔드포인트만 사용
 *   (크레딧 차감/플랜 가드는 서버의 기존 경로가 그대로 집행 — 신규 결제 코드 없음)
 * - 동시 3건 배치 + 배치 간 순차 실행 (rate limit 보호)
 * - lock seed + 프리셋/모델락으로 컷 간 상품·모델 일관성 유지
 */

import { useMemo, useState } from 'react'
import { Loader2, Camera, AlertTriangle } from 'lucide-react'
import { useStudioStore } from '@/store/studio'
import type { DetailSection } from '@/store/studio'
import {
  extractShotJobs,
  applyShotResult,
  estimateShotCredits,
  type ShotJob,
} from '@/lib/detail-page/shot-plan'

const BATCH_SIZE = 3

interface ShotOrchestrationPanelProps {
  sections: DetailSection[]
  onChange: (sections: DetailSection[]) => void
  projectId?: string | null
}

type JobState = 'pending' | 'running' | 'done' | 'failed'

export function ShotOrchestrationPanel({ sections, onChange, projectId }: ShotOrchestrationPanelProps) {
  const uploadedImageUrl = useStudioStore((s) => s.uploadedImageUrl)
  const uploadedImageBase64 = useStudioStore((s) => s.uploadedImageBase64)
  const modelImageUrl = useStudioStore((s) => s.modelImageUrl)
  const modelImageBase64 = useStudioStore((s) => s.modelImageBase64)
  const analysisOriginal = useStudioStore((s) => s.analysisOriginal)
  const getEffectiveAnalysis = useStudioStore((s) => s.getEffectiveAnalysis)
  const ensureShotLockSeed = useStudioStore((s) => s.ensureShotLockSeed)
  const result = useStudioStore((s) => s.result)

  const [running, setRunning] = useState(false)
  const [jobStates, setJobStates] = useState<Record<string, JobState>>({})
  const [errors, setErrors] = useState<string[]>([])

  const hasModelImage = Boolean(modelImageBase64 ?? modelImageUrl)
  const hasProductImage = Boolean(uploadedImageBase64 ?? uploadedImageUrl)

  const plan = useMemo(
    () => extractShotJobs(sections, { hasModelImage }),
    [sections, hasModelImage],
  )
  const estimatedCredits = useMemo(() => estimateShotCredits(plan.jobs), [plan.jobs])

  if (plan.jobs.length === 0 && !running) return null

  const jobKey = (j: ShotJob) => `${j.sectionId}:${j.itemIndex}:${j.slot}`

  const runJob = async (job: ShotJob, lockSeed: number): Promise<string> => {
    if (job.engine === 'fitting') {
      const body: Record<string, unknown> = {
        projectId,
        aspectRatios: [job.aspectRatio],
        category: result?.category ?? analysisOriginal?.category ?? '패션 아이템',
        productKeyFeatures: analysisOriginal?.keyFeatures ?? [],
        shotVariant: job.fittingVariant,
        lockSeed,
        saveAsLastModel: false,
      }
      if (uploadedImageBase64) body.productImageBase64 = uploadedImageBase64
      else if (uploadedImageUrl) body.productImageUrl = uploadedImageUrl
      if (modelImageBase64) body.modelImageBase64 = modelImageBase64
      else if (modelImageUrl) body.modelImageUrl = modelImageUrl

      const res = await fetch('/api/generate/ai-fitting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `AI Fitting 실패 (${res.status})`)
      const url = data.fittings?.[0]?.result_url
      if (typeof url !== 'string' || !url) throw new Error('AI Fitting 결과 URL 이 비어 있습니다.')
      return url
    }

    // thumbnail 엔진 — 분석 메타는 있는 것만 채우고 나머지는 안전 기본값
    const eff = getEffectiveAnalysis()
    const body: Record<string, unknown> = {
      projectId,
      analysis: {
        category: eff.category ?? result?.category ?? '패션 아이템',
        colors: [],
        style: eff.style ?? '미니멀',
        mood: eff.style ?? '미니멀',
        keyFeatures: eff.keyFeatures ?? [],
        keywords: eff.keywords ?? [],
      },
      aspectRatios: [job.aspectRatio],
      count: 1,
      shotPreset: job.preset,
      lockSeed,
    }
    if (uploadedImageBase64) body.imageBase64 = uploadedImageBase64
    else if (uploadedImageUrl) body.imageUrl = uploadedImageUrl

    const res = await fetch('/api/generate/thumbnail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `컷 생성 실패 (${res.status})`)
    const url = data.thumbnails?.[0]?.url
    if (typeof url !== 'string' || !url) throw new Error('컷 결과 URL 이 비어 있습니다.')
    return url
  }

  const handleGenerateAll = async () => {
    if (!projectId) {
      setErrors(['프로젝트가 저장된 후에 컷을 생성할 수 있습니다.'])
      return
    }
    if (!hasProductImage) {
      setErrors(['원본 제품 이미지가 없어 컷을 생성할 수 없습니다.'])
      return
    }
    setRunning(true)
    setErrors([])
    const lockSeed = ensureShotLockSeed()
    const initial: Record<string, JobState> = {}
    for (const j of plan.jobs) initial[jobKey(j)] = 'pending'
    setJobStates(initial)

    // onChange 가 부모 상태를 바꾸는 동안에도 최신 섹션을 유지하기 위한 로컬 누적자
    let current = sections
    const failed: string[] = []

    for (let i = 0; i < plan.jobs.length; i += BATCH_SIZE) {
      const batch = plan.jobs.slice(i, i + BATCH_SIZE)
      setJobStates((prev) => {
        const next = { ...prev }
        for (const j of batch) next[jobKey(j)] = 'running'
        return next
      })

      const settled = await Promise.allSettled(batch.map((j) => runJob(j, lockSeed)))
      settled.forEach((r, bi) => {
        const job = batch[bi]
        if (r.status === 'fulfilled') {
          current = applyShotResult(current, job, r.value)
          setJobStates((prev) => ({ ...prev, [jobKey(job)]: 'done' }))
        } else {
          const msg = r.reason instanceof Error ? r.reason.message : '알 수 없는 오류'
          failed.push(`${job.label}: ${msg}`)
          setJobStates((prev) => ({ ...prev, [jobKey(job)]: 'failed' }))
        }
      })
      onChange(current)
    }

    if (failed.length > 0) setErrors(failed)
    setRunning(false)
  }

  return (
    <div className="mb-4 p-4" style={{ border: '1px solid #e5e5e5', backgroundColor: '#fafafa' }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-[13px] font-black text-[#111111] flex items-center gap-1.5">
            <Camera className="w-3.5 h-3.5" />
            AI 컷 오케스트레이션
          </div>
          <div className="text-[12px] text-[#707072] mt-1">
            빈 촬영 슬롯 {plan.jobs.length}개 · 예상 {estimatedCredits}크레딧
            {plan.truncated > 0 && ` · 예산 초과 ${plan.truncated}개 제외`}
            {!hasModelImage && ' · 모델 이미지 없음 — 착용 컷 제외'}
          </div>
        </div>
        <button
          onClick={handleGenerateAll}
          disabled={running || !projectId || !hasProductImage}
          title={!projectId ? '프로젝트 저장 후 사용 가능' : !hasProductImage ? '제품 이미지 필요' : `${plan.jobs.length}개 컷을 일괄 생성`}
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-full text-[12px] font-bold text-white bg-[#111111] hover:bg-[#333333] transition-colors disabled:opacity-50"
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
          {running ? '컷 생성 중...' : 'AI 컷 일괄 생성'}
        </button>
      </div>

      {/* 작업 목록 */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {plan.jobs.map((j) => {
          const state = jobStates[jobKey(j)] ?? 'pending'
          const color =
            state === 'done' ? '#16a34a' : state === 'failed' ? '#d30005' : state === 'running' ? '#111111' : '#9e9ea0'
          return (
            <span
              key={jobKey(j)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
              style={{ backgroundColor: '#ffffff', color, border: `1px solid ${state === 'pending' ? '#e5e5e5' : color}` }}
            >
              {state === 'running' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
              {j.label}
              {state === 'done' && ' ✓'}
              {state === 'failed' && ' ✕'}
            </span>
          )
        })}
      </div>

      {errors.length > 0 && (
        <div className="mt-3 p-2.5 text-[12px] space-y-1" style={{ color: '#d30005', border: '1px solid #fecaca', backgroundColor: '#fff5f5' }}>
          {errors.map((e, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              {e}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
