"""Orders module — public API for placing and listing orders."""

def place_order(user_id: str, sku: str, qty: int) -> dict:
    """Place a new order. Returns the order record."""
    if qty <= 0:
        raise ValueError("qty must be positive")
    return _build_order(user_id, sku, qty)


def list_orders(user_id: str) -> list:
    """Return the user's orders, newest first."""
    return _load_orders(user_id)


def _build_order(user_id: str, sku: str, qty: int) -> dict:
    return {"user": user_id, "sku": sku, "qty": qty}


def _load_orders(user_id: str) -> list:
    return []
