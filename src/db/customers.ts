import { supabase } from "./client.js";
import { DEFAULT_REQUIRED_FIELDS } from "../schema/record.js";
import type { Customer } from "../pipeline/types.js";

function toCustomer(row: Record<string, unknown>): Customer {
  const rf = row.required_fields;
  return {
    id: String(row.id),
    name: String(row.name),
    inbox_id: String(row.inbox_id),
    required_fields: Array.isArray(rf) && rf.length ? (rf as string[]) : DEFAULT_REQUIRED_FIELDS,
  };
}

export async function getCustomerByInbox(inboxId: string): Promise<Customer | null> {
  const { data, error } = await supabase
    .from("parser_customers")
    .select("id, name, inbox_id, required_fields, active")
    .eq("inbox_id", inboxId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(`parser_customers lookup: ${error.message}`);
  return data ? toCustomer(data) : null;
}

export async function listCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from("parser_customers")
    .select("id, name, inbox_id, required_fields, active")
    .eq("active", true)
    .order("id");
  if (error) throw new Error(`parser_customers list: ${error.message}`);
  return (data ?? []).map(toCustomer);
}
