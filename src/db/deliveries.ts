import { supabase } from "./client.js";
import type { DeliveryStore, DeliveryRow } from "../fieldpulse/deliver.js";

export class SupabaseDeliveryStore implements DeliveryStore {
  async findDelivered(customerId: string, reference: string) {
    const { data, error } = await supabase
      .from("parser_deliveries")
      .select("*")
      .eq("customer_id", customerId)
      .eq("reference", reference)
      .eq("status", "delivered")
      .maybeSingle();
    if (error) throw new Error(`parser_deliveries lookup: ${error.message}`);
    return (data as DeliveryRow | null) ?? null;
  }
  async save(row: DeliveryRow) {
    const { error } = await supabase.from("parser_deliveries").insert(row);
    if (error) throw new Error(`parser_deliveries insert: ${error.message}`);
  }
}

export async function getDeliveryForRun(runId: string) {
  const { data, error } = await supabase.from("parser_deliveries").select("*").eq("run_id", runId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`parser_deliveries get: ${error.message}`);
  return data;
}

export async function getCachedFieldIds(customerId: string): Promise<Record<string, number> | null> {
  const { data, error } = await supabase.from("parser_customers").select("fp_custom_fields").eq("id", customerId).maybeSingle();
  if (error) throw new Error(`parser_customers fields: ${error.message}`);
  return (data?.fp_custom_fields as Record<string, number> | null) ?? null;
}

export async function cacheFieldIds(customerId: string, ids: Record<string, number>) {
  const { error } = await supabase.from("parser_customers").update({ fp_custom_fields: ids }).eq("id", customerId);
  if (error) throw new Error(`parser_customers fields update: ${error.message}`);
}
