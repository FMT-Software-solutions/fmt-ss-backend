export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      messages: {
        Row: {
          id: string;
          name: string;
          email: string;
          message: string;
          created_at: string;
          updated_at: string;
          status: 'pending' | 'sent' | 'failed';
        };
        Insert: {
          id?: string;
          name: string;
          email: string;
          message: string;
          created_at?: string;
          updated_at?: string;
          status?: 'pending' | 'sent' | 'failed';
        };
        Update: {
          id?: string;
          name?: string;
          email?: string;
          message?: string;
          created_at?: string;
          updated_at?: string;
          status?: 'pending' | 'sent' | 'failed';
        };
        Relationships: [];
      };
      newsletter_subscribers: {
        Row: {
          id: string;
          email: string;
          subscribedAt: string;
          unsubscribeToken: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          subscribedAt?: string;
          unsubscribeToken: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          subscribedAt?: string;
          unsubscribeToken?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      training_registrations: {
        Row: {
          id: string;
          training_id: string;
          training_slug: string;
          first_name: string;
          last_name: string;
          email: string;
          phone: string | null;
          company: string | null;
          message: string | null;
          status: 'pending' | 'confirmed' | 'cancelled' | 'attended';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          training_id: string;
          training_slug: string;
          first_name: string;
          last_name: string;
          email: string;
          phone?: string | null;
          company?: string | null;
          message?: string | null;
          status?: 'pending' | 'confirmed' | 'cancelled' | 'attended';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          training_id?: string;
          training_slug?: string;
          first_name?: string;
          last_name?: string;
          email?: string;
          phone?: string | null;
          company?: string | null;
          message?: string | null;
          status?: 'pending' | 'confirmed' | 'cancelled' | 'attended';
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      organizations: {
        Row: {
          id: string;
          name: string;
          email: string;
          phone: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          email: string;
          phone?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          email?: string;
          phone?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      purchases: {
        Row: {
          id: string;
          organization_id: string;
          amount: number;
          status: string;
          items: Json;
          payment_provider: string;
          payment_method: string;
          external_transaction_id: string | null;
          payment_details: Json;
          client_reference: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          amount: number;
          status?: string;
          items: Json;
          payment_provider: string;
          payment_method: string;
          external_transaction_id?: string | null;
          payment_details?: Json;
          client_reference?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          amount?: number;
          status?: string;
          items?: Json;
          payment_provider?: string;
          payment_method?: string;
          external_transaction_id?: string | null;
          payment_details?: Json;
          client_reference?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "purchases_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          }
        ];
      };
      issues: {
        Row: {
          id: string;
          issue_type: string;
          severity: string;
          category: string;
          title: string;
          description: string | null;
          error_message: string | null;
          stack_trace: string | null;
          component: string | null;
          user_action: string | null;
          request_data: Json | null;
          response_data: Json | null;
          metadata: Json | null;
          user_id: string | null;
          url: string | null;
          user_agent: string | null;
          created_at: string;
          updated_at: string;
          status: string;
        };
        Insert: {
          id?: string;
          issue_type: string;
          severity: string;
          category: string;
          title: string;
          description?: string | null;
          error_message?: string | null;
          stack_trace?: string | null;
          component?: string | null;
          user_action?: string | null;
          request_data?: Json | null;
          response_data?: Json | null;
          metadata?: Json | null;
          user_id?: string | null;
          url?: string | null;
          user_agent?: string | null;
          created_at?: string;
          updated_at?: string;
          status?: string;
        };
        Update: {
          id?: string;
          issue_type?: string;
          severity?: string;
          category?: string;
          title?: string;
          description?: string | null;
          error_message?: string | null;
          stack_trace?: string | null;
          component?: string | null;
          user_action?: string | null;
          request_data?: Json | null;
          response_data?: Json | null;
          metadata?: Json | null;
          user_id?: string | null;
          url?: string | null;
          user_agent?: string | null;
          created_at?: string;
          updated_at?: string;
          status?: string;
        };
        Relationships: [];
      };
    };
  };
}
