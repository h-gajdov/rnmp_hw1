// Connects to the bridge over Socket.IO and keeps the dashboard state live.
//
// - on every (re)connect the bridge sends a full `snapshot`
// - after that each Kafka message arrives as its own event
// - events are applied in small batches (one every FLUSH_MS) so a burst of
//   125 link windows causes one React render instead of 125
// - raw readings are also handed straight to subscribers (the map's pulses),
//   outside React state, so they cost no render
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { initialState, reducer, type FeedEvent } from '../state/dashboard'
import type { Reading, Snapshot } from '../types'

const FLUSH_MS = 30
const RATE_WINDOW_MS = 5000
const EVENT_KINDS = ['link_stats', 'borough_stats', 'incident', 'reading', 'late_reading'] as const

export type ReadingListener = (reading: Reading) => void
/** Registers a listener for on-time readings as they arrive; returns the unsubscribe function. */
export type ReadingSubscribe = (listener: ReadingListener) => () => void

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting'

export interface FeedHealth {
  status: ConnectionStatus
  messagesPerSecond: number
  lastMessageAt: number | null // wall clock ms
  checkedAt: number // wall clock ms of the last health update
}

export function useLiveFeed() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [health, setHealth] = useState<FeedHealth>({
    status: 'connecting', messagesPerSecond: 0, lastMessageAt: null, checkedAt: 0,
  })
  const arrivals = useRef<number[]>([]) // wall-clock arrival times, for the rate
  const readingListeners = useRef(new Set<ReadingListener>())

  const onReading = useCallback<ReadingSubscribe>((listener) => {
    readingListeners.current.add(listener)
    return () => { readingListeners.current.delete(listener) }
  }, [])

  useEffect(() => {
    const socket = io({ transports: ['websocket'] }) // reconnects automatically
    let queue: FeedEvent[] = []
    let timer: number | undefined

    const flush = () => {
      timer = undefined
      if (queue.length) dispatch({ type: 'events', events: queue })
      queue = []
    }

    socket.on('connect', () => setHealth((h) => ({ ...h, status: 'live' })))
    socket.on('disconnect', () => setHealth((h) => ({ ...h, status: 'reconnecting' })))
    socket.on('snapshot', (snapshot: Snapshot) => {
      queue = [] // anything queued before is already contained in the snapshot
      dispatch({ type: 'snapshot', snapshot })
    })
    for (const kind of EVENT_KINDS) {
      socket.on(kind, (msg) => {
        queue.push({ kind, msg } as FeedEvent)
        arrivals.current.push(Date.now())
        timer ??= window.setTimeout(flush, FLUSH_MS)
        if (kind === 'reading') for (const listener of readingListeners.current) listener(msg as Reading)
      })
    }

    // Twice a second, recompute the message rate shown in the header.
    const ticker = window.setInterval(() => {
      const now = Date.now()
      const recent = arrivals.current.filter((t) => t > now - RATE_WINDOW_MS)
      arrivals.current = recent
      setHealth((h) => ({
        ...h,
        messagesPerSecond: recent.length / (RATE_WINDOW_MS / 1000),
        lastMessageAt: recent.length ? recent[recent.length - 1] : h.lastMessageAt,
        checkedAt: now,
      }))
    }, 500)

    return () => {
      window.clearInterval(ticker)
      window.clearTimeout(timer)
      socket.disconnect()
    }
  }, [])

  return { state, health, onReading }
}
