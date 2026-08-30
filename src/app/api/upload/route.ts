import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Node Runtime — multipart 수신 + Supabase Storage 업로드 (AI 호출 없음)
// 30s: 20MB 본문 수신(느린 업링크 20s) + Storage 업로드·공개 URL 발급(10s) 여유
export const maxDuration = 30

const MAX_SIZE = 20 * 1024 * 1024 // 20MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const BUCKET = 'product-images'

/**
 * 제품 이미지 업로드 API
 * POST /api/upload
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // 인증 확인
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
    }

    // FormData 파싱
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
    }

    // 파일 검증
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'JPG, PNG, WebP 형식만 지원합니다.' },
        { status: 400 }
      )
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: '파일 크기는 20MB 이하여야 합니다.' },
        { status: 400 }
      )
    }

    // 고유 파일명 생성 — file.name 에서 확장자 추출 금지(photo.png.exe 같은 이름 오염 방지)
    // 검증된 file.type 에서 확장자를 유도함
    const extMap: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
    const ext = extMap[file.type] ?? 'jpg'
    const fileName = `${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`

    // Supabase Storage 업로드
    const arrayBuffer = await file.arrayBuffer()
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(fileName, arrayBuffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return NextResponse.json(
        { error: '이미지 저장에 실패했습니다.' },
        { status: 500 }
      )
    }

    // 공개 URL 생성
    const { data: { publicUrl } } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(fileName)

    return NextResponse.json({ url: publicUrl, fileName })
  } catch (err) {
    console.error('Upload API error:', err)
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
