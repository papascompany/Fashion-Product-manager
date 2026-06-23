/**
 * Supabase DB 타입 정의 (수동 작성)
 *
 * Track 3 — TYP-01 / DB-06 fix.
 * supabase CLI 가 미연결 상태이므로 마이그레이션 001~016 을 직접 손-반영했다.
 * 변경 이력:
 *   001 — 초기 스키마 (user_profiles / projects / generations / thumbnails /
 *         shares / subscriptions / usage_events)
 *   002 — usage_events 컬럼 재작성 (kind/cost → event_type/credits_used/project_id/metadata)
 *   003 — subscriptions.status / current_period_* / toss_order_id / updated_at,
 *         user_profiles.updated_at
 *   004 — handle_new_user / Storage 'product-images'
 *   005 — shares.user_id / deduct_credits RPC
 *   006 — add_credits RPC
 *   007 — projects.user_intent, generations.user_edited/parent_id/refinement_prompt/locked,
 *         thumbnails.is_pinned
 *   008 — user_profiles.role/banned_at, audit_log, v_admin_stats, is_admin()
 *   009 — ai_fittings, user_profiles.last_model_image_url
 *   010 — app_settings
 *   011 — thumbnails.resolution/prompt,
 *         record_thumbnail_generation / record_ai_fitting_generation RPC
 *   012 — deduct_credits_atomic RPC
 *   013 — user_profiles RLS lockdown + guard trigger
 *   014 — usage_events INSERT RLS / storage prefix / ai_fittings DELETE
 *   015 — pending_orders / processed_webhook_events / subscriptions.toss_order_id UNIQUE,
 *         apply_payment_event / apply_payment_cancel / cleanup_expired_pending_orders RPC,
 *         payment_credits_for fn
 *   016 — admin_adjust_credits RPC
 *
 * NOTE: 본 파일은 정적 타입 안전망 용도다. 런타임 검증은 마이그레이션 + RLS 정책으로
 *       보장된다. supabase 가 연결되면 `supabase gen types` 결과로 교체할 것.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// ─── 보조 타입 ────────────────────────────────────────────────────────────

export type PlanKey = 'free' | 'starter' | 'pro' | 'business'
export type UserRoleKey = 'user' | 'admin'
export type ProjectModeKey = 'quick' | 'studio'
export type ProjectStatusKey = 'pending' | 'processing' | 'done' | 'failed'
export type GenerationTypeKey =
  | 'analyze'
  | 'naming'
  | 'tagline'
  | 'description'
  | 'thumbnail'
export type ShareChannelKey = 'sms' | 'kakao' | 'link'
export type SubscriptionStatusKey = 'active' | 'cancelled' | 'past_due'
export type PendingOrderKind = 'plan' | 'topup'

// ─── Database ─────────────────────────────────────────────────────────────

export interface Database {
  public: {
    Tables: {
      // ─── user_profiles ───────────────────────────────────────────────
      user_profiles: {
        Row: {
          id: string
          plan: PlanKey
          credits_left: number
          /** v1.1 — 'user'(기본) | 'admin' (008) */
          role: UserRoleKey
          /** v1.1 — null=active, timestamp=banned (008) */
          banned_at: string | null
          /** Phase 4 — 마지막 업로드한 AI Fitting 모델 사진 URL (009) */
          last_model_image_url: string | null
          /** 003 — updated_at 추가 */
          updated_at: string | null
          created_at: string
        }
        Insert: {
          id: string
          plan?: PlanKey
          credits_left?: number
          role?: UserRoleKey
          banned_at?: string | null
          last_model_image_url?: string | null
          updated_at?: string | null
          created_at?: string
        }
        Update: {
          plan?: PlanKey
          credits_left?: number
          role?: UserRoleKey
          banned_at?: string | null
          last_model_image_url?: string | null
          updated_at?: string | null
        }
      }

      // ─── audit_log ───────────────────────────────────────────────────
      audit_log: {
        Row: {
          id: string
          actor_id: string
          action: string
          target_id: string | null
          payload: Json
          created_at: string
        }
        Insert: {
          id?: string
          actor_id: string
          action: string
          target_id?: string | null
          payload?: Json
          created_at?: string
        }
        Update: never
      }

      // ─── projects ────────────────────────────────────────────────────
      projects: {
        Row: {
          id: string
          user_id: string
          mode: ProjectModeKey
          product_image_url: string | null
          status: ProjectStatusKey
          /** v1.1 — { tone, audience, channel, memo } (007) */
          user_intent: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          mode: ProjectModeKey
          product_image_url?: string | null
          status?: ProjectStatusKey
          user_intent?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          mode?: ProjectModeKey
          product_image_url?: string | null
          status?: ProjectStatusKey
          user_intent?: Json | null
          updated_at?: string
        }
      }

      // ─── generations ─────────────────────────────────────────────────
      generations: {
        Row: {
          id: string
          project_id: string
          type: GenerationTypeKey
          payload: Json | null
          /** v1.1 — true if user manually edited the result (007) */
          user_edited: boolean | null
          /** v1.1 — variant tree parent reference (007) */
          parent_id: string | null
          /** v1.1 — user refinement string used for regeneration (007) */
          refinement_prompt: string | null
          /** v1.1 — locked from cascade regeneration (007) */
          locked: boolean | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          type: GenerationTypeKey
          payload?: Json | null
          user_edited?: boolean | null
          parent_id?: string | null
          refinement_prompt?: string | null
          locked?: boolean | null
          created_at?: string
        }
        Update: {
          payload?: Json | null
          user_edited?: boolean | null
          parent_id?: string | null
          refinement_prompt?: string | null
          locked?: boolean | null
        }
      }

      // ─── thumbnails ──────────────────────────────────────────────────
      thumbnails: {
        Row: {
          id: string
          project_id: string
          url: string
          width: number | null
          height: number | null
          aspect_ratio: string | null
          is_primary: boolean
          /** v1.1 — pinned during re-roll (007) */
          is_pinned: boolean | null
          nano_banana_request_id: string | null
          /** 011 — 해상도 라벨 ('1K'|'2K'|'4K' 등) */
          resolution: string | null
          /** 011 — 사용된 프롬프트(디버깅) */
          prompt: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          url: string
          width?: number | null
          height?: number | null
          aspect_ratio?: string | null
          is_primary?: boolean
          is_pinned?: boolean | null
          nano_banana_request_id?: string | null
          resolution?: string | null
          prompt?: string | null
          created_at?: string
        }
        Update: {
          is_primary?: boolean
          is_pinned?: boolean | null
          resolution?: string | null
          prompt?: string | null
        }
      }

      // ─── shares ──────────────────────────────────────────────────────
      shares: {
        Row: {
          id: string
          project_id: string
          channel: ShareChannelKey
          target: string | null
          short_url: string | null
          /** 005 — 공유 발신자 추적 */
          user_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          channel: ShareChannelKey
          target?: string | null
          short_url?: string | null
          user_id?: string | null
          created_at?: string
        }
        Update: never
      }

      // ─── subscriptions ───────────────────────────────────────────────
      subscriptions: {
        Row: {
          id: string
          user_id: string
          toss_customer_key: string | null
          plan: string
          renew_at: string | null
          /** 003 — 결제 상태 */
          status: SubscriptionStatusKey
          /** 003 — 현재 결제 주기 시작 */
          current_period_start: string | null
          /** 003 — 현재 결제 주기 종료 */
          current_period_end: string | null
          /** 003 / 015 — 결제 식별자 (UNIQUE) */
          toss_order_id: string | null
          /** 003 */
          updated_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          toss_customer_key?: string | null
          plan?: string
          renew_at?: string | null
          status?: SubscriptionStatusKey
          current_period_start?: string | null
          current_period_end?: string | null
          toss_order_id?: string | null
          updated_at?: string | null
          created_at?: string
        }
        Update: {
          plan?: string
          renew_at?: string | null
          status?: SubscriptionStatusKey
          current_period_start?: string | null
          current_period_end?: string | null
          toss_order_id?: string | null
          updated_at?: string | null
        }
      }

      // ─── usage_events (002 에서 컬럼 재정의) ─────────────────────────
      usage_events: {
        Row: {
          id: string
          user_id: string
          project_id: string | null
          event_type: string
          credits_used: number
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          project_id?: string | null
          event_type: string
          credits_used?: number
          metadata?: Json | null
          created_at?: string
        }
        Update: never
      }

      // ─── ai_fittings (009) ───────────────────────────────────────────
      ai_fittings: {
        Row: {
          id: string
          project_id: string
          model_image_url: string | null
          result_url: string
          aspect_ratio: string | null
          width: number | null
          height: number | null
          is_pinned: boolean | null
          prompt: string | null
          is_hero_image: boolean | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          model_image_url?: string | null
          result_url: string
          aspect_ratio?: string | null
          width?: number | null
          height?: number | null
          is_pinned?: boolean | null
          prompt?: string | null
          is_hero_image?: boolean | null
          created_at?: string
        }
        Update: {
          model_image_url?: string | null
          result_url?: string
          aspect_ratio?: string | null
          width?: number | null
          height?: number | null
          is_pinned?: boolean | null
          prompt?: string | null
          is_hero_image?: boolean | null
        }
      }

      // ─── app_settings (010) ──────────────────────────────────────────
      app_settings: {
        Row: {
          key: string
          value: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          key: string
          value: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          value?: Json
          updated_at?: string
          updated_by?: string | null
        }
      }

      // ─── pending_orders (015) ────────────────────────────────────────
      pending_orders: {
        Row: {
          order_id: string
          user_id: string
          kind: PendingOrderKind
          key: string
          expected_amount: number
          created_at: string
          expires_at: string
          consumed_at: string | null
        }
        Insert: {
          order_id: string
          user_id: string
          kind: PendingOrderKind
          key: string
          expected_amount: number
          created_at?: string
          expires_at?: string
          consumed_at?: string | null
        }
        Update: {
          consumed_at?: string | null
          expires_at?: string
        }
      }

      // ─── processed_webhook_events (015) ──────────────────────────────
      processed_webhook_events: {
        Row: {
          provider: string
          event_id: string
          order_id: string | null
          processed_at: string
        }
        Insert: {
          provider: string
          event_id: string
          order_id?: string | null
          processed_at?: string
        }
        Update: never
      }
    }

    // ─── Views ─────────────────────────────────────────────────────────
    Views: {
      v_admin_stats: {
        Row: {
          total_users: number
          new_users_7d: number
          active_users_7d: number
          generations_7d: number
          mrr: number
          free_users: number
          starter_users: number
          pro_users: number
          business_users: number
        }
      }
    }

    // ─── Functions / RPC ───────────────────────────────────────────────
    Functions: {
      is_admin: {
        Args: Record<string, never>
        Returns: boolean
      }
      handle_new_user: {
        Args: Record<string, never>
        Returns: unknown
      }
      add_credits: {
        Args: { p_user_id: string; p_amount: number }
        Returns: void
      }
      deduct_credits: {
        Args: { p_user_id: string; p_amount: number }
        Returns: void
      }
      deduct_credits_atomic: {
        Args: { p_user_id: string; p_amount: number }
        Returns: boolean
      }
      admin_adjust_credits: {
        Args: { p_user_id: string; p_delta: number }
        Returns: boolean
      }
      record_thumbnail_generation: {
        Args: {
          p_user_id: string
          p_project_id: string
          p_thumbnails: Json
          p_credits: number
          p_metadata?: Json
        }
        Returns: Json
      }
      record_ai_fitting_generation: {
        Args: {
          p_user_id: string
          p_project_id: string
          p_fittings: Json
          p_credits: number
          p_metadata?: Json
        }
        Returns: Json
      }
      apply_payment_event: {
        Args: {
          p_order_id: string
          p_amount: number
          p_event_id: string
        }
        Returns: Json
      }
      apply_payment_cancel: {
        Args: {
          p_order_id: string
          p_event_id: string
        }
        Returns: Json
      }
      payment_credits_for: {
        Args: { p_kind: string; p_key: string }
        Returns: number
      }
      cleanup_expired_pending_orders: {
        Args: Record<string, never>
        Returns: number
      }
    }

    Enums: Record<string, never>
  }
}

// ─── 편의 타입 alias ─────────────────────────────────────────────────────
export type UserProfile = Database['public']['Tables']['user_profiles']['Row']
export type Project = Database['public']['Tables']['projects']['Row']
export type Generation = Database['public']['Tables']['generations']['Row']
export type Thumbnail = Database['public']['Tables']['thumbnails']['Row']
export type Share = Database['public']['Tables']['shares']['Row']
export type UsageEvent = Database['public']['Tables']['usage_events']['Row']
export type Subscription = Database['public']['Tables']['subscriptions']['Row']
export type AiFitting = Database['public']['Tables']['ai_fittings']['Row']
export type AppSetting = Database['public']['Tables']['app_settings']['Row']
export type PendingOrder = Database['public']['Tables']['pending_orders']['Row']
export type ProcessedWebhookEvent =
  Database['public']['Tables']['processed_webhook_events']['Row']
export type AuditLog = Database['public']['Tables']['audit_log']['Row']
export type AdminStats = Database['public']['Views']['v_admin_stats']['Row']
