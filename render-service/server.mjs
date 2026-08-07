/**
 * ProductCraft 상세페이지 렌더 마이크로서비스 (VPS Playwright — PRD §5 권장 정본)
 *
 * POST /render  { html, width, maxSliceHeight, format?, quality?, baseUrl? }
 *   → application/zip (섹션 경계 스냅 세로 슬라이스 이미지들)
 * GET  /healthz → 200 "ok"
 *
 * 인증: Authorization: Bearer $RENDER_TOKEN (필수 — 미설정 시 기동 거부)
 * 실행: RENDER_TOKEN=... node server.mjs  (기본 포트 8791)
 *
 * 플랫폼 규격 상한(스마트스토어 860/5000 등)은 호출측(Next 프록시)이 전달한다.
 */

import http from 'node:http'
import { chromium } from 'playwright'
import JSZip from 'jszip'

const PORT = Number(process.env.PORT ?? 8791)
const TOKEN = process.env.RENDER_TOKEN
const MAX_HTML_BYTES = 3 * 1024 * 1024 // 3MB — Vercel 프록시 요청 한도(4.5MB) 이내
const MAX_TOTAL_HEIGHT = 40_000        // 비정상 페이지 가드
const SUPERSAMPLE = 2                  // 2x 내부 렌더 → 텍스트 선명도 (PRD §0-1)
const BOUNDARY_SNAP_TOLERANCE = 0.4

if (!TOKEN) {
  console.error('[render] RENDER_TOKEN is required')
  process.exit(1)
}

/** 브라우저 싱글턴 — 요청마다 context 만 새로 연다 */
let browserPromise = null
function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  }
  return browserPromise
}

async function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** maxSliceHeight 이하 조각들의 시작 y 배열 (섹션 경계 스냅) — rasterize.ts 와 동일 로직 */
function computeSliceCuts(totalHeight, maxSliceHeight, boundaries) {
  const cuts = [0]
  if (totalHeight <= maxSliceHeight) return cuts
  let current = 0
  const minStep = Math.max(1, Math.floor(maxSliceHeight * BOUNDARY_SNAP_TOLERANCE))
  while (totalHeight - current > maxSliceHeight) {
    const target = current + maxSliceHeight
    let next = -1
    for (const b of boundaries) {
      if (b > current + minStep && b <= target && b > next) next = b
    }
    if (next <= current) next = target
    cuts.push(next)
    current = next
  }
  return cuts
}

async function handleRender(req, res) {
  const auth = req.headers.authorization ?? ''
  if (auth !== `Bearer ${TOKEN}`) {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'unauthorized' }))
    return
  }

  let payload
  try {
    const raw = await readBody(req, MAX_HTML_BYTES)
    payload = JSON.parse(raw.toString('utf8'))
  } catch (err) {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: `invalid body: ${err.message}` }))
    return
  }

  const html = typeof payload.html === 'string' ? payload.html : ''
  const width = Math.min(Math.max(Number(payload.width) || 860, 300), 1200)
  const maxSliceHeight = Math.min(Math.max(Number(payload.maxSliceHeight) || 5000, 1000), 10_000)
  const format = payload.format === 'png' ? 'png' : 'jpeg'
  const quality = Math.min(Math.max(Number(payload.quality) || 0.9, 0.5), 1)
  const baseUrl = typeof payload.baseUrl === 'string' ? payload.baseUrl : ''

  if (!html.trim()) {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'html is required' }))
    return
  }

  // 상대경로(/fonts 등) 해석용 <base> 주입 (baseUrl 제공 시)
  const finalHtml = baseUrl
    ? html.replace(/<head>/i, `<head><base href="${baseUrl.replace(/"/g, '')}">`)
    : html

  const browser = await getBrowser()
  const context = await browser.newContext({
    viewport: { width, height: 1200 },
    deviceScaleFactor: SUPERSAMPLE,
  })
  try {
    const page = await context.newPage()
    await page.setContent(finalHtml, { waitUntil: 'networkidle', timeout: 60_000 })
    await page.evaluate(() => document.fonts?.ready)

    // 캔버스(.dp 또는 body 첫 자식) 기준 전체 높이·섹션 경계 수집 (CSS px)
    const metrics = await page.evaluate(() => {
      const root = document.querySelector('main.dp') ?? document.body
      const rootRect = root.getBoundingClientRect()
      const boundaries = []
      for (const child of root.children) {
        const top = Math.round(child.getBoundingClientRect().top - rootRect.top)
        if (top > 0) boundaries.push(top)
      }
      return {
        height: Math.ceil(rootRect.height),
        offsetTop: Math.round(rootRect.top + window.scrollY),
        offsetLeft: Math.round(rootRect.left + window.scrollX),
        width: Math.ceil(rootRect.width),
        boundaries,
      }
    })

    if (metrics.height <= 0 || metrics.height > MAX_TOTAL_HEIGHT) {
      throw new Error(`invalid page height: ${metrics.height}`)
    }

    const cuts = computeSliceCuts(metrics.height, maxSliceHeight, metrics.boundaries)
    const zip = new JSZip()
    const pad = String(cuts.length).length
    const ext = format === 'png' ? 'png' : 'jpg'

    for (let i = 0; i < cuts.length; i++) {
      const y0 = cuts[i]
      const y1 = cuts[i + 1] ?? metrics.height
      if (y1 - y0 <= 0) continue
      const buf = await page.screenshot({
        type: format,
        ...(format === 'jpeg' ? { quality: Math.round(quality * 100) } : {}),
        clip: {
          x: metrics.offsetLeft,
          y: metrics.offsetTop + y0,
          width: Math.min(metrics.width, width),
          height: y1 - y0,
        },
      })
      zip.file(`detail_${String(i + 1).padStart(pad, '0')}.${ext}`, buf)
    }

    const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-length': zipBuf.length,
      'x-slice-count': String(cuts.length),
      'x-total-height': String(metrics.height),
    })
    res.end(zipBuf)
  } catch (err) {
    console.error('[render] failed:', err)
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: err.message ?? 'render failed' }))
  } finally {
    await context.close().catch(() => {})
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
    return
  }
  if (req.method === 'POST' && req.url === '/render') {
    handleRender(req, res).catch((err) => {
      console.error('[render] unhandled:', err)
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
    return
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

server.listen(PORT, () => {
  console.log(`[render] listening on :${PORT}`)
})
