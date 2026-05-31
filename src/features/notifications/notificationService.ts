import { supabase } from '../../lib/supabase'

export interface InAppNotification {
  id: string
  recipient_id: string
  actor_id: string | null
  entity_type: string
  entity_id: string
  message: string
  read_at: string | null
  created_at: string
}

export async function loadNotifications(): Promise<InAppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, recipient_id, actor_id, entity_type, entity_id, message, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50)
    .returns<InAppNotification[]>()

  if (error) throw error
  return data ?? []
}

export async function loadUnreadNotificationCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)

  if (error) throw error
  return count ?? 0
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)

  if (error) throw error
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)

  if (error) throw error
}
