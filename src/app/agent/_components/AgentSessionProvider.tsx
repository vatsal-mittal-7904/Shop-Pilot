'use client'

import { createContext, useContext, type ReactNode } from 'react'

type AgentSession = {
  customerId: string
  merchantId: string
}

const AgentSessionContext = createContext<AgentSession | null>(null)

/**
 * Carries the authenticated customerId and the storefront merchantId from the
 * server layout into the client chat tree.
 *
 * ProductCards needs both ids to call addToCart(), but page.tsx is a client
 * component and cannot call getCurrentSession() itself. The alternative --
 * returning the ids from the search_catalog tool -- would push session identity
 * into the model's context and into the persisted Conversation.messages array,
 * so they come straight from the server layout instead and never reach the LLM.
 */
export function AgentSessionProvider({
  customerId,
  merchantId,
  children,
}: AgentSession & { children: ReactNode }) {
  return (
    <AgentSessionContext.Provider value={{ customerId, merchantId }}>
      {children}
    </AgentSessionContext.Provider>
  )
}

export function useAgentSession(): AgentSession {
  const session = useContext(AgentSessionContext)
  if (!session) throw new Error('useAgentSession must be used inside an AgentSessionProvider')
  return session
}
