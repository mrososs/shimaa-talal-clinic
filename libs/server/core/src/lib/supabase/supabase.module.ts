import { Module } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

/**
 * Owns Supabase initialisation for the whole backend. Re-exported by
 * `ServerCoreModule`; no other module may construct a Supabase client.
 */
@Module({
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class SupabaseModule {}
