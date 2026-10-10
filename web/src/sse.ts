import { useEffect } from 'react'
import { useStore } from './store'
import type { ServerEvent } from './types'

// 单条 SSE 连接。服务端在 hello 事件里回传本连接的 actor，
// 客户端据此忽略自己触发的回声事件，避免乐观更新被覆盖。
// 断线由浏览器自动重连，重连成功后补拉一次全量数据。
export function useEventStream(boardId: number | undefined) {
  useEffect(() => {
    if (!boardId) return
    const es = new EventSource(`/api/events?board_id=${boardId}`)
    let reconnected = false

    es.onopen = () => {
      if (reconnected) {
        reconnected = false
        void useStore.getState().reloadBoard()
      }
    }
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as ServerEvent
        if (data?.type) useStore.getState().applyEvent(data)
      } catch {
        /* 心跳等非 JSON 数据，忽略 */
      }
    }
    es.onerror = () => {
      reconnected = true
    }

    return () => es.close()
  }, [boardId])
}
