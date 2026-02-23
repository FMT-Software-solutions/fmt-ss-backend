export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.12 (cd3cf9e)"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      quotes: {
        Row: {
          budget: string
          company: string | null
          contact_number_1: string
          contact_number_2: string | null
          created_at: string
          description: string
          email: string
          first_name: string
          id: string
          last_name: string
          service_type: string
          status: string
          updated_at: string
        }
        Insert: {
          budget: string
          company?: string | null
          contact_number_1: string
          contact_number_2?: string | null
          created_at?: string
          description: string
          email: string
          first_name: string
          id?: string
          last_name: string
          service_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          budget?: string
          company?: string | null
          contact_number_1?: string
          contact_number_2?: string | null
          created_at?: string
          description?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          service_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      billing_addresses: {
        Row: {
          city: string
          country: string
          created_at: string
          id: string
          isDefault: boolean
          organization_id: string
          postalCode: string | null
          state: string
          street: string
          updated_at: string
        }
        Insert: {
          city: string
          country: string
          created_at?: string
          id?: string
          isDefault?: boolean
          organization_id: string
          postalCode?: string | null
          state: string
          street: string
          updated_at?: string
        }
        Update: {
          city?: string
          country?: string
          created_at?: string
          id?: string
          isDefault?: boolean
          organization_id?: string
          postalCode?: string | null
          state?: string
          street?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_addresses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_training_registrations: {
        Row: {
          created_at: string | null
          details: Json
          email: string
          first_name: string
          id: string
          last_name: string
          payment_method: string | null
          phone: string
          status: string
          training_id: string
          training_slug: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          details?: Json
          email: string
          first_name: string
          id?: string
          last_name: string
          payment_method?: string | null
          phone: string
          status?: string
          training_id: string
          training_slug: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          details?: Json
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          payment_method?: string | null
          phone?: string
          status?: string
          training_id?: string
          training_slug?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      issues: {
        Row: {
          category: string
          component: string | null
          created_at: string | null
          description: string | null
          error_message: string | null
          id: string
          issue_type: string
          metadata: Json | null
          organization_id: string | null
          purchase_id: string | null
          request_data: Json | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          response_data: Json | null
          session_id: string | null
          severity: string
          stack_trace: string | null
          status: string | null
          title: string
          updated_at: string | null
          url: string | null
          user_action: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          category: string
          component?: string | null
          created_at?: string | null
          description?: string | null
          error_message?: string | null
          id?: string
          issue_type: string
          metadata?: Json | null
          organization_id?: string | null
          purchase_id?: string | null
          request_data?: Json | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          response_data?: Json | null
          session_id?: string | null
          severity?: string
          stack_trace?: string | null
          status?: string | null
          title: string
          updated_at?: string | null
          url?: string | null
          user_action?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          category?: string
          component?: string | null
          created_at?: string | null
          description?: string | null
          error_message?: string | null
          id?: string
          issue_type?: string
          metadata?: Json | null
          organization_id?: string | null
          purchase_id?: string | null
          request_data?: Json | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          response_data?: Json | null
          session_id?: string | null
          severity?: string
          stack_trace?: string | null
          status?: string | null
          title?: string
          updated_at?: string | null
          url?: string | null
          user_action?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "issues_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          created_at: string
          email: string | null
          id: string
          message: string | null
          name: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          message?: string | null
          name?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          message?: string | null
          name?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      newsletter_subscribers: {
        Row: {
          created_at: string | null
          email: string
          id: string
          subscribedAt: string | null
          unsubscribeToken: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          subscribedAt?: string | null
          unsubscribeToken: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          subscribedAt?: string | null
          unsubscribeToken?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      organization_apps: {
        Row: {
          access_granted_at: string | null
          app_id: string
          created_at: string | null
          expires_at: string | null
          id: string
          organization_id: string
          plan_type: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          access_granted_at?: string | null
          app_id: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          organization_id: string
          plan_type?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          access_granted_at?: string | null
          app_id?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          organization_id?: string
          plan_type?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_apps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: Json | null
          created_at: string | null
          email: string
          id: string
          name: string
          phone: string | null
          status: string
          updated_at: string | null
          verificationStatus: string
        }
        Insert: {
          address?: Json | null
          created_at?: string | null
          email: string
          id?: string
          name: string
          phone?: string | null
          status?: string
          updated_at?: string | null
          verificationStatus?: string
        }
        Update: {
          address?: Json | null
          created_at?: string | null
          email?: string
          id?: string
          name?: string
          phone?: string | null
          status?: string
          updated_at?: string | null
          verificationStatus?: string
        }
        Relationships: []
      }
      platform_config: {
        Row: {
          admin_feature_flags: Json | null
          created_at: string
          id: string
          updated_at: string | null
          user_feature_flags: Json | null
        }
        Insert: {
          admin_feature_flags?: Json | null
          created_at?: string
          id?: string
          updated_at?: string | null
          user_feature_flags?: Json | null
        }
        Update: {
          admin_feature_flags?: Json | null
          created_at?: string
          id?: string
          updated_at?: string | null
          user_feature_flags?: Json | null
        }
        Relationships: []
      }
      purchases: {
        Row: {
          amount: number
          client_reference: string | null
          confirmation_email_details: Json | null
          created_at: string | null
          external_transaction_id: string | null
          id: string
          items: Json
          organization_id: string
          payment_details: Json | null
          payment_method: string | null
          payment_provider: string | null
          payment_reference: string
          status: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          client_reference?: string | null
          confirmation_email_details?: Json | null
          created_at?: string | null
          external_transaction_id?: string | null
          id?: string
          items: Json
          organization_id: string
          payment_details?: Json | null
          payment_method?: string | null
          payment_provider?: string | null
          payment_reference: string
          status: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          client_reference?: string | null
          confirmation_email_details?: Json | null
          created_at?: string | null
          external_transaction_id?: string | null
          id?: string
          items?: Json
          organization_id?: string
          payment_details?: Json | null
          payment_method?: string | null
          payment_provider?: string | null
          payment_reference?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          app_id: string | null
          company: string | null
          content: string
          created_at: string
          email: string
          id: string
          is_featured: boolean
          name: string
          position: string | null
          rating: number
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          app_id?: string | null
          company?: string | null
          content: string
          created_at?: string
          email: string
          id?: string
          is_featured?: boolean
          name: string
          position?: string | null
          rating: number
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          app_id?: string | null
          company?: string | null
          content?: string
          created_at?: string
          email?: string
          id?: string
          is_featured?: boolean
          name?: string
          position?: string | null
          rating?: number
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      training_registrations: {
        Row: {
          company: string | null
          created_at: string
          email: string
          first_name: string
          id: string
          last_name: string
          message: string | null
          phone: string
          status: string
          training_id: string
          training_slug: string
          updated_at: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          email: string
          first_name: string
          id?: string
          last_name: string
          message?: string | null
          phone: string
          status?: string
          training_id: string
          training_slug: string
          updated_at?: string
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          message?: string | null
          phone?: string
          status?: string
          training_id?: string
          training_slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          avatar: string | null
          created_at: string
          email: string
          emailVerified: boolean
          firstName: string | null
          id: string
          isFirstLogin: boolean | null
          lastActiveAt: string | null
          lastLoginAt: string | null
          lastName: string | null
          metadata: Json | null
          passwordUpdated: boolean | null
          phone: string | null
          preferences: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          avatar?: string | null
          created_at?: string
          email: string
          emailVerified?: boolean
          firstName?: string | null
          id?: string
          isFirstLogin?: boolean | null
          lastActiveAt?: string | null
          lastLoginAt?: string | null
          lastName?: string | null
          metadata?: Json | null
          passwordUpdated?: boolean | null
          phone?: string | null
          preferences?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          avatar?: string | null
          created_at?: string
          email?: string
          emailVerified?: boolean
          firstName?: string | null
          id?: string
          isFirstLogin?: boolean | null
          lastActiveAt?: string | null
          lastLoginAt?: string | null
          lastName?: string | null
          metadata?: Json | null
          passwordUpdated?: boolean | null
          phone?: string | null
          preferences?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
  | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
    DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
    DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
  ? R
  : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
    DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] &
    DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
  ? R
  : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
  | keyof DefaultSchema["Tables"]
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Insert: infer I
  }
  ? I
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
    Insert: infer I
  }
  ? I
  : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
  | keyof DefaultSchema["Tables"]
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Update: infer U
  }
  ? U
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
    Update: infer U
  }
  ? U
  : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
  | keyof DefaultSchema["Enums"]
  | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
  : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
  | keyof DefaultSchema["CompositeTypes"]
  | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
  : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
