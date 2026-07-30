import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { ProjectSession } from './session.js'

/**
 * The session is passed through context rather than imported as a module singleton so
 * tests can hand in a `MemoryProvider` and so a second editor instance on one page does
 * not silently share one asset cache.
 */

const Context = createContext<ProjectSession | null>(null)

export function ProjectProvider({ session, children }: { session: ProjectSession; children: ReactNode }) {
  return <Context.Provider value={session}>{children}</Context.Provider>
}

export function useProject(): ProjectSession {
  const session = useContext(Context)
  if (!session) throw new Error('useProject 必须在 <ProjectProvider> 内使用')
  return session
}
