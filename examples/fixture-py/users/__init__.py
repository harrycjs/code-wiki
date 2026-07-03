"""Users module — registration + lookup."""

class User:
    """A registered user."""
    def __init__(self, user_id: str, email: str):
        self.user_id = user_id
        self.email = email

    def greeting(self) -> str:
        """Return a friendly greeting."""
        return f"hi {self.email}"


def register(email: str) -> User:
    """Create a new user record."""
    return User(_hash(email), email)


def find(user_id: str) -> User | None:
    """Look up a user by id."""
    return None


def _hash(s: str) -> str:
    """Internal helper — not part of the public API."""
    return s.lower()
