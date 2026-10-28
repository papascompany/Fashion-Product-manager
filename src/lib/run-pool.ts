/**
 * 동시 실행 상한이 있는 작업 풀. worker 는 자기 에러를 스스로 처리해야 한다(throw 금지).
 * shouldStop 이 true 가 되면 새 작업을 꺼내지 않는다 — 이미 실행 중인 작업은 끝까지 기다린다.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  let next = 0
  const laneCount = Math.max(1, Math.min(concurrency, items.length))
  const lanes = Array.from({ length: laneCount }, async () => {
    while (next < items.length && !shouldStop()) {
      const item = items[next++]
      await worker(item)
    }
  })
  await Promise.all(lanes)
}
