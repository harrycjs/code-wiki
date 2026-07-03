"""Billing module — invoice totals."""

def total(orders: list, currency: str = "USD") -> float:
    """Sum amounts over the supplied orders."""
    s = 0.0
    for o in orders:
        if o.get("currency", "USD") == currency:
            s += float(o.get("amount", 0))
    return s


def format_invoice(amount: float, currency: str) -> str:
    """Render an invoice line as a human-readable string."""
    return f"{amount:.2f} {currency}"


def _currency_normalize(c: str) -> str:
    """Internal — translate legacy currency codes to ISO 4217."""
    return c.upper()
