export type UserRole = 'pharmacy' | 'warehouse' | 'admin'

export interface Profile {
  id: string
  role: UserRole
  full_name: string
  phone: string | null
  created_at: string
}

export interface Pharmacy {
  id: string
  pharmacy_name: string
  license_no: string
  address: string | null
  city: string | null
  lat: number | null
  lng: number | null
}

export type WarehouseStatus = 'pending' | 'active' | 'suspended'

export interface Warehouse {
  id: string
  warehouse_name: string
  status: WarehouseStatus
  min_order_value: number
  delivery_areas: string[]
  last_price_update: string | null
  is_deleted: boolean
}

export interface UserAccount {
  profile: Profile
  pharmacy: Pharmacy | null
  warehouse: Warehouse | null
}
