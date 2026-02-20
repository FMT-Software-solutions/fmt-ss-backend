import { Injectable, Scope, Inject } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { Database } from '../../common/supabase/database.types';
import type { Request } from 'express';

type IssueInsert = Database['public']['Tables']['issues']['Insert'];

@Injectable({ scope: Scope.REQUEST })
export class IssuesService {
  constructor(
    private readonly supabaseService: SupabaseService,
    @Inject(REQUEST) private readonly request: Request,
  ) { }

  async logIssue(issueData: Omit<IssueInsert, 'id' | 'created_at' | 'updated_at' | 'status'>) {
    try {
      const supabase: any = this.supabaseService.getClient();

      // Get IP and User Agent from request
      const userAgent = this.request.headers['user-agent'];
      const xForwardedFor = this.request.headers['x-forwarded-for'];
      const referer = this.request.headers['referer'];

      // Enhance issue data
      const enhancedData: IssueInsert = {
        ...issueData,
        status: 'open',
        user_agent: userAgent,
        url: referer,
        metadata: {
          ...(issueData.metadata as object),
          timestamp: new Date().toISOString(),
          server_side: true,
          ip_address: xForwardedFor,
          headers: {
            'user-agent': userAgent,
            'x-forwarded-for': xForwardedFor,
          }
        }
      };

      const { data, error } = await supabase
        .from('issues')
        .insert([enhancedData])
        .select()
        .single();

      if (error) {
        console.error('Failed to log issue:', error);
        return { success: false, error: error.message };
      }

      return { success: true, issue: data };
    } catch (error) {
      console.error('Error logging issue:', error);
      return { success: false, error: 'Unknown error occurred' };
    }
  }

  async logApiError(
    error: Error | string,
    endpoint: string,
    method: string,
    requestData?: any,
    responseData?: any,
    statusCode?: number
  ) {
    const errorMessage = typeof error === 'string' ? error : error.message;
    const stackTrace = typeof error === 'object' && error.stack ? error.stack : undefined;

    return this.logIssue({
      issue_type: 'error',
      severity: statusCode && statusCode >= 500 ? 'critical' : 'high',
      category: 'api',
      title: `API Error: ${method} ${endpoint}`,
      description: `API endpoint failed with status ${statusCode || 'unknown'}`,
      error_message: errorMessage,
      stack_trace: stackTrace,
      component: `API:${endpoint}`,
      user_action: `${method} request to ${endpoint}`,
      request_data: requestData,
      response_data: responseData,
      metadata: {
        endpoint,
        method,
        status_code: statusCode
      }
    });
  }

  async logDatabaseError(
    error: string,
    operation: string,
    table: string,
    query?: string,
    context?: any
  ) {
    return this.logIssue({
      issue_type: 'error',
      severity: 'critical',
      category: 'database',
      title: `Database Error: ${operation} on ${table}`,
      description: `Database operation failed: ${operation}`,
      error_message: error,
      component: `DB:${table}`,
      user_action: operation,
      metadata: {
        table,
        operation,
        query,
        context
      }
    });
  }
}
