/**
 * Billing: invoices and totals.
 * Independent of auth — invoices are addressed to userIds, not tokens.
 */

export interface Invoice {
  id: string
  userId: string
  amount: number
  currency: 'USD' | 'EUR'
  createdAt: number
}

export function totalOf(invoices: Invoice[], currency: Invoice['currency']): number {
  let sum = 0
  for (const inv of invoices) {
    if (inv.currency === currency) sum += inv.amount
  }
  return sum
}

export function formatInvoice(inv: Invoice): string {
  const date = new Date(inv.createdAt).toISOString().slice(0, 10)
  return `${inv.id} ${inv.amount.toFixed(2)} ${inv.currency} (${date})`
}
